import { Effect } from 'effect';
import { collection, type QueryCtx, type TransformCtx } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { reportSelect, commissionFactSelect } from '../../../lib/reports.js';
import { monthlyCommission } from '../../../lib/monthly-commission.js';
const c = collection('commission_statements', {
	read: { fields: 'all' },
	create: { input: { columns: ['owner', 'period', 'currency', 'calculation_hash'] } },
	queries: {
		board: {
			description:
				'Scoped monthly salesperson commission board. Currencies remain separate; sign-offs never change an SO seal.',
			input: { period: { kind: 'date' } },
			output: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						owner: { kind: 'id', of: 'sys_user' },
						owner_name: { kind: 'text' },
						period: { kind: 'date' },
						currency: { kind: 'currency' },
						order_count: { kind: 'int' },
						amount: { kind: 'money', currency: 'currency', optional: true },
						calculation_hash: { kind: 'text' },
						unresolved_lines: { kind: 'int' },
						awaiting_approval: { kind: 'int' },
						latest_amount: { kind: 'money', currency: 'currency', optional: true },
						latest_statement: { kind: 'id', of: 'commission_statements', optional: true },
						state: {
							kind: 'enum',
							values: ['unacknowledged', 'current', 'changed', 'unresolved', 'awaiting_approval']
						}
					}
				}
			}
		}
	}
});
export default c;
c.query('board', function* (input, ctx: QueryCtx) {
	const period = input.period.slice(0, 7) + '-01';
	const { orders, statements, users, facts } = yield* ctx.read({
		orders: {
			collection: 'orders',
			where: { direction: { eq: 'sales' } },
			select: reportSelect,
			all: true
		},
		statements: {
			collection: 'commission_statements',
			where: { period: { eq: PlainDate(period) } },
			all: true
		},
		users: { collection: 'sys_user', select: { name: true }, all: true },
		facts: { collection: 'source_sales_lines', select: commissionFactSelect, all: true }
	});
	const rows = yield* monthlyCommission(
		orders.rows,
		statements.rows,
		users.rows,
		period,
		facts.rows
	);
	return rows.map(({ snapshot, ...row }) => ({ ...row, period: PlainDate(row.period) }));
});
c.transform(function* (inputs, ctx: TransformCtx<'commission_statements'>) {
	if (ctx.actor.kind !== 'member') return yield* ctx.refuse('errors.commission_member');
	const acknowledged_by = ctx.actor.id;
	const { orders, statements, users, facts } = yield* ctx.db.read({
		orders: {
			collection: 'orders',
			where: { direction: { eq: 'sales' } },
			select: reportSelect,
			all: true
		},
		statements: {
			collection: 'commission_statements',
			select: {
				number: true,
				owner: true,
				period: true,
				currency: true,
				calculation_hash: true,
				amount: true,
				order_count: true,
				acknowledged_at: true,
				acknowledged_by: true,
				snapshot: true
			},
			all: true
		},
		users: { collection: 'sys_user', select: { name: true }, all: true },
		facts: { collection: 'source_sales_lines', select: commissionFactSelect, all: true }
	});
	return yield* Effect.forEach(
		inputs,
		(input) =>
			Effect.gen(function* () {
				if (!input.period || input.period.slice(8) !== '01')
					return yield* ctx.refuse('errors.commission_month');
				const rows = yield* monthlyCommission(
					orders.rows,
					statements.rows,
					users.rows,
					input.period,
					facts.rows
				);
				const current = rows.find(
					(row) => row.owner === input.owner && row.currency === input.currency
				);
				if (!current) return yield* ctx.refuse('errors.commission_nothing');
				if (current.amount === null) return yield* ctx.refuse('errors.commission_unresolved');
				if (current.calculation_hash !== input.calculation_hash)
					return yield* ctx.refuse('errors.commission_changed');
				if (
					statements.rows.some(
						(row) =>
							row.owner === input.owner &&
							row.period === input.period &&
							row.currency === input.currency &&
							row.calculation_hash === current.calculation_hash
					)
				)
					return yield* ctx.refuse('errors.commission_unchanged');
				return {
					...input,
					amount: current.amount,
					order_count: current.order_count,
					snapshot: current.snapshot,
					acknowledged_by,
					acknowledged_at: ctx.now
				};
			}),
		{ concurrency: 'unbounded' }
	);
});
