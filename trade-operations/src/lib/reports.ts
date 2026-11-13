import { BigDecimal, Effect, Option, Result, Schema, Stream } from 'effect';
import {
	agreement,
	agreements,
	executableAgreement,
	agreementFields,
	withAgreement,
	type AgreementOrder
} from './agreements.js';
import {
	commissionContext,
	evaluateCommission,
	DEFAULT_COMMISSION_EXPRESSION,
	COMMISSION_ENGINE
} from './commission-expressions.js';
import type {
	Cursor,
	Id,
	PlainDate,
	Page,
	ReadAnswer,
	ReadRequest,
	ReadRequestBase,
	Row,
	Where
} from '@norbital-ai/bolt';
import { hash } from './commercial.js';
import { commercialSalesFields } from './sales-fact-fields.js';
import { type D, dec, div, minorDigits, round, sum, text } from './values.js';
/** The order fields the commission and report helpers read. */
export const reportFields = [
	...agreementFields,
	'number',
	'direction',
	'owner',
	'currency'
] as const;
type CommissionOrder = AgreementOrder & Pick<Row<'orders'>, 'id' | 'direction' | 'currency'>;
export type CommissionFact = Pick<
	Row<'source_sales_lines'>,
	| 'id'
	| 'order'
	| 'seal_hash'
	| 'order_line'
	| 'kind'
	| 'unit'
	| 'quantity'
	| 'currency'
	| 'net_amount'
	| 'active'
	| 'business_on'
