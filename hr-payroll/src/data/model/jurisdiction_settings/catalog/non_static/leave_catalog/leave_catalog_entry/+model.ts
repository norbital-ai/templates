import { model } from '@norbital-ai/bolt';
import { validateRegistered } from '../../../../../../../lib/payroll_engine/registrations.js';
import { jsonObject } from '../../../../../../../lib/payroll_engine/foundation.js';
import {
	assertApprovalBalance,
	postApproval
} from '../../../../../../../lib/payroll_engine/approval_posting.js';
import { tap } from '../../../../../../../lib/payroll_engine/taps.js';

/** Ledger reconciliation for an edit: reverse the committed booking, then post the edited one. */
const reconciliation = (
	changes: readonly {
		readonly before: Record<string, unknown>;
		readonly after?: Record<string, unknown>;
		readonly set?: Record<string, unknown>;
	}[]
) =>
	changes.flatMap((change) => {
		const after = change.after ?? { ...change.before, ...change.set };
		return ['days', 'catalog_id', 'employment_id', 'is_reversal'].some(
			(key) => JSON.stringify(change.before[key]) !== JSON.stringify(after[key])
		)
			? [jsonObject({ ...change.before, is_reversal: true }), jsonObject(after)]
			: [];
	});

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
			yield* assertApprovalBalance(
				ctx.db.query,
				'leave',
				rows.map((row) => jsonObject(row)),
				ctx.today
			);
			return rows;
		}
	},
	update: {
		columns: {
			leave_catalog_entry: ['payroll_run_id', 'days', 'evidence_file', 'is_reversal']
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
			yield* assertApprovalBalance(ctx.db.query, 'leave', reconciliation(changes), ctx.today);
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
			yield* assertApprovalBalance(
				ctx.db.query,
				'leave',
				rows.map((row) => jsonObject({ ...row, is_reversal: true, source_id: null })),
				ctx.today
			);
		}
	},

	effect: {
		created: function* (rows, ctx) {
			yield* postApproval(
				ctx,
				'leave',
				rows.map((row) => jsonObject(row))
			);
			// an entry reaches its version's registered effects through the catalog row it was raised on
			const versions = yield* ctx.query({
				leave_catalog: {
					where: { id: { in: rows.map((row) => row.catalog_id) } },
					fields: ['settings_id'],
					limit: 10000
				}
			});
			const settingsOf = new Map(
				versions.leave_catalog.rows.map((row) => [row.id, row.settings_id])
			);
			yield* tap(
				ctx,
				'create',
				{ collection: 'leave_catalog_entry', ids: rows.map((row) => row.id) },
				rows.map((after) => ({
					after: { ...after, settings_id: settingsOf.get(after.catalog_id) }
				}))
			);
		},
		updated: function* (changes, ctx) {
			const posted = reconciliation(changes);
			if (posted.length > 0) yield* postApproval(ctx, 'leave', posted);
			// sealing into a run is not an edit of the entry
			const edited = changes.filter(
				({ before, after }) => before.payroll_run_id === after.payroll_run_id
			);
			if (edited.length === 0) return;
			const versions = yield* ctx.query({
				leave_catalog: {
					where: { id: { in: edited.map(({ after }) => after.catalog_id) } },
					fields: ['settings_id'],
					limit: 10000
				}
			});
			const settingsOf = new Map(
				versions.leave_catalog.rows.map((row) => [row.id, row.settings_id])
			);
			yield* tap(
				ctx,
				'update',
				{ collection: 'leave_catalog_entry', ids: edited.map((change) => change.after.id) },
				edited.map((change) => ({
					...change,
					after: { ...change.after, settings_id: settingsOf.get(change.after.catalog_id) }
				}))
			);
		},
		deleted: function* (rows, ctx) {
			yield* postApproval(
				ctx,
				'leave',
				rows.map((row) => jsonObject({ ...row, is_reversal: true, source_id: null }))
			);
		}
	}
});
