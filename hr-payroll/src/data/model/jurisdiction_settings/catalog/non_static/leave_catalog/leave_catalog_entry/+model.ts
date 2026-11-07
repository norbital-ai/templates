import { model } from '@norbital-ai/bolt';
import { jsonObject } from '../../../../../../../lib/payroll_engine/foundation.js';
import {
	assertLeft,
	assertReversals,
	entriesUndone,
	entryPostings,
	entryRead
} from '../../../../../../../lib/ledger/service.js';
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
	unique: [{ fields: ['reverses'] }],
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
		filled: { leave_catalog_entry: ['is_reversal'] },
		transform: function* (input, ctx) {
			const rows = input.map((row) => ({ ...row, is_reversal: row.reverses != null }));
			const entries = rows.map((row) => jsonObject(row));
			// the approving decision asks again only for what the entry posts: what it checked stands
			const known = yield* entryRead(
				ctx.db.query,
				'leave_catalog_entry',
				entries,
				ctx.approving ? undefined : 'create'
			);
			if (!ctx.approving) {
				yield* assertReversals(known, 'leave_catalog_entry', entries);
				yield* assertLeft(known, entries, String(ctx.today));
			}
			return { rows, onApproved: entryPostings(known, 'leave_catalog_entry', entries) };
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
			const known = yield* entryRead(
				ctx.db.query,
				'leave_catalog_entry',
				proposed,
				ctx.approving ? undefined : 'update'
			);
			if (!ctx.approving) {
				if (changes.some((c) => c.before.payroll_run_id != null))
					return yield* ctx.refuse('This record is locked by a payroll run.');
				yield* assertLeft(
					known,
					proposed,
					String(ctx.today),
					changes.map((change) => jsonObject(change.before))
				);
			}
			return {
				rows: changes.map((c) => c.set),
				onApproved: entryPostings(known, 'leave_catalog_entry', proposed)
			};
		}
	},
	delete: {
		check: function* (rows, ctx) {
			const entries = rows.map((row) => jsonObject(row));
			const known = yield* entryRead(
				ctx.db.query,
				'leave_catalog_entry',
				entries,
				ctx.approving ? undefined : 'delete'
			);
			if (!ctx.approving) {
				if (rows.some((r) => r.payroll_run_id != null))
					return yield* ctx.refuse('This record is locked by a payroll run.');
				yield* assertLeft(
					known,
					rows.map((row) => jsonObject({ ...row, is_reversal: !row.is_reversal })),
					String(ctx.today)
				);
			}
			return { onApproved: entriesUndone(known, 'leave_catalog_entry', entries) };
		}
	},

	effect: {
		created: function* (rows, ctx) {
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
			yield* tap(
				ctx,
				'update',
				{ collection: 'leave_catalog_entry', ids: edited.map((change) => change.after.id) },
				edited
			);
		}
	}
});