>;
export const commissionFactFields = [
	'order',
	'seal_hash',
	'order_line',
	'kind',
	'unit',
	'quantity',
	'currency',
	'net_amount',
	'active',
	'business_on'
] as const;
function commissionLines(
	record: CommissionOrder,
	seal?: string,
	actual?: readonly CommissionFact[]
) {
	const version = seal ? agreement(record, seal) : executableAgreement(record);
	if (!version) return [];
	const order = {
		...withAgreement(record, version),
		...(actual ? { status: 'confirmed' as const } : {})
	};
	if (!order.sealed_snapshot || order.direction !== 'sales' || order.status !== 'confirmed')
		return [];
	const snapshot = order.sealed_snapshot;
	const rule = order.sealed_commission;
	const entries = actual
		? actual.map((fact) => ({
				line: snapshot.lines.find((line) => line.id === fact.order_line),
				fact
			}))
		: snapshot.lines.map((line) => ({ line, fact: undefined }));
	return entries.map(({ line, fact }) => {
		const orderLine = line?.id ?? fact?.order_line;
		const rawQuantity = fact?.quantity ?? line?.quantity;
		if (orderLine === undefined || rawQuantity === undefined)
			throw new Error('No commission source line');
		const base = {
			order_line: orderLine,
			product: line?.product_name ?? '',
			quantity: dec(rawQuantity),
			basis_unit: rule?.basis_unit ?? '',
			spread: null,
			amount: null
		};
		if (
			!line ||
			(fact &&
				(fact.net_amount === null || fact.unit !== line.unit || fact.currency !== order.currency))
		)
			return { ...base, reason: 'expression_error' as const };
		if (!rule) return { ...base, reason: 'rule_missing' as const };
		const quantity = fact ? text(BigDecimal.abs(dec(fact.quantity))) : line.quantity;
		const factNet = fact?.net_amount;
		if (fact && factNet == null) return { ...base, reason: 'expression_error' as const };
		const net = factNet == null ? line.net : text(BigDecimal.abs(dec(factNet)));
		const evaluated = Result.try(() => {
			if (rule.engine_version && rule.engine_version !== COMMISSION_ENGINE)
				throw new Error('Unknown commission engine');
			const factor =
				line.commission_factor &&
				BigDecimal.isPositive(dec(line.commission_factor)) &&
				line.commission_basis_unit === rule.basis_unit
					? line.commission_factor
					: null;
			const context = commissionContext({
				quantity,
				net,
				floor_net: line.floor_net || null,
				factor,
				product_code: line.product_code,
				product_name: line.product_name,
				unit: line.unit,
				currency: order.currency,
				ordered_on: order.ordered_on,
				party_code: snapshot.party_code,
				fixed_rate: rule.fixed_rate,
				spread_pct: rule.spread_pct,
				parameters: rule.parameters ?? []
			});
			const result = evaluateCommission(
				rule.eligibility_expression ?? 'true',
				rule.amount_expression ?? DEFAULT_COMMISSION_EXPRESSION,
				context
			);
			const spread =
				line.floor_net && factor
					? round(
							div(BigDecimal.subtract(div(net, quantity, 18), dec(line.floor_net)), factor, 18),
							8
						)
					: null;
			return {
				...base,
				spread,
				amount: round(
					fact?.kind === 'return' ? BigDecimal.negate(result.amount) : result.amount,
					minorDigits(order.currency)
				),
				reason: result.eligible ? ('resolved' as const) : ('ineligible' as const)
			};
		});
		if (Result.isSuccess(evaluated)) return evaluated.success;
		{
			const reason =
				rule.amount_expression && rule.amount_expression !== DEFAULT_COMMISSION_EXPRESSION
					? ('expression_error' as const)
					: !line.floor_net
						? ('floor_missing' as const)
						: !line.commission_factor || !BigDecimal.isPositive(dec(line.commission_factor))
							? ('conversion_missing' as const)
							: line.commission_basis_unit !== rule.basis_unit
								? ('unit_mismatch' as const)
								: ('expression_error' as const);
			return { ...base, reason };
		}
	});
}
export type ReportOrder = Pick<Row<'orders'>, 'id' | (typeof reportFields)[number]>;
function commissionRows(orders: readonly ReportOrder[], selectedVersion?: number | null) {
	return orders.flatMap((record) => {
		const version =
			selectedVersion == null
				? executableAgreement(record)
				: agreements(record).find((v) => v.version === selectedVersion);
		if (selectedVersion != null && !version) return [];
		const order = version ? withAgreement(record, version) : record;
		return commissionLines(order, version?.seal_hash).map(
			({ order_line, quantity, spread, amount, ...line }) => ({
				...line,
				quantity: text(quantity),
				spread: spread && text(spread),
				amount: amount && text(amount),
				owner_name: '',
				order: order.id,
				number: order.number,
				owner: order.owner,
				ordered_on: order.ordered_on,
				currency: order.currency
			})
		);
	});
}
export class AgreementUnavailable extends Schema.TaggedError<AgreementUnavailable>()(
	'AgreementUnavailable',
	{ message: Schema.String }
) {}
export const commissionCalculation = Effect.fnUntraced(function* (
	record: CommissionOrder,
	seal?: string,
	actual?: readonly CommissionFact[]
) {
	const version = seal ? agreement(record, seal) : executableAgreement(record);
	if (seal && !version)
		return yield* new AgreementUnavailable({ message: 'Approved contract version unavailable' });
	const order = version ? withAgreement(record, version) : record;
	const lines = commissionLines(order, seal, actual);
	const unresolved_lines = lines.filter((line) => line.amount === null).length;
	const amount = unresolved_lines
		? null
		: round(
				sum(lines.flatMap((line) => (line.amount === null ? [] : [line.amount]))),
				minorDigits(order.currency)
			);
	const snapshot = {
		seal_hash: order.seal_hash ?? '',
		eligible: actual ? Boolean(version) : Boolean(executableAgreement(record)),
		lines: lines.map((line) => ({
			order_line: line.order_line,
			product: line.product,
			quantity: text(line.quantity),
			basis_unit: line.basis_unit,
			spread: line.spread && text(line.spread),
			amount: line.amount && text(line.amount),
			reason: line.reason
		}))
	};
	return {
		calculation_hash: yield* hash({
			snapshot,
			rule: order.sealed_commission,
			...(actual ? { actual } : {})
		}),
		amount,
		unresolved_lines,
		snapshot
	};
});
/** The commission report's read: open and confirmed sales orders with their seals, and salesperson names. */
export const commissionRead = {
	orders: {
		where: { direction: { eq: 'sales' }, status: { in: ['draft', 'confirmed'] } },
		fields: reportFields
	},
	sys_user: { output: 'directory', fields: ['name'] }
} as const;
/** Commission per sealed line of the read orders (one order when `order` is named), for a version or the executable one. */
export function commissionReport(
	answer: ReadAnswer<typeof commissionRead>,
	input: { order?: Id<'orders'> | null; version?: number | null } = {}
) {
	const names = new Map(answer.sys_user.rows.map((u) => [u.id, u.name]));
	return commissionRows(
		answer.orders.rows.filter((o) => !input.order || o.id === input.order),
		input.version
	).map((row) => ({ ...row, owner_name: names.get(row.owner) ?? '' }));
}
/**
 * The sales read: active source sales lines, each with its sealed sales order (party name and line products), product
 * and salesperson names.
 */
