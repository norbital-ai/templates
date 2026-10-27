import { Effect } from 'effect';
import { model } from '@norbital-ai/bolt';
import { reportFields, commissionFactFields } from '../../../lib/reports.js';
import { monthlyCommission, statementFields } from '../../../lib/monthly-commission.js';
export default model('commission_statements', {
	description: 'Monthly salesperson commission statement.',
	label: 'number',
	fields: {
		owner: { kind: 'ref', to: 'sys_user' },
		acknowledged_by: { kind: 'ref', to: 'sys_user', default: { actor: 'id' } },
		number: { kind: 'seq', pattern: 'CS-{yyyy}-{0000}' },
		period: { kind: 'date' },
		currency: { kind: 'currency' },
		calculation_hash: { kind: 'text' },
		amount: { kind: 'money', currency: 'currency' },
		order_count: { kind: 'int' },
		acknowledged_at: { kind: 'instant' },
		snapshot: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						order: { kind: 'text' },
						number: { kind: 'text' },
						seal_hash: { kind: 'text' },
						calculation_hash: { kind: 'text' },
						amount: { kind: 'text', optional: true },
						unresolved_lines: { kind: 'int' },
						awaiting_approval: { kind: 'bool' }
					}
				}
			}
		}
	},
	unique: [
		{
			fields: ['owner', 'period', 'currency', 'calculation_hash'],
			name: 'one_monthly_commission_statement'
		}
	],
	read: 'all',
	create: {
		columns: { commission_statements: ['owner', 'period', 'currency', 'calculation_hash'] },
		transform: function* (rows, ctx) {
			if (ctx.actor.kind !== 'member') return yield* ctx.refuse('errors.commission_member');
			const acknowledged_by = ctx.actor.id;
			const {
				orders,
				commission_statements: statements,
				sys_user: users,
				source_sales_lines: facts
			} = yield* ctx.db.query({
				orders: { where: { direction: { eq: 'sales' } }, fields: reportFields },
				commission_statements: { fields: statementFields },
				sys_user: { fields: ['name'] },
				source_sales_lines: { fields: commissionFactFields }
			});
			return yield* Effect.forEach(
				rows,
				(input) =>
					Effect.gen(function* () {
						if (!input.period || input.period.slice(8) !== '01')
							return yield* ctx.refuse('errors.commission_month');
						const current = (yield* monthlyCommission(
							orders.rows,
							statements.rows,
							users.rows,
							input.period,
							facts.rows
						)).find((row) => row.owner === input.owner && row.currency === input.currency);
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
		}
	}
});
