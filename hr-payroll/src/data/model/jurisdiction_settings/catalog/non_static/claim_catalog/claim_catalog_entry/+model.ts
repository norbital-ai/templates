import { model } from '@norbital-ai/bolt';
import {
	assertReversals,
	entriesUndone,
	entryPostings,
	entryRead
} from '../../../../../../../lib/ledger/service.js';
import { jsonObject } from '../../../../../../../lib/payroll_engine/foundation.js';
import { tap } from '../../../../../../../lib/payroll_engine/taps.js';

export default model('claim_catalog_entry', {
	description: 'One claim against an employment.',
	record_label:
		"record.employment_id.employee_number + ' · ' + string(record.quantity) + (record.unit == 'MONEY' ? '' : ' ' + record.unit)",
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employee_contract', inverse: 'claim_catalog_entry' },
		catalog_id: { kind: 'ref', to: 'claim_catalog', onDelete: 'restrict' },
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true, onDelete: 'setNull' },
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
		reverses: { kind: 'ref', to: 'claim_catalog_entry', optional: true, onDelete: 'restrict' }
	},
	locked: { payroll_run_id: { isNull: false } },
	read: {
		claim_catalog_entry: { fields: 'all' },
		'claim_catalog_entry.employment_id': { fields: 'all' },
		'claim_catalog_entry.catalog_id': { fields: 'all' },
		'claim_catalog_entry.payroll_run_id': { fields: 'all' }
	},
	unique: [{ fields: ['reverses'] }],
	create: {
		columns: {
			claim_catalog_entry: [
				'entity_id',
				'employment_id',
				'catalog_id',
				'quantity',
				'incurred_on',
				'evidence_file',
				'reverses'
			]
		},
		transform: function* (input, ctx) {
			const rows = input;
			const entries = rows.map((row) => jsonObject(row));
			// the approving decision asks again only for what the entry posts: what it checked stands
			const known = yield* entryRead(
				ctx.db.query,
				'claim_catalog_entry',
				entries,
				ctx.approving ? undefined : 'create'
			);
			if (!ctx.approving) {
				yield* assertReversals(known, 'claim_catalog_entry', entries);
			}
			return { rows, onApproved: yield* entryPostings(known, 'claim_catalog_entry', entries) };
		}
	},
	update: {
		columns: {
			claim_catalog_entry: ['payroll_run_id', 'quantity', 'incurred_on', 'evidence_file']
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
			const known = yield* entryRead(
				ctx.db.query,
				'claim_catalog_entry',
				proposed,
				ctx.approving ? undefined : 'update'
			);
			if (!ctx.approving && changes.some((c) => c.before.payroll_run_id != null))
				return yield* ctx.refuse(
					'This record is locked by a payroll run. Create a reversal entry for it instead.'
				);
			return {
				rows: changes.map((c) => c.set),
				onApproved: yield* entryPostings(known, 'claim_catalog_entry', proposed)
			};
		}
	},
	delete: {
		check: function* (rows, ctx) {
			const entries = rows.map((row) => jsonObject(row));
			const known = yield* entryRead(
				ctx.db.query,
				'claim_catalog_entry',
				entries,
				ctx.approving ? undefined : 'delete'
			);
			if (!ctx.approving && rows.some((r) => r.payroll_run_id != null))
				return yield* ctx.refuse(
					'This record is locked by a payroll run. Create a reversal entry for it instead.'
				);
			return { onApproved: entriesUndone(known, 'claim_catalog_entry', entries) };
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