export const salesRead = {
	source_sales_lines: {
		where: { active: { eq: true }, kind: { ne: 'invoice' } },
		fields: [...commercialSalesFields, 'booked_cost', 'booked_cost_currency'],
		order: {
			where: { direction: { eq: 'sales' }, seal_hash: { is_null: false } },
			fields: [...agreementFields, 'number', 'party', 'owner', 'currency'],
			party: { fields: ['name'] },
			lines: { fields: ['product'] }
		}
	},
	products: { fields: ['name'] },
	sys_user: { output: 'directory', fields: ['name'] }
} as const;
export const commercialSalesRead = {
	...salesRead,
	source_sales_lines: {
		...salesRead.source_sales_lines,
		output: 'commercial',
		fields: commercialSalesFields
	}
} as const;
type FullSalesAnswer = ReadAnswer<typeof salesRead>;
type FullSalesFact = FullSalesAnswer['source_sales_lines']['rows'][number];
type CostFields = 'booked_cost' | 'booked_cost_currency';
type ReportFact = Omit<FullSalesFact, CostFields> & Partial<Pick<FullSalesFact, CostFields>>;
type SalesAnswer = Omit<FullSalesAnswer, 'source_sales_lines' | 'products'> & {
	products?: FullSalesAnswer['products'];
	source_sales_lines: { readonly rows: readonly ReportFact[] };
};
export type SalesBasis = 'invoice' | 'delivery';
type SalesRange = {
	readonly from?: string | null;
	readonly to?: string | null;
	readonly basis?: SalesBasis;
};
const kindsOnBasis = {
	invoice: ['invoice', 'invoice_only'],
	delivery: ['shipment', 'return']
} as const satisfies Record<SalesBasis, readonly Row<'source_sales_lines'>['kind'][]>;
export function salesReadDuring(
	range: { from: PlainDate | null; to: PlainDate | null; basis: SalesBasis },
	commercial = false,
	limit = 10_000
) {
	const where = {
		active: { eq: true },
		kind: { in: kindsOnBasis[range.basis] },
		...(range.from || range.to
			? {
					business_on: {
						...(range.from ? { gte: range.from } : {}),
						...(range.to ? { lte: range.to } : {})
					}
				}
			: {})
	};
	const read = commercial ? commercialSalesRead : salesRead;
	return {
		...read,
		source_sales_lines: {
			...read.source_sales_lines,
			where,
			limit,
			order_by: [{ business_on: 'desc' }, { reference: 'asc' }] as const
		}
	};
}
class ReportRowsChanged extends Schema.TaggedError<ReportRowsChanged>()('ReportRowsChanged', {}) {}

export const reportPages = <A extends { readonly id: string }, E>(
	first: Page<A> & { readonly total: number },
	read: (after: Cursor) => Effect.Effect<Page<A>, E>
) =>
	Stream.paginate(null as Cursor | null, (after) =>
		Effect.map(
			after === null ? Effect.succeed(first) : read(after),
			(page) => [page.rows, Option.fromNullOr(page.next)] as const
		)
	).pipe(
		Stream.runCollect,
		Effect.flatMap((rows) =>
			rows.length === first.total && new Set(rows.map((row) => row.id)).size === rows.length
				? Effect.succeed(rows)
				: Effect.fail(new ReportRowsChanged())
		)
	);

export type ReportReader<E> = {
	query<const R extends ReadRequestBase>(request: ReadRequest<R>): Effect.Effect<ReadAnswer<R>, E>;
};
type SalesReportRead = ReturnType<typeof salesReadDuring>;
export const readSalesReport = <E>(
	reader: ReportReader<E>,
	request: SalesReportRead,
	first: ReadAnswer<SalesReportRead>,
	basis: SalesBasis
) => {
	const { products, sys_user, ...facts } = request;
	return Effect.all(
		{
			source_sales_lines: reportPages(first.source_sales_lines, (after) =>
				Effect.map(
					reader.query({ ...facts, source_sales_lines: { ...facts.source_sales_lines, after } }),
					(page) => page.source_sales_lines
				)
			),
			products: reportPages(first.products, (after) =>
				Effect.map(reader.query({ products: { ...products, after } }), (page) => page.products)
			),
			sys_user: reportPages(first.sys_user, (after) =>
				Effect.map(reader.query({ sys_user: { ...sys_user, after } }), (page) => page.sys_user)
			)
		},
		{ concurrency: 3 }
	).pipe(
		Effect.map((rows) =>
			salesDetail(
				{
					source_sales_lines: { rows: rows.source_sales_lines },
					products: { ...first.products, rows: rows.products, next: null },
					sys_user: { ...first.sys_user, rows: rows.sys_user, next: null }
				},
				{ basis }
			)
		)
	);
};

const inRange = (on: string, range: SalesRange) =>
	!(range.from && on < range.from) && !(range.to && on > range.to);
const onSalesBasis = (kind: Row<'source_sales_lines'>['kind'], basis?: SalesBasis) =>
	basis === undefined ? kind !== 'invoice' : kindsOnBasis[basis].some((value) => value === kind);
const standalone = (source: ReportFact) =>
	source.kind === 'invoice_only' && !source.order ? source.source_dimensions : null;
