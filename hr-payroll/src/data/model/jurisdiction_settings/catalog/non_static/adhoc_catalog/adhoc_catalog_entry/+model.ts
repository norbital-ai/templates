import { model } from '@norbital-ai/bolt';
import { validateRegistered } from '../../../../../../../lib/payroll_engine/registrations.js';
import { jsonObject } from '../../../../../../../lib/payroll_engine/foundation.js';
import { tap } from '../../../../../../../lib/payroll_engine/taps.js';

export default model('adhoc_catalog_entry', {
	description: 'One ad-hoc payment or deduction for an employment.',
	label: 'description',
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employee_contract', inverse: 'adhoc_catalog_entry' },
		catalog_id: { kind: 'ref', to: 'adhoc_catalog', onDelete: 'restrict' },
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true, onDelete: 'setNull' },
		description: { kind: 'text' },
		quantity: { kind: 'decimal', scale: 12, min: 0 },
		unit: { kind: 'enum', values: ['DAY', 'CALENDAR_DAY', 'HOUR', 'MONEY', 'COUNT'] },
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
		adhoc_catalog_entry: { fields: 'all' },
		'adhoc_catalog_entry.employment_id': { fields: 'all' },
		'adhoc_catalog_entry.catalog_id': { fields: 'all' },
		'adhoc_catalog_entry.payroll_run_id': { fields: 'all' }
	},
	create: {
		columns: {
			adhoc_catalog_entry: [
				'entity_id',
				'employment_id',
				'catalog_id',
				'description',
				'quantity',
				'unit',
				'incurred_on',
				'evidence_file',
				'is_reversal'
			]
		},
		transform: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'adhoc_catalog_entry',
				'create',
				rows.map((row) => jsonObject(row))
			);
			return rows;
		}
	},
	update: {
		columns: {
			adhoc_catalog_entry: [
				'payroll_run_id',
				'description',
				'quantity',
				'unit',
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
			yield* validateRegistered(ctx.db.query, 'adhoc_catalog_entry', 'update', proposed);
			if (changes.some((c) => c.before.payroll_run_id != null))
				return yield* ctx.refuse('This record is locked by a payroll run.');
			return changes.map((c) => c.set);
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'adhoc_catalog_entry',
				'delete',
				rows.map((row) => jsonObject(row))
			);
			if (rows.some((r) => r.payroll_run_id != null))
				return yield* ctx.refuse('This record is locked by a payroll run.');
		}
	},

	effect: {
		created: function* (rows, ctx) {
			// an entry reaches its version's registered effects through the catalog row it was raised on
			const versions = yield* ctx.query({
				adhoc_catalog: {
					where: { id: { in: rows.map((row) => row.catalog_id) } },
					fields: ['settings_id'],
					limit: 10000
				}
			});
			const settingsOf = new Map(
				versions.adhoc_catalog.rows.map((row) => [row.id, row.settings_id])
			);
			yield* tap(
				ctx,
				'create',
				{ collection: 'adhoc_catalog_entry', ids: rows.map((row) => row.id) },
				rows.map((after) => ({
					after: { ...after, settings_id: settingsOf.get(after.catalog_id) }
				}))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{ collection: 'adhoc_catalog_entry', ids: changes.map((change) => change.after.id) },
				changes
			);
		}
	}
});
