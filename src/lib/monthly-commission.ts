import { Effect } from 'effect';
import { agreement, withAgreement } from './agreements.js';
import { minorDigits, sum } from '@norbital-ai/std/decimal';
import {
	AgreementUnavailable,
	commissionCalculation,
	commissionFactFields,
	reportFields,
	type CommissionFact,
	type ReportOrder
} from './reports.js';
import { isMasked, type ReadAnswer, type Row } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { hash } from './commercial.js';
type MonthlyOrder = ReportOrder;
/** The fields a statement's sign-off compares (the board and the statement create read them). */
export const statementFields = [
	'number',
	'owner',
	'period',
	'currency',
	'calculation_hash',
	'amount',
	'order_count',
	'acknowledged_at',
	'acknowledged_by',
	'snapshot'
] as const;
/** The board's read for one month (`period`, its first day): sales orders, statements, salespeople and sales facts. */
export const boardRead = (period: PlainDate) =>
	({
		orders: { where: { direction: { eq: 'sales' } }, fields: reportFields },
		commission_statements: { where: { period: { eq: period } }, fields: statementFields },
		sys_user: { fields: ['name'] },
		source_sales_lines: { fields: commissionFactFields }
	}) as const;
export const monthlyCommission = Effect.fnUntraced(function* (
	orders: readonly MonthlyOrder[],
	statements: readonly Pick<
		Row<'commission_statements'>,
		'id' | 'number' | 'owner' | 'period' | 'currency' | 'calculation_hash' | 'amount'
	>[],
	users: readonly Pick<Row<'sys_user'>, 'id' | 'name'>[],
	period: string,
	facts: readonly CommissionFact[]
) {
	const groups = new Map<
		string,
		{
			owner: Row<'orders'>['owner'];
			currency: Row<'orders'>['currency'];
			orders: MonthlyOrder[];
		}
	>();
	for (const fact of facts) {
		if (!fact.active || fact.business_on.slice(0, 7) !== period.slice(0, 7)) continue;
		const record = orders.find((order) => order.id === fact.order);
		if (!record) continue;
		const version = agreement(record, fact.seal_hash);
		if (!version) continue;
		const order = withAgreement(record, version);
		if (order.direction !== 'sales' || isMasked(order.currency)) continue;
		const key = `${order.owner}:${order.currency}`;
		const group = groups.get(key) ?? { owner: order.owner, currency: order.currency, orders: [] };
		if (
			!group.orders.some(
				(existing) => existing.id === order.id && existing.seal_hash === order.seal_hash
			)
		)
			group.orders.push(order);
		groups.set(key, group);
	}
	// Keep prior beneficiaries visible when their source facts were withdrawn or moved out of this month.
	for (const statement of statements) {
		if (statement.period !== period) continue;
		const key = `${statement.owner}:${statement.currency}`;
		if (!groups.has(key))
			groups.set(key, { owner: statement.owner, currency: statement.currency, orders: [] });
	}
	return yield* Effect.forEach(
		[...groups.values()],
		(group) =>
			Effect.forEach(
				group.orders.sort(
					(a, b) =>
						a.id.localeCompare(b.id) || String(a.seal_hash).localeCompare(String(b.seal_hash))
				),
				(order) => {
					const actual = facts
						.filter(
							(fact) =>
								fact.active &&
								fact.order === order.id &&
								fact.seal_hash === order.seal_hash &&
								fact.business_on.slice(0, 7) === period.slice(0, 7)
						)
						.sort((a, b) => a.id.localeCompare(b.id));
					const seal = order.seal_hash;
					if (seal === null)
						return Effect.fail(
							new AgreementUnavailable({ message: 'Commission order lacks its approved seal' })
						);
					return commissionCalculation(order, seal, actual).pipe(
						Effect.map((current) => ({
							order: order.id,
							number: order.number,
							seal_hash: seal,
							calculation_hash: current.calculation_hash,
							amount: current.amount?.toString() ?? null,
							unresolved_lines: current.unresolved_lines,
							awaiting_approval: false
						}))
					);
				},
				{ concurrency: 'unbounded' }
			).pipe(
				Effect.flatMap((snapshot) => {
					const unresolved_lines = snapshot.reduce((n, row) => n + row.unresolved_lines, 0);
					const awaiting_approval = snapshot.filter((row) => row.awaiting_approval).length;
					const amount =
						unresolved_lines || awaiting_approval
							? null
							: sum(snapshot.flatMap((row) => (row.amount === null ? [] : [row.amount]))).round(
									minorDigits(group.currency)
								);
					return hash({
						owner: group.owner,
						period,
						currency: group.currency,
						snapshot
					}).pipe(
						Effect.map((calculation_hash) => {
							const latest = statements
								.filter(
									(s) =>
										s.owner === group.owner && s.period === period && s.currency === group.currency
								)
								.sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true }))[0];
							return {
								owner: group.owner,
								owner_name: users.find((u) => u.id === group.owner)?.name ?? group.owner,
								period,
								currency: group.currency,
								order_count: new Set(snapshot.map((row) => row.order)).size,
								amount,
								calculation_hash,
								snapshot,
								unresolved_lines,
								awaiting_approval,
								latest_amount: latest?.amount ?? null,
								latest_statement: latest?.id ?? null,
								state: awaiting_approval
									? ('awaiting_approval' as const)
									: unresolved_lines
										? ('unresolved' as const)
										: !latest
											? ('unacknowledged' as const)
											: latest.calculation_hash === calculation_hash
												? ('current' as const)
												: ('changed' as const)
							};
						})
					);
				})
			),
		{ concurrency: 'unbounded' }
	);
});
/** The monthly commission board: per salesperson and currency, the amount to sign off and how it stands. */
export const commissionBoard = (
	answer: ReadAnswer<ReturnType<typeof boardRead>>,
	period: PlainDate
) =>
	monthlyCommission(
		answer.orders.rows,
		answer.commission_statements.rows,
		answer.sys_user.rows,
		period,
		answer.source_sales_lines.rows
	).pipe(
		Effect.map((rows) =>
			rows.map(({ snapshot, ...row }) => ({ ...row, period: PlainDate(row.period) }))
		)
	);
/** The first day of `on`'s month: the period a board and a statement name. */
export const monthOf = (on: string) => PlainDate(on.slice(0, 7) + '-01');