const sourceOwner = (source: ReportFact) => {
	const employee = standalone(source)?.employee_id;
	return employee && employee !== '0' ? `${source.source}:${employee}` : String(source.source);
};
function salesFacts(answer: SalesAnswer, range: SalesRange) {
	const rows = answer.source_sales_lines.rows.filter(
		(source) => onSalesBasis(source.kind, range.basis) && inRange(source.business_on, range)
	);
	if (range.basis !== 'invoice') return rows.filter((source) => !standalone(source));
	// A reclassified source line may appear in both feeds until the next full reconciliation.
	const linked = new Set(
		rows.flatMap((source) => {
			const detail =
				source.kind === 'invoice' &&
				source.order &&
				/^invoice:\d+:(\d+)$/.exec(source.external_code)?.[1];
			return detail ? [`${source.source}:invoice-only:${detail}`] : [];
		})
	);
	return rows.filter(
		(source) => !standalone(source) || !linked.has(`${source.source}:${source.external_code}`)
	);
}
/** Net sales after the agreed freight treatment, `null` while a needed amount is unknown. */
function bookedNet(
	net: string | null,
	freight: string | null,
	treatment: Row<'orders'>['freight_treatment']
) {
	if (net === null) return null;
	if (treatment !== 'deduct') return dec(net);
	return freight === null ? null : BigDecimal.subtract(dec(net), dec(freight));
}
/** Monthly sales and returns by currency and salesperson (an inverted range reads nothing). */
export function salesAnalysis(answer: SalesAnswer, range: SalesRange = {}) {
	const byUser = new Map(answer.sys_user.rows.map((u) => [u.id, u.name]));
	const groups = new Map<
		string,
		{
			currency: Row<'orders'>['currency'];
			owner: Row<'orders'>['owner'] | null;
			owner_name: string;
			period: Row<'source_sales_lines'>['business_on'];
			freight_treatment: Row<'orders'>['freight_treatment'] | null;
			orderIds: Set<string>;
			source_lines: number;
			unresolved_lines: number;
			net: D | null;
			source_net: D | null;
			tax: D | null;
			total: D | null;
			freight: D | null;
		}
	>();
	for (const source of salesFacts(answer, range)) {
		const record = source.order;
		const version = record ? agreement(record, source.seal_hash) : undefined;
		const order = record && version ? withAgreement(record, version) : undefined;
		const dimensions = standalone(source);
		if (!order && !dimensions) continue;
		const denomination = order?.currency ?? source.currency;
		const treatment = order?.freight_treatment ?? null;
		const period = source.business_on.slice(0, 7) + '-01';
		const key = JSON.stringify([
			denomination,
			order?.owner ?? sourceOwner(source),
			period,
			treatment
		]);
		const group = groups.get(key) ?? {
			currency: denomination,
			owner: order?.owner ?? null,
			owner_name: (order ? byUser.get(order.owner) : dimensions?.employee) ?? '',
			period,
			freight_treatment: treatment,
			orderIds: new Set<string>(),
			source_lines: 0,
			unresolved_lines: 0,
			net: dec(0),
			source_net: dec(0),
			tax: dec(0),
			total: dec(0),
			freight: dec(0)
		};
		const net = source.net_amount,
			tax = source.tax_amount,
			freight = source.freight;
		const booked = treatment ? bookedNet(net, freight, treatment) : null;
		if (order) group.orderIds.add(order.id);
		group.source_lines++;
		if (net === null || tax === null || freight === null) group.unresolved_lines++;
		group.net = group.net === null || booked === null ? null : BigDecimal.sum(group.net, booked);
		group.source_net =
			group.source_net === null || net === null ? null : BigDecimal.sum(group.source_net, dec(net));
		group.tax = group.tax === null || tax === null ? null : BigDecimal.sum(group.tax, dec(tax));
		group.freight =
			group.freight === null || freight === null
				? null
				: BigDecimal.sum(group.freight, dec(freight));
		group.total =
			group.total === null || net === null || tax === null
				? null
				: BigDecimal.sum(BigDecimal.sum(group.total, dec(net)), dec(tax));
		groups.set(key, group);
	}
	return [...groups.values()]
		.map(({ orderIds, ...row }) => ({
			...row,
			orders: orderIds.size,
			net: row.net && text(round(row.net, minorDigits(row.currency))),
			source_net: row.source_net && text(round(row.source_net, minorDigits(row.currency))),
			tax: row.tax && text(round(row.tax, minorDigits(row.currency))),
			total: row.total && text(round(row.total, minorDigits(row.currency))),
			freight: row.freight && text(round(row.freight, minorDigits(row.currency)))
		}))
		.sort(
			(a, b) =>
				b.period.localeCompare(a.period) ||
				a.currency.localeCompare(b.currency) ||
				(a.owner ?? a.owner_name).localeCompare(b.owner ?? b.owner_name) ||
				(a.freight_treatment ?? '').localeCompare(b.freight_treatment ?? '')
		);
}
/** Sales and returns per source line for the selected dates, priced against the seal each line names. */
export function salesDetail(answer: SalesAnswer, range: SalesRange = {}) {
	const byProduct = new Map((answer.products?.rows ?? []).map((row) => [row.id, row.name]));
	const byUser = new Map(answer.sys_user.rows.map((row) => [row.id, row.name]));
	return salesFacts(answer, range)
		.flatMap((source) => {
			const record = source.order;
			const version = record ? agreement(record, source.seal_hash) : undefined;
			const order = record && version ? withAgreement(record, version) : undefined;
			const dimensions = standalone(source);
			if (!order && !dimensions) return [];
			const sealed = version?.snapshot.lines.find((item) => item.id === source.order_line);
			const line = order?.lines.find((row) => row.id === source.order_line);
			const net = source.net_amount,
				tax = source.tax_amount,
				freight = source.freight;
			const treatment = order?.freight_treatment ?? null;
			const denomination = order?.currency ?? source.currency;
			const booked = treatment ? bookedNet(net, freight, treatment) : null;
			const digits = minorDigits(denomination);
			const legacyCost =
				source.lot_number && source.unit_cost !== null
					? BigDecimal.multiply(dec(source.unit_cost), dec(source.quantity))
					: null;
			const bookedCost = source.booked_cost == null ? null : dec(source.booked_cost);
			const cost = bookedCost ?? legacyCost;
			const costCurrency =
				bookedCost !== null
					? (source.booked_cost_currency ?? null)
					: legacyCost !== null
						? denomination
						: null;
			return [
				{
					order: order?.id ?? null,
					product: answer.products?.rows.find((p) => p.id === sealed?.product)?.id ?? null,
					party: order?.party?.id ?? null,
					owner: order?.owner ?? null,
					source_owner: dimensions ? sourceOwner(source) : null,
					sold_price:
						net === null || BigDecimal.isZero(dec(source.quantity))
							? null
							: text(div(net, source.quantity, 8)),
					floor_net: sealed?.floor_net || null,
					order_number: order?.number ?? '',
					party_name: order?.party?.name ?? dimensions?.customer ?? '',
					product_name:
						sealed?.product_name ??
						(line ? byProduct.get(line.product) : dimensions?.product) ??
						'',
					owner_name: (order ? byUser.get(order.owner) : dimensions?.employee) ?? '',
					reference: source.reference,
					external_code: source.external_code,
					business_on: source.business_on,
					kind: source.kind,
					unit: source.unit,
					quantity: source.quantity,
					lot_number: source.lot_number,
					cost: cost !== null && costCurrency ? text(round(cost, minorDigits(costCurrency))) : null,
					cost_currency: costCurrency,
					margin:
						cost !== null && costCurrency === denomination && booked !== null
							? text(round(BigDecimal.subtract(booked, cost), digits))
							: null,
					currency: denomination,
					freight_treatment: treatment,
					source_net: net,
					net: booked && text(round(booked, digits)),
					tax,
					freight,
					total:
						net === null || tax === null
							? null
							: text(round(BigDecimal.sum(dec(net), dec(tax)), digits))
				}
			];
		})
		.sort(
			(a, b) =>
				b.business_on.localeCompare(a.business_on) ||
				a.reference.localeCompare(b.reference) ||
				a.external_code.localeCompare(b.external_code)
		);
}
/** The aging read on `as_of`: issued invoices with their order, and the active payments settled by then. */
const salesReceivable = { order: { is: { direction: { eq: 'sales' } } } } as const;
export const agingRead = (
	as_of: PlainDate,
	covered: readonly Id<'sys_integration'>[] = [],
	limit = 10_000
) =>
	({
		transactions: {
			where: {
				...salesReceivable,
				...(covered.length ? { not: { source: { in: covered } } } : {}),
				kind: { eq: 'invoice' },
				status: { eq: 'issued' },
				issued_on: { lte: as_of }
			},
			fields: ['source', 'order', 'reference', 'currency', 'total', 'issued_on', 'due_on'],
			limit,
			order: { fields: ['number', 'party', 'party_name', 'ledger'], ledger: { fields: ['name'] } }
		},
		source_payments: {
			where: {
				...salesReceivable,
				...(covered.length ? { not: { source: { in: covered } } } : {}),
				settled_on: { lte: as_of },
				active: { eq: true }
			},
			fields: ['source', 'order', 'invoice', 'reference', 'currency', 'amount', 'settled_on'],
			limit,
			order: { fields: ['number', 'party', 'party_name', 'ledger'], ledger: { fields: ['name'] } }
		}
	}) as const;
