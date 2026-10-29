import { model, type Id, type WriteCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { runEngine } from '../../../lib/payroll_engine/foundation.js';
import { admitSuspension, loadWorkplaceAdmission } from '../../../lib/payroll_engine/admit.js';
import { moved, tap } from '../../../lib/payroll_engine/taps.js';

const update_columns = [
	'kind',
	'starts_on',
	'ends_on',
	'worksite',
	'employment_ids',
	'facts'
] as const;
/** A suspension names a kind its governing version lists and ends on or after it starts. */
const admit = Effect.fnUntraced(function* (
	rows: readonly {
		readonly company_id: Id<'entity'>;
		readonly kind: string;
		readonly starts_on: string;
		readonly ends_on: string;
	}[],
	ctx: WriteCtx<'work_suspension'>
) {
	const prefetched = yield* loadWorkplaceAdmission(ctx.db.query, rows);
	yield* Effect.forEach(rows, (row, at) =>
		runEngine(
			admitSuspension(
				{
					company_id: row.company_id,
					kind: row.kind,
					starts_on: row.starts_on,
					ends_on: row.ends_on
				},
				prefetched
			),
			ctx.db.query,
			(message) => ctx.refuse(message, { row: at })
		)
	);
});

export default model('work_suspension', {
	description:
		'Blocked-out days of one legal entity: a date range of one cause (an employer-caused shutdown, a natural disaster, a strike — a kind the governing version lists), for one worksite or named employments, or everyone. The days show in the payslip’s work days and the leave attendance root; whether they count as attended, are excluded or are paid is the jurisdiction’s configuration.',
	icon: 'lucide:calendar-off',
	label: 'kind',
	fields: {
		kind: {
			kind: 'text',
			help: 'A code of the governing version’s suspension_catalog.'
		},
		starts_on: {
			kind: 'date'
		},
		ends_on: {
			kind: 'date'
		},
		worksite: {
			kind: 'text',
			optional: true,
			help: 'Only this worksite (the roster day’s, else the terms’ worksite fact); blank for the whole entity.'
		},
		employment_ids: {
			kind: 'json',
			shape: { kind: 'list', of: { kind: 'text' } },
			default: [],
			help: 'Only these employments; empty for everyone at the entity or worksite.'
		},
		facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			default: {}
		},
		company_id: {
			kind: 'ref',
			to: 'entity',
			inverse: 'work_suspension',
			owned: true
		}
	},
	read: 'all',
	create: {
		columns: { work_suspension: [...update_columns, 'company_id'] },
		transform: function* (rows, ctx) {
			yield* admit(rows, ctx);
			return rows;
		}
	},
	update: {
		columns: { work_suspension: update_columns },
		transform: function* (changes, ctx) {
			yield* admit(
				changes.map(({ before, set }) => ({ ...before, ...set })),
				ctx
			);
			return changes.map(({ set }) => set);
		}
	},
	// The jurisdiction behaviour rules for this model's writes (`behaviour_taps`), started as the writer.
	effect: {
		created: function* (rows, ctx) {
			yield* tap(ctx, 'created', { model: 'work_suspension', ids: rows.map((row) => row.id) });
		},
		updated: function* (changes, ctx) {
			const ids = moved(changes, [
				'kind',
				'starts_on',
				'ends_on',
				'worksite',
				'employment_ids',
				'facts'
			]);
			yield* tap(ctx, 'updated', { model: 'work_suspension', ids });
		}
	}
});
