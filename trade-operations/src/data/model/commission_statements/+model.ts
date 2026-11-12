import { model } from '../../../../.norbital/models/commission_statements.ts';
import { Effect } from 'effect';
import { PlainDate } from '@norbital-ai/std/date';
import { boardRead, calculateBoard, readCommissionBoard } from '../../../lib/monthly-commission.js';
export default model({
	description: 'Monthly salesperson commission statement.',
	record_label: 'record.number',
	fields: {
		owner: { kind: 'ref', to: 'sys_user' },
		acknowledged_by: { kind: 'ref', to: 'sys_user', default: { var: 'requestor.id' } },
		number: { kind: 'seq', pattern: 'CS-{yyyy}-{0000}' },
		period: { kind: 'date' },
		currency: { kind: 'currency' },
		calculation_hash: { kind: 'text', hidden: true },
		amount: { kind: 'money', currency: 'currency' },
		order_count: { kind: 'int' },
		acknowledged_at: { kind: 'instant' },
		snapshot: {
			hidden: true,
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					order: { kind: 'text' },
					number: { kind: 'text' },
					seal_hash: { kind: 'text' },
					calculation_hash: { kind: 'text' },
					amount: { kind: 'text', optional: true },
					unresolved_lines: { kind: 'int' },
					awaiting_approval: { kind: 'bool' }
				},
				many: true
			}
		}
	},
	outputs: { default: { fields: 'all' } },
	constraints: {
		one_monthly_commission_statement: {
			unique: ['owner', 'period', 'currency', 'calculation_hash']
		}
	},
	create: {
		columns: { fields: ['owner', 'period', 'currency', 'calculation_hash'] },
		transform: function* (changes, ctx) {
			if (ctx.actor.kind !== 'member') return yield* ctx.refuse('errors.commission_member');
			const acknowledged_by = ctx.actor.id;
			return yield* Effect.forEach(
				changes,
				({ after: input, set }) =>
					Effect.gen(function* () {
						if (!input.period || input.period.slice(8) !== '01')
							return yield* ctx.refuse('errors.commission_month');
						const period = PlainDate(input.period);
						const request = boardRead(period, false, input.owner);
						const answer = yield* ctx.query(request);
						const complete = yield* readCommissionBoard(ctx, request, answer).pipe(
							Effect.catchTag('ReportRowsChanged', () => ctx.refuse('errors.commission_incomplete'))
						);
						const current = (yield* calculateBoard(
							complete.facts,
							complete.statements,
							complete.users,
							period
						)).find((row) => row.owner === input.owner && row.currency === input.currency);
						if (!current) return yield* ctx.refuse('errors.commission_nothing');
						if (current.amount === null) return yield* ctx.refuse('errors.commission_unresolved');
						if (current.calculation_hash !== input.calculation_hash)
							return yield* ctx.refuse('errors.commission_changed');
						if (
							complete.statements.some(
								(row) =>
									row.owner === input.owner &&
									row.period === input.period &&
									row.currency === input.currency &&
									row.calculation_hash === current.calculation_hash
							)
						)
							return yield* ctx.refuse('errors.commission_unchanged');
						return {
							...set,
							amount: current.amount,
							order_count: current.order_count,
							snapshot: current.snapshot,
							acknowledged_by,
							acknowledged_at: ctx.now
						};
					}),
				{ concurrency: 'unbounded' }
			);
		}
	}
});