type AgingAnswer = ReadAnswer<ReturnType<typeof agingRead>>;
export const receivablesRead = {
	source_receivables: {
		fields: ['source', 'currency', 'observed_at', 'entries'],
		source: { fields: ['name'] }
	}
} as const;
type ReceivablesSnapshot = ReadAnswer<typeof receivablesRead>['source_receivables']['rows'][number];

export const receivablesHeadRead = {
	source_receivables: { fields: ['source', 'observed_at'] }
} as const;
export const readReceivablesReport = <E>(reader: ReportReader<E>) =>
	Effect.gen(function* () {
		const request = {
			...receivablesRead,
			source_receivables: { ...receivablesRead.source_receivables, limit: 1 }
		};
		const first = yield* reader.query(request);
		return yield* reportPages(first.source_receivables, (after) =>
			Effect.map(
				reader.query({ ...request, source_receivables: { ...request.source_receivables, after } }),
				(page) => page.source_receivables
			)
		);
	});

export const readAgingReport = <E>(
	reader: ReportReader<E>,
	request: ReturnType<typeof agingRead>,
	first: AgingAnswer,
	cutoff: PlainDate,
	snapshots: readonly ReceivablesSnapshot[]
) =>
	Effect.all(
		{
			transactions: reportPages(first.transactions, (after) =>
				Effect.map(
					reader.query({ transactions: { ...request.transactions, after } }),
					(page) => page.transactions
				)
			),
			source_payments: reportPages(first.source_payments, (after) =>
				Effect.map(
					reader.query({ source_payments: { ...request.source_payments, after } }),
					(page) => page.source_payments
				)
			)
		},
		{ concurrency: 2 }
	).pipe(
		Effect.map((rows) =>
			agingDetails(
				{
					transactions: { ...first.transactions, rows: rows.transactions, next: null },
					source_payments: { ...first.source_payments, rows: rows.source_payments, next: null }
				},
				cutoff,
				snapshots
			)
		)
	);

