import { model } from '@norbital-ai/bolt';
import { validateRegistered } from '../../../../../../../lib/payroll_engine/registrations.js';
import { jsonObject } from '../../../../../../../lib/payroll_engine/foundation.js';
import { assertLeft } from '../../../../../../../lib/ledger/service.js';
import { tap } from '../../../../../../../lib/payroll_engine/taps.js';

export default model('leave_catalog_entry', {
	description: 'One leave request: dated half-day slots for an employment.',
	record_label: "string(size(record.days)) + ' half-days'",
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employee_contract', inverse: 'leave_catalog_entry' },
		catalog_id: { kind: 'ref', to: 'leave_catalog', onDelete: 'restrict' },
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true, onDelete: 'setNull' },
		days: {
			kind: 'list',
			min: 1,
			of: {
				kind: 'object',
				fields: {
					date: { kind: 'date' },
					part: { kind: 'enum', values: ['AM', 'PM'] }
				}
			}
		},
		evidence_file: {
			kind: 'file',
			accept: ['application/pdf', 'image/*'],
			max: '20MiB',
			optional: true
		},
		is_reversal: { kind: 'bool', default: false },
		reverses: { kind: 'ref', to: 'leave_catalog_entry', optional: true, onDelete: 'restrict' },
		encashment: { kind: 'bool', default: false, hidden: true }
	},
	locked: { payroll_run_id: { isNull: false } },
	read: {
		leave_catalog_entry: { fields: 'all' },
		'leave_catalog_entry.employment_id': { fields: 'all' },
		'leave_catalog_entry.catalog_id': { fields: 'all' },
		'leave_catalog_entry.payroll_run_id': { fields: 'all' }
	},
	create: {
		columns: {
			leave_catalog_entry: [
				'entity_id',
				'employment_id',
				'catalog_id',
				'days',
				'evidence_file',
				'is_reversal',
				'reverses',
				'encashment'
			]
		},
		transform: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'leave_catalog_entry',
				'create',
				rows.map((row) => jsonObject(row))
			);
			yield* assertLeft(
				ctx.db.query,
				rows.map((row) => jsonObject(row)),
				String(ctx.today)
			);
			return rows;
		}
	},
	update: {
		columns: {
			leave_catalog_entry: ['payroll_run_id', 'days', 'evidence_file']
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
			yield* validateRegistered(ctx.db.query, 'leave_catalog_entry', 'update', proposed);
			if (changes.some((c) => c.before.payroll_run_id != null))
				return yield* ctx.refuse('This record is locked by a payroll run.');
			yield* assertLeft(
				ctx.db.query,
				proposed,
				String(ctx.today),
				changes.map((change) => jsonObject(change.before))
			);
			return changes.map((c) => c.set);
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'leave_catalog_entry',
				'delete',
				rows.map((row) => jsonObject(row))
			);
			if (rows.some((r) => r.payroll_run_id != null))
				return yield* ctx.refuse('This record is locked by a payroll run.');
			yield* assertLeft(
				ctx.db.query,
				rows.map((row) => jsonObject({ ...row, is_reversal: !row.is_reversal })),
				String(ctx.today)
			);
		}
	},

	effect: {
		created: function* (rows, ctx) {
			yield* ctx.schedule('ledger', {
				post: rows.map((row) => `leave_catalog_entry:${row.id}`)
			});
			yield* tap(
				ctx,
				'create',
				{ collection: 'leave_catalog_entry', ids: rows.map((row) => row.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			// sealing into a run is not an edit of the entry
			const edited = changes.filter(
				({ before, after }) => before.payroll_run_id === after.payroll_run_id
			);
			if (edited.length === 0) return;
			yield* ctx.schedule('ledger', {
				post: edited.map(({ after }) => `leave_catalog_entry:${after.id}`)
			});
			yield* tap(
				ctx,
				'update',
				{ collection: 'leave_catalog_entry', ids: edited.map((change) => change.after.id) },
				edited
			);
		},
		deleted: function* (rows, ctx) {
			yield* ctx.schedule('ledger', {
				post: rows.map((row) => `leave_catalog_entry:${row.id}`)
			});
		}
	}
});
