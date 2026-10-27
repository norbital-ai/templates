import { model, type Id, type WriteCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { refuseUnlistedKinds } from '../../../lib/payroll_engine/listed_kinds.js';

const columns = [
	'date',
	'name',
	'kind',
	'published_at',
	'replaces',
	'given_to',
	'company_id'
] as const;
/**
 * A holiday's kind is one the version of its entity's lineage governing its day lists (`holiday_kinds`). Every row at
 * once over one batched reader: a calendar's rows read once per shape, not once per day.
 */
const admitKinds = Effect.fnUntraced(function* (
	rows: readonly {
		readonly at: number;
		readonly company_id: Id<'entity'>;
		readonly kind: string;
		readonly date: string;
	}[],
	ctx: WriteCtx<'holiday'>
) {
	const refusals = yield* refuseUnlistedKinds(
		rows.map((row) => ({
			rule: 'holiday_kinds',
			noun: 'holiday kind',
			company_id: row.company_id,
			code: row.kind,
			day: row.date.slice(0, 10)
		})),
		ctx.db.query
	);
	for (const [i, refused] of refusals.entries())
		if (refused != null) return yield* ctx.refuse(refused, { row: rows[i]?.at ?? i });
});

export default model('holiday', {
	description:
		'One observed public holiday of one legal entity on one day. Published individually; a row a payroll run captured or a work day pins is frozen. Imported from a spreadsheet or entered by hand.',
	icon: 'lucide:calendar-x',
	label: 'date',
	fields: {
		date: {
			kind: 'date'
		},
		name: {
			kind: 'text'
		},
		kind: {
			kind: 'text',
			help: 'A kind the version governing the day lists (`rule_set` PAYROLL `holiday_kinds`): what the work and leave records price it as.'
		},
		published_at: {
			kind: 'instant',
			optional: true
		},
		replaces: {
			kind: 'date',
			optional: true
		},
		given_to: {
			kind: 'enum',
			values: ['EVERYONE', 'ONLY_IF_OFF_ON_REPLACED_DATE'],
			default: 'EVERYONE'
		},
		company_id: { kind: 'ref', to: 'entity', inverse: 'holiday' }
	},
	read: 'all',
	create: {
		columns: { holiday: columns },
		transform: function* (rows, ctx) {
			yield* admitKinds(
				rows.map((row, at) => ({ ...row, at })),
				ctx
			);
			return rows;
		}
	},
	update: {
		columns: { holiday: columns },
		// only a moved day or a changed kind is judged again
		transform: function* (changes, ctx) {
			yield* admitKinds(
				changes.flatMap(({ before, set }, at) => {
					const row = { ...before, ...set };
					return row.kind === before.kind && row.date === before.date ? [] : [{ ...row, at }];
				}),
				ctx
			);
			return changes.map(({ set }) => set);
		}
	}
});
