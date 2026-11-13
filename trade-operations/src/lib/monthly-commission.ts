import { Effect } from 'effect';
import { addMonths, minorDigits, round, sum, text } from './values.js';
import {
	commissionCalculation,
	commissionFactFields,
	reportFields,
	reportLayers,
	reportPages,
	type ReportReader,
	type CommissionFact,
	type ReportOrder
} from './reports.js';
import { type Id, type ReadAnswer, type Row } from '@norbital-ai/bolt';
import { hash } from './commercial.js';
type MonthlyOrder = ReportOrder;
/** The fields a statement's sign-off compares (the board and the statement create read them). */
const statementFields = [
	'number',
	'owner',
	'period',
	'currency',
	'calculation_hash',
	'amount'
] as const;
/** The board's read for one month (`period`, its first day): sales orders, statements, salespeople and sales facts. */
export const boardRead = (
	period: string,
	commercial = false,
	owner?: Id<'sys_user'>,
	limit = 200
) =>
	({
		commission_statements: {
			where: { period: { eq: period }, ...(owner ? { owner: { eq: owner } } : {}) },
			fields: statementFields,
			limit
		},
		sys_user: {
			output: 'directory',
			fields: ['name'],
			...(owner ? { where: { id: { eq: owner } } } : {})
		},
		source_sales_lines: {
			...(commercial ? { output: 'commercial' as const } : {}),
			where: {
				active: { eq: true },
				kind: { in: ['shipment', 'return'] },
				business_on: { gte: period, lt: addMonths(period, 1) },
				order: { is: { direction: { eq: 'sales' }, ...(owner ? { owner: { eq: owner } } : {}) } }
			},
			fields: commissionFactFields,
			limit,
			order: { fields: reportFields, ...reportLayers }
		}
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
		if (
			!fact.active ||
			fact.kind === 'invoice' ||
			fact.business_on.slice(0, 7) !== period.slice(0, 7)
		)
			continue;
		const order = orders.find((order) => order.id === fact.order);
		if (!order || order.direction !== 'sales' || order.status !== 'confirmed') continue;
		const key = `${order.owner}:${order.currency}`;
		const group = groups.get(key) ?? { owner: order.owner, currency: order.currency, orders: [] };
		if (!group.orders.some((existing) => existing.id === order.id)) group.orders.push(order);
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
				group.orders.sort((a, b) => a.id.localeCompare(b.id)),
				(order) => {
					const actual = facts
						.filter(
							(fact) =>
								fact.active &&
								fact.kind !== 'invoice' &&
								fact.order === order.id &&
								fact.business_on.slice(0, 7) === period.slice(0, 7)
						)
						.sort((a, b) => a.id.localeCompare(b.id));
					return commissionCalculation(order, actual).pipe(
						Effect.map((current) => ({
							order: order.id,
							number: order.number,
							calculation_hash: current.calculation_hash,
							amount: current.amount === null ? null : text(current.amount),
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
							: text(
									round(
										sum(snapshot.flatMap((row) => (row.amount === null ? [] : [row.amount]))),
										minorDigits(group.currency)
									)
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
								owner_name: users.find((u) => u.id === group.owner)?.name ?? '—',
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
								latest_number: latest?.number ?? null,
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
type BoardRead = ReturnType<typeof boardRead>;
type BoardAnswer = ReadAnswer<BoardRead>;
export const readCommissionBoard = <E>(
	reader: ReportReader<E>,
	request: BoardRead,
	first: BoardAnswer
) =>
	Effect.all(
		{
			facts: reportPages(first.source_sales_lines, (after) =>
				Effect.map(
					reader.query({
						source_sales_lines: { ...request.source_sales_lines, after }
					}),
					(page) => page.source_sales_lines
				)
			),
			statements: reportPages(first.commission_statements, (after) =>
				Effect.map(
					reader.query({
						commission_statements: { ...request.commission_statements, after }
					}),
					(page) => page.commission_statements
				)
			),
			users: reportPages(first.sys_user, (after) =>
				Effect.map(
					reader.query({
						sys_user: { ...request.sys_user, after }
					}),
					(page) => page.sys_user
				)
			)
		},
		{ concurrency: 3 }
	);

export const calculateBoard = (
	facts: BoardAnswer['source_sales_lines']['rows'],
	statements: BoardAnswer['commission_statements']['rows'],
	users: BoardAnswer['sys_user']['rows'],
	period: string
) => {
	const orders = new Map(facts.flatMap(({ order }) => (order ? [[order.id, order] as const] : [])));
	return monthlyCommission(
		[...orders.values()],
		statements,
		users,
		period,
		facts.map((fact) => ({ ...fact, order: fact.order?.id ?? null }))
	);
};

/** The monthly commission board: per salesperson and currency, the amount to sign off and how it stands. */
export const commissionBoard = (answer: BoardAnswer, period: string) =>
	calculateBoard(
		answer.source_sales_lines.rows,
		answer.commission_statements.rows,
		answer.sys_user.rows,
		period
	).pipe(Effect.map((rows) => rows.map(({ snapshot, ...row }) => row)));
export const completeCommissionBoard = <E>(
	reader: ReportReader<E>,
	request: BoardRead,
	first: BoardAnswer,
	period: string
) =>
	readCommissionBoard(reader, request, first).pipe(
		Effect.flatMap(({ facts, statements, users }) =>
			calculateBoard(facts, statements, users, period)
		),
		Effect.map((rows) => rows.map(({ snapshot, ...row }) => row))
	);
/** The first day of `on`'s month: the period a board and a statement name. */
export const monthOf = (on: string) => on.slice(0, 7) + '-01';
