import { model } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { validateRegistered } from '../../../../../../../lib/payroll_engine/registrations.js';
import {
	jsonObject,
	numberOf,
	Refusal
} from '../../../../../../../lib/payroll_engine/foundation.js';
import { queryRows, type Reader } from '../../../../../../../lib/payroll_engine/reads.js';
import { tap } from '../../../../../../../lib/payroll_engine/taps.js';

/** A money claim may not exceed its catalogue's annual limit for that employment. */
function* assertClaimLimits(read: Reader, rows: readonly Record<string, unknown>[]) {
	const catalogIds = [
		...new Set(rows.flatMap((row) => (typeof row.catalog_id === 'string' ? [row.catalog_id] : [])))
	];
	if (catalogIds.length === 0) return;
	const catalogs = yield* queryRows(read, {
		claim_catalog: { where: { id: { in: catalogIds } }, fields: ['id', 'lookup'], limit: 10000 }
	});
	const limits = new Map(
		(catalogs.claim_catalog ?? []).flatMap((row) => {
			const limit = Number((row.lookup as { annual_limit?: number } | undefined)?.annual_limit);
			return Number.isFinite(limit) && limit > 0 ? [[String(row.id), limit] as const] : [];
		})
	);
	if (limits.size === 0) return;
	const employmentIds = [
		...new Set(
			rows.flatMap((row) => (typeof row.employment_id === 'string' ? [row.employment_id] : []))
		)
	];
	const existing = yield* queryRows(read, {
		claim_catalog_entry: {
			where: { employment_id: { in: employmentIds } },
			fields: ['id', 'employment_id', 'catalog_id', 'quantity', 'incurred_on', 'is_reversal'],
			limit: 10000
		}
	});
	const used = new Map<string, number>();
	const key = (employment: string, catalog: string, year: string) =>
		`${employment}:${catalog}:${year}`;
	for (const row of existing.claim_catalog_entry ?? []) {
		if (row.is_reversal === true) continue;
		const at = key(
			String(row.employment_id),
			String(row.catalog_id),
			String(row.incurred_on).slice(0, 4)
		);
		used.set(at, (used.get(at) ?? 0) + (numberOf(row.quantity) ?? 0));
	}
	for (const row of rows) {
		const limit = limits.get(String(row.catalog_id));
		if (limit === undefined) continue;
		const at = key(
			String(row.employment_id),
			String(row.catalog_id),
			String(row.incurred_on).slice(0, 4)
		);
		const own = (existing.claim_catalog_entry ?? []).find((old) => old.id === row.id);
		const prior = own === undefined ? 0 : (numberOf(own.quantity) ?? 0);
		if ((used.get(at) ?? 0) - prior + (numberOf(row.quantity) ?? 0) > limit)
			yield* Effect.fail(
				new Refusal({ message: `${String(row.catalog_id)}: the annual claim limit is ${limit}.` })
			);
		used.set(at, (used.get(at) ?? 0) + (numberOf(row.quantity) ?? 0));
	}
}

export default model('claim_catalog_entry', {
	description: 'One claim against an employment.',
	record_label: "string(record.quantity) + ' ' + record.unit",
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employee_contract', inverse: 'claim_catalog_entry' },
		catalog_id: { kind: 'ref', to: 'claim_catalog', onDelete: 'restrict' },
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true },
		quantity: { kind: 'decimal', scale: 12, min: 0, label: 'Amount' },
		unit: {
			kind: 'enum',
			values: ['DAY', 'CALENDAR_DAY', 'HOUR', 'MONEY', 'COUNT'],
			default: 'MONEY'
		},
		incurred_on: { kind: 'date' },
		evidence_file: {
			kind: 'file',
			accept: ['application/pdf', 'image/*'],
			max: '20MiB',
			optional: true
		},
		is_reversal: { kind: 'bool', default: false }
	},
	locked: { payroll_run_id: { isNull: false } },
	read: {
		claim_catalog_entry: { fields: 'all' },
		'claim_catalog_entry.employment_id': { fields: 'all' },
		'claim_catalog_entry.catalog_id': { fields: 'all' },
		'claim_catalog_entry.payroll_run_id': { fields: 'all' }
	},
	create: {
		columns: {
			claim_catalog_entry: [
				'entity_id',
				'employment_id',
				'catalog_id',
				'quantity',
				'incurred_on',
				'evidence_file',
				'is_reversal'
			]
		},
		transform: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'claim_catalog_entry',
				'create',
				rows.map((row) => jsonObject(row))
			);
			yield* assertClaimLimits(ctx.db.query, rows);
			return rows;
		}
	},
	update: {
		columns: {
			claim_catalog_entry: [
				'payroll_run_id',
				'quantity',
				'incurred_on',
				'evidence_file',
				'is_reversal'
			]
		},
		transform: function* (changes, ctx) {
			if (
				changes.every(
					(change) =>
						Object.keys(change.set).length === 1 && Object.hasOwn(change.set, 'payroll_run_id')
				)
			)
				return changes.map((change) => change.set);
			const proposed = changes.map((change) => jsonObject({ ...change.before, ...change.set }));
			yield* validateRegistered(ctx.db.query, 'claim_catalog_entry', 'update', proposed);
			if (changes.some((c) => c.before.payroll_run_id != null))
				return yield* ctx.refuse('This record is locked by a payroll run.');
			yield* assertClaimLimits(ctx.db.query, proposed);
			return changes.map((c) => c.set);
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'claim_catalog_entry',
				'delete',
				rows.map((row) => jsonObject(row))
			);
			if (rows.some((r) => r.payroll_run_id != null))
				return yield* ctx.refuse('This record is locked by a payroll run.');
		}
	},

	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'claim_catalog_entry', ids: rows.map((row) => row.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{ collection: 'claim_catalog_entry', ids: changes.map((change) => change.after.id) },
				changes
			);
		}
	}
});