const AGING = [
	[0, 'not_due'],
	[30, '1_30'],
	[60, '31_60'],
	[90, '61_90'],
	[Infinity, 'over_90']
] as const;
export const agingBuckets = [
	'not_due',
	'1_30',
	'31_60',
	'61_90',
	'over_90',
	'no_due_date'
] as const;
const zero = '0';
const add = (a: string, b: string) => text(BigDecimal.sum(dec(a), dec(b)));
function agingBucket(due: PlainDate | null, cutoff: PlainDate): AgingBucket {
	if (due === null) return 'no_due_date';
	const days = Math.floor(
		(Date.parse(cutoff + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) / 86400000
	);
	return AGING.find(([threshold]) => days <= threshold)?.[1] ?? 'over_90';
}
const agingAccount = (
	order: NonNullable<AgingAnswer['transactions']['rows'][number]['order']>,
	source: Id<'sys_integration'>
) => ({
	order: order.id,
	order_number: order.number,
	party: order.party,
	party_name: order.party_name ?? '',
	ledger: order.ledger?.id ?? source,
	ledger_name: order.ledger?.name ?? ''
});
/** Open issued invoices by due date. Only linked source settlements reduce an invoice. */
export function arAging(answer: AgingAnswer, as_of: PlainDate) {
	const paidByInvoice = new Map<string, D>();
	for (const payment of answer.source_payments.rows)
		if (payment.invoice) {
			paidByInvoice.set(
				payment.invoice,
				BigDecimal.sum(paidByInvoice.get(payment.invoice) ?? dec(0), dec(payment.amount))
			);
		}
	return answer.transactions.rows.flatMap((invoice) => {
		const order = invoice.order;
		if (!order || invoice.total === null) return [];
		const total = dec(invoice.total);
		const raw = BigDecimal.subtract(total, paidByInvoice.get(invoice.id) ?? dec(0));
		if (BigDecimal.isZero(raw)) return [];
		const balance = BigDecimal.isNegative(raw) ? zero : text(raw);
		const credit =
			BigDecimal.isNegative(total) && BigDecimal.isNegative(raw)
				? text(BigDecimal.negate(raw))
				: zero;
		const overpaid =
			!BigDecimal.isNegative(total) && BigDecimal.isNegative(raw)
				? text(BigDecimal.negate(raw))
				: zero;
		return [
			{
				...agingAccount(order, invoice.source),
				contact_id: null,
				invoice: invoice.id,
				reference: invoice.reference,
				currency: invoice.currency,
				issued_on: invoice.issued_on,
				due_on: invoice.due_on,
				settled_on: null,
				as_of,
				balance,
				overpaid,
				credit,
				unapplied: zero,
				bucket: agingBucket(invoice.due_on, as_of)
			}
		];
	});
}
/** The AR contact is the balance identity. Settlements after the cutoff restore its earlier position. */
export function receivablesDetails(snapshots: readonly ReceivablesSnapshot[], as_of: PlainDate) {
	return snapshots.flatMap((snapshot) =>
		snapshot.entries.flatMap((entry) => {
			if (!snapshot.source || entry.business_on > as_of) return [];
			const amount = round(
				sum([
					entry.remaining,
					...entry.settlements
						.filter((settlement) => settlement.on > as_of)
						.map((settlement) => settlement.amount)
				]),
				minorDigits(snapshot.currency)
			);
			if (BigDecimal.isZero(amount)) return [];
			const receipt = entry.kind === 'receipt';
			return [
				{
					order: null,
					contact_id: entry.contact_id,
					order_number: '',
					party: entry.customer_id,
					party_name: entry.customer,
					ledger: snapshot.source.id,
					ledger_name: snapshot.source.name,
					invoice: null,
					reference: entry.reference,
					currency: snapshot.currency,
					issued_on: receipt ? null : entry.business_on,
					due_on: receipt ? null : (entry.due_on ?? null),
					settled_on: receipt ? entry.business_on : null,
					as_of,
					balance: receipt || BigDecimal.isNegative(amount) ? zero : text(amount),
					overpaid: zero,
					credit:
						!receipt && BigDecimal.isNegative(amount) ? text(BigDecimal.negate(amount)) : zero,
					unapplied: receipt ? text(amount) : zero,
					bucket: receipt ? ('unapplied' as const) : agingBucket(entry.due_on ?? null, as_of)
				}
			];
		})
	);
}
export function agingDetails(
	answer: AgingAnswer,
	as_of: PlainDate,
	snapshots: readonly ReceivablesSnapshot[] = []
): AgingDetail[] {
	const covered = new Set(snapshots.flatMap((snapshot) => snapshot.source?.id ?? []));
	return [
		...receivablesDetails(snapshots, as_of),
		...arAging(answer, as_of).filter((invoice) => !covered.has(invoice.ledger)),
		...answer.source_payments.rows.flatMap((payment) =>
			payment.invoice || !payment.order || covered.has(payment.source)
				? []
				: [
						{
							...agingAccount(payment.order, payment.source),
							contact_id: null,
							invoice: null,
							reference: payment.reference,
							currency: payment.currency,
							issued_on: null,
							due_on: null,
							settled_on: payment.settled_on,
							as_of,
							balance: zero,
							overpaid: zero,
							credit: zero,
							unapplied: payment.amount,
							bucket: 'unapplied' as const
						}
					]
		)
	];
}
type AgingDetail = {
	order: Id<'orders'> | null;
	order_number: string;
	party: string;
	party_name: string;
	ledger: Id<'sys_integration'>;
	ledger_name: string;
	contact_id: string | null;
	invoice: Id<'transactions'> | null;
	reference: string;
	currency: Row<'transactions'>['currency'];
	issued_on: PlainDate | null;
	due_on: PlainDate | null;
	settled_on: PlainDate | null;
	as_of: PlainDate;
	balance: string;
	overpaid: string;
	credit: string;
	unapplied: string;
	bucket: AgingBucket | 'unapplied';
};
export const agingGroup = (row: AgingDetail) =>
	JSON.stringify([row.ledger, row.party, row.currency]);
type AgingEstimate = {
	estimated_applied: string | null;
	estimated_balance: string | null;
};

/** Apply the SalesBridge estimate to complete account snapshots within one customer, ledger and currency. */
export function estimateAging(details: readonly AgingDetail[]) {
	const groups = new Map<string, { invoices: { row: AgingDetail; id: bigint }[]; available: D }>();
	for (const row of details) {
		if (row.contact_id === null) continue;
		const key = agingGroup(row);
		const group = groups.get(key) ?? { invoices: [], available: dec(0) };
		if (BigDecimal.isPositive(dec(row.balance)))
			group.invoices.push({ row, id: BigInt(row.contact_id) });
		group.available = BigDecimal.sum(
			BigDecimal.sum(group.available, dec(row.unapplied)),
			dec(row.credit)
		);
		groups.set(key, group);
	}
	const estimates = new Map<AgingDetail, AgingEstimate>();
	for (const group of groups.values()) {
		let available = BigDecimal.isNegative(group.available) ? dec(0) : group.available;
		group.invoices.sort((a, b) => {
			if (a.row.due_on !== b.row.due_on) {
				if (a.row.due_on === null) return 1;
				if (b.row.due_on === null) return -1;
				return a.row.due_on.localeCompare(b.row.due_on);
			}
			return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
		});
		for (const { row: invoice } of group.invoices) {
			const balance = dec(invoice.balance);
			const applied = BigDecimal.isLessThan(balance, available) ? balance : available;
			available = BigDecimal.subtract(available, applied);
			estimates.set(invoice, {
				estimated_applied: text(applied),
				estimated_balance: text(BigDecimal.subtract(balance, applied))
			});
		}
	}
	return details.map((row) => {
		const estimate =
			row.contact_id !== null && BigDecimal.isPositive(dec(row.credit))
				? { estimated_applied: text(BigDecimal.negate(dec(row.credit))), estimated_balance: zero }
				: estimates.get(row);
		return { estimated_applied: null, estimated_balance: null, ...row, ...estimate };
	});
}

type AgingBucket = (typeof agingBuckets)[number];
type AgingSummary = Pick<AgingDetail, 'party_name' | 'ledger_name' | 'currency' | 'as_of'> &
	Record<AgingBucket, string> & {
		group: string;
		balance: string;
		overpaid: string;
		credit: string;
		unapplied: string;
		net: string;
		estimated_balance: string | null;
	};
/** The account net always uses actual balances. Estimated amounts only affect the invoice buckets. */
export function agingSummary(details: readonly (AgingDetail & Partial<AgingEstimate>)[]) {
	const groups = new Map<string, AgingSummary>();
	for (const row of details) {
		const group = agingGroup(row);
		const summary = groups.get(group) ?? {
			group,
			party_name: row.party_name,
			ledger_name: row.ledger_name,
			currency: row.currency,
			as_of: row.as_of,
			balance: zero,
			overpaid: zero,
			credit: zero,
			unapplied: zero,
			net: zero,
			estimated_balance: null,
			not_due: zero,
			'1_30': zero,
			'31_60': zero,
			'61_90': zero,
			over_90: zero,
			no_due_date: zero
		};
		summary.balance = add(summary.balance, row.balance);
		summary.overpaid = add(summary.overpaid, row.overpaid);
		summary.credit = add(summary.credit, row.credit);
		summary.unapplied = add(summary.unapplied, row.unapplied);
		if (row.estimated_balance != null)
			summary.estimated_balance = add(summary.estimated_balance ?? zero, row.estimated_balance);
		if (row.bucket !== 'unapplied')
			summary[row.bucket] = add(summary[row.bucket], row.estimated_balance ?? row.balance);
		groups.set(group, summary);
	}
	return [...groups.values()]
		.map((row) => ({
			...row,
			net: text(
				[row.unapplied, row.overpaid, row.credit].reduce(
					(net, amount) => BigDecimal.subtract(net, dec(amount)),
					dec(row.balance)
				)
			)
		}))
		.sort(
			(a, b) =>
				a.party_name.localeCompare(b.party_name) ||
				a.currency.localeCompare(b.currency) ||
				a.ledger_name.localeCompare(b.ledger_name)
		);
}
/** The payment ledger's read: payments and refunds (of one order, settled by `as_of`), with order, party and invoice. */
export function ledgerRead(input: { order?: Id<'orders'> | null; as_of?: PlainDate | null } = {}) {
	const where: Where<'source_payments'> = {
		...(input.order ? { order: { eq: input.order } } : {}),
		...(input.as_of ? { settled_on: { lte: input.as_of } } : {})
	};
	return {
		source_payments: {
			where,
			fields: ['order', 'invoice', 'reference', 'currency', 'amount', 'settled_on', 'active'],
			order: { fields: ['number', 'party'], party: { fields: ['name'] } },
			invoice: { fields: ['reference'] }
		}
	} as const;
}
/** Payments and refunds, newest first: active ones (withdrawn too when asked), or only those no invoice applies. */
export function paymentLedger(
	answer: ReadAnswer<ReturnType<typeof ledgerRead>>,
	input: { unapplied?: boolean; include_withdrawn?: boolean } = {}
) {
	return answer.source_payments.rows
		.filter((p) => (p.active || input.include_withdrawn) && (!input.unapplied || !p.invoice))
		.map((p) => ({
			order: p.order?.id ?? null,
			order_number: p.order?.number ?? '',
			party_name: p.order?.party?.name ?? '',
			invoice: p.invoice?.id ?? null,
			invoice_number: p.invoice?.reference ?? '',
			reference: p.reference,
			currency: p.currency,
			amount: p.amount,
			settled_on: p.settled_on,
			state: p.active ? ('active' as const) : ('withdrawn' as const),
			source_payment: p.id
		}))
		.sort(
			(a, b) => b.settled_on.localeCompare(a.settled_on) || a.reference.localeCompare(b.reference)
		);
}
