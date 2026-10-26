import { model, type Id, type WriteCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { cycleDays } from '../../../lib/payroll_engine/shift_pattern.js';

const update_columns = ['code', 'name', 'pattern', 'effective_range'] as const;
/** Each pattern day names a shift definition of the pattern's own entity: every row's entities read once. */
const admitDays = Effect.fnUntraced(function* (
	rows: readonly {
		readonly company_id: Id<'entity'>;
		readonly pattern: Parameters<typeof cycleDays>[0];
	}[],
	ctx: WriteCtx<'shift_pattern'>
) {
	const { rows: shifts } = yield* ctx.db.query('shift_definition', {
		where: {
			company_id: { in: [...new Set(rows.map((row) => row.company_id))] }
		},
		select: { company_id: true },
		all: true
	});
	const companyOf = new Map(shifts.map((row) => [String(row.id), row.company_id]));
	for (const [at, row] of rows.entries())
		for (const day of cycleDays(row.pattern)) {
			const id = day.roster_code_id;
			if (id != null && id !== '' && companyOf.get(id) !== row.company_id)
				return yield* ctx.refuse(
					'Each pattern day must use a shift code belonging to its entity.',
					{ row: at }
				);
		}
});

export default model('shift_pattern', {
	description:
		'One named roster cycle of an entity: its days name shift definitions in order, and every employment of the entity projects its days from the pattern in force. The cycle is any length — a 4-day two-on-two-off, a 7-day week, a 14-day day/night rotation — and day 1 is the day its effective range opens. A rotation between shifts or batches is the other pattern taking effect, not a longer cycle. A roster of record overrides it for its month.',
	icon: 'lucide:repeat',
	label: 'code',
	fields: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		pattern: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					days: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								roster_code_id: {
									kind: 'text',
									optional: true
								}
							}
						}
					}
				}
			}
		},
		effective_range: {
			kind: 'period',
			of: 'date',
			optional: true
		},
		company_id: { kind: 'ref', to: 'entity', inverse: 'shift_pattern' }
	},
	read: 'all',
	create: {
		columns: [...update_columns, 'company_id'],
		transform: function* (rows, ctx) {
			yield* admitDays(rows, ctx);
			return rows;
		}
	},
	update: {
		columns: update_columns,
		transform: function* (changes, ctx) {
			yield* admitDays(
				changes.map(({ before, set }) => ({ ...before, ...set })),
				ctx
			);
			return changes.map(({ set }) => set);
		}
	}
});
