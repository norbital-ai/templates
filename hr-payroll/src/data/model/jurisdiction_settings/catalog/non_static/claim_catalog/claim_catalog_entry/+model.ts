import { model } from '@norbital-ai/bolt';
import { assertReversals } from '../../../../../../../lib/ledger/service.js';
import { validateRegistered } from '../../../../../../../lib/payroll_engine/registrations.js';
import { jsonObject } from '../../../../../../../lib/payroll_engine/foundation.js';
import { tap } from '../../../../../../../lib/payroll_engine/taps.js';

export default model('claim_catalog_entry', {
	description: 'One claim against an employment.',
	record_label: "string(record.quantity) + ' ' + record.unit",
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
		is_reversal: { kind: 'bool', default: false },
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
				'is_reversal',
				'reverses'
			]
		},
		filled: { claim_catalog_entry: ['is_reversal'] },
		transform: function* (input, ctx) {
			const rows = input.map((row) => ({ ...row, is_reversal: row.reverses != null }));
			yield* validateRegistered(
				ctx.db.query,
				'claim_catalog_entry',
				'create',
				rows.map((row) => jsonObject(row))
			);
			yield* assertReversals(
				ctx.db.query,
				'claim_catalog_entry',
				rows.map((row) => jsonObject(row))
			);
			return rows;
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
			yield* validateRegistered(ctx.db.query, 'claim_catalog_entry', 'update', proposed);
			if (changes.some((c) => c.before.payroll_run_id != null))
				return yield* ctx.refuse('This record is locked by a payroll run.');
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
			yield* ctx.schedule('ledger', { post: rows.map((row) => `claim_catalog_entry:${row.id}`) });
			yield* tap(
				ctx,
				'create',
				{ collection: 'claim_catalog_entry', ids: rows.map((row) => row.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			const edited = changes.filter(
				({ before, after }) => before.payroll_run_id === after.payroll_run_id
			);
			if (edited.length > 0)
				yield* ctx.schedule('ledger', {
					post: edited.map(({ after }) => `claim_catalog_entry:${after.id}`)
				});
			yield* tap(
				ctx,
				'update',
				{ collection: 'claim_catalog_entry', ids: changes.map((change) => change.after.id) },
				changes
			);
		},
		deleted: function* (rows, ctx) {
			yield* ctx.schedule('ledger', { post: rows.map((row) => `claim_catalog_entry:${row.id}`) });
		}
	}
});
