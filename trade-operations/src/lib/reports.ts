import { BigDecimal, DateTime, Duration, Effect, Option, Result, Schema, Stream } from 'effect';
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
import { hash, numeric } from './commercial.js';
import { commercialSalesFields } from './sales-fact-fields.js';
import { earliestReceivablesCutoff } from './receivables.js';
import { earliestPayablesCutoff } from './payables.js';
import {
	currencyDigits,
	fixedDecimal,
	purchasePaymentStatus,
	type PurchasePaymentStatus
} from './purchase-listing.js';
/** The order fields the commission and report helpers read. */
export const reportFields = [
	'number',
	'direction',
	'status',
	'owner',
	'currency',
	'ordered_on',
	'freight_treatment',
	'commission'
] as const;
const reportLineFields = [
	'product',
	'product_code',
	'product_name',
	'unit',
	'quantity',
	'net',
	'floor_net',
	'commission_factor',
	'commission_basis_unit'
] as const;
/** The order layers the commission and sales helpers read: its party's code and its lines. */
export const reportLayers = {
	party: { fields: ['external_code'] },
	lines: { fields: reportLineFields }
} as const;
export type ReportOrder = Pick<Row<'orders'>, 'id' | (typeof reportFields)[number]> & {
	readonly party: Pick<Row<'parties'>, 'external_code'> | null;
	readonly lines: readonly Pick<Row<'order_lines'>, 'id' | (typeof reportLineFields)[number]>[];
};
export type CommissionFact = Pick<
	Row<'source_sales_lines'>,
	| 'id'
	| 'order'
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
	'order_line',
	'kind',
	'unit',
	'quantity',
	'currency',
	'net_amount',
	'active',
	'business_on'
] as const;
/** Commission per line of a confirmed sales order: its quoted lines, or the `actual` source facts against them. */
function commissionLines(order: ReportOrder, actual?: readonly CommissionFact[]) {
	if (order.direction !== 'sales' || order.status !== 'confirmed') return [];
	const rule = order.commission;
	const entries = actual
		? actual.map((fact) => ({
				line: order.lines.find((line) => line.id === fact.order_line),
				fact
			}))
		: order.lines.map((line) => ({ line, fact: undefined }));
	return entries.map(({ line, fact }) => {
		const orderLine = line?.id ?? fact?.order_line;
		const rawQuantity = fact?.quantity ?? line?.quantity;
		if (orderLine === undefined || orderLine === null || rawQuantity === undefined)
			throw new Error('No commission source line');
		const base = {
			order_line: orderLine,
			product: line?.product_name ?? '',
			quantity: rawQuantity,
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
		const quantity = fact
			? BigDecimal.format(BigDecimal.abs(BigDecimal.fromStringUnsafe(fact.quantity)))
			: line.quantity;
		const factNet = fact?.net_amount;
		if (fact && factNet == null) return { ...base, reason: 'expression_error' as const };
		const net =
			factNet == null
				? line.net
				: BigDecimal.format(BigDecimal.abs(BigDecimal.fromStringUnsafe(factNet)));
		const floorNet = line.floor_net;
		const evaluated = Result.try(() => {
			if (rule.engine_version && rule.engine_version !== COMMISSION_ENGINE)
				throw new Error('Unknown commission engine');
			const factor =
				line.commission_factor !== null &&
				BigDecimal.isPositive(BigDecimal.fromStringUnsafe(line.commission_factor)) &&
				line.commission_basis_unit === rule.basis_unit
					? line.commission_factor
					: null;
			const context = commissionContext({
				quantity,
				net,
				floor_net: floorNet,
				factor,
				product_code: line.product_code,
				product_name: line.product_name,
				unit: line.unit,
				currency: order.currency,
				ordered_on: order.ordered_on,
				party_code: order.party?.external_code ?? '',
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
				floorNet && factor
					? BigDecimal.round(
							BigDecimal.divideUnsafe(
								BigDecimal.subtract(
									BigDecimal.round(
										BigDecimal.divideUnsafe(
											BigDecimal.fromStringUnsafe(net),
											BigDecimal.fromStringUnsafe(quantity)
										),
										{ scale: 18 }
									),
									BigDecimal.fromStringUnsafe(floorNet)
								),
								BigDecimal.fromStringUnsafe(factor)
							),
							{ scale: 8 }
						)
					: null;
			return {
				...base,
				spread,
				amount: BigDecimal.round(
					fact?.kind === 'return' ? BigDecimal.negate(result.amount) : result.amount,
					{
						scale:
							new Intl.NumberFormat('en', {
								style: 'currency',
								currency: order.currency
							}).resolvedOptions().maximumFractionDigits ?? 2
					}
				),
				reason: result.eligible ? ('resolved' as const) : ('ineligible' as const)
			};
		});
		if (Result.isSuccess(evaluated)) return evaluated.success;
		{
			const reason =
				rule.amount_expression && rule.amount_expression !== DEFAULT_COMMISSION_EXPRESSION
					? ('expression_error' as const)
					: !floorNet
						? ('floor_missing' as const)
						: line.commission_factor === null ||
							  !BigDecimal.isPositive(BigDecimal.fromStringUnsafe(line.commission_factor))
							? ('conversion_missing' as const)
							: line.commission_basis_unit !== rule.basis_unit
								? ('unit_mismatch' as const)
								: ('expression_error' as const);
			return { ...base, reason };
		}
	});
}
export const commissionCalculation = Effect.fnUntraced(function* (
	order: ReportOrder,
	actual?: readonly CommissionFact[]
) {
	const lines = commissionLines(order, actual);
	const unresolved_lines = lines.filter((line) => line.amount === null).length;
	const amount = unresolved_lines
		? null
		: BigDecimal.round(
				BigDecimal.sumAll(lines.flatMap((line) => (line.amount === null ? [] : [line.amount]))),
				{
					scale:
						new Intl.NumberFormat('en', {
							style: 'currency',
							currency: order.currency
						}).resolvedOptions().maximumFractionDigits ?? 2
				}
			);
	const snapshot = {
		eligible: order.status === 'confirmed',
		lines: lines.map((line) => ({
			order_line: line.order_line,
			product: line.product,
			quantity: line.quantity,
			basis_unit: line.basis_unit,
			spread:
				line.spread &&
				new Intl.NumberFormat('en', {
					useGrouping: false,
					minimumFractionDigits: 8,
					maximumFractionDigits: 8
				}).format(numeric(BigDecimal.format(line.spread))),
			amount:
				line.amount &&
				new Intl.NumberFormat('en', {
					useGrouping: false,
					minimumFractionDigits: line.amount.scale,
					maximumFractionDigits: line.amount.scale
				}).format(numeric(BigDecimal.format(line.amount))),
			reason: line.reason
		}))
	};
	return {
		calculation_hash: yield* hash({
			snapshot,
			rule: order.commission,
			...(actual ? { actual } : {})
		}),
		amount,
		unresolved_lines,
		snapshot
	};
});
/**
 * The sales read: active source sales lines, each with its confirmed sales order (party name and lines), product and
 * salesperson names.
 */
export const salesRead = {
	source_sales_lines: {
		where: { active: { eq: true }, kind: { ne: 'invoice' } },
		fields: [...commercialSalesFields, 'booked_cost', 'booked_cost_currency'],
		order: {
			where: { direction: { eq: 'sales' }, status: { eq: 'confirmed' } },
			fields: [
				'number',
				'party',
				'owner',
				'currency',
				'freight_treatment',
				'ordered_on',
				'kingdee'
			],
			party: { fields: ['name', 'region', 'related_party'] },
			lines: { fields: ['product', 'product_code', 'product_name', 'floor_net'] }
		}
	},
	products: { fields: ['name', 'category'] },
	parties: { fields: ['source', 'external_code', 'region', 'related_party'] },
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
type SalesPartyLookup = Pick<
	Row<'parties'>,
	'source' | 'external_code' | 'region' | 'related_party'
>;
type SalesAnswer = Omit<FullSalesAnswer, 'source_sales_lines' | 'products' | 'parties'> & {
	products?: FullSalesAnswer['products'];
	parties?: { readonly rows: readonly SalesPartyLookup[] };
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
	Stream.paginate<Cursor | null, A, E>(null, (after) =>
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
	const { products, parties, sys_user, ...facts } = request;
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
			parties: reportPages(first.parties, (after) =>
				Effect.map(reader.query({ parties: { ...parties, after } }), (page) => page.parties)
			),
			sys_user: reportPages(first.sys_user, (after) =>
				Effect.map(reader.query({ sys_user: { ...sys_user, after } }), (page) => page.sys_user)
			)
		},
		{ concurrency: 4 }
	).pipe(
		Effect.map((rows) =>
			salesDetail(
				{
					source_sales_lines: { rows: rows.source_sales_lines },
					products: { ...first.products, rows: rows.products, next: null },
					parties: { rows: rows.parties },
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
	if (treatment !== 'deduct') return BigDecimal.fromStringUnsafe(net);
	return freight === null
		? null
		: BigDecimal.subtract(BigDecimal.fromStringUnsafe(net), BigDecimal.fromStringUnsafe(freight));
}
/** Sales and returns per source line for the selected dates, priced against its order line. */
export function salesDetail(answer: SalesAnswer, range: SalesRange = {}) {
	const byUser = new Map(answer.sys_user.rows.map((row) => [row.id, row.name]));
	const byProduct = new Map((answer.products?.rows ?? []).map((row) => [row.id, row]));
	const byPartyCode = new Map(
		(answer.parties?.rows ?? []).map((row) => [`${row.source}:${row.external_code}`, row])
	);
	return salesFacts(answer, range)
		.flatMap((source) => {
			const order = source.order ?? undefined;
			const dimensions = standalone(source);
			if (!order && !dimensions) return [];
			const line = order?.lines.find((row) => row.id === source.order_line);
			const product = line ? byProduct.get(line.product) : undefined;
			const standaloneParty =
				!order && dimensions?.customer_id
					? byPartyCode.get(`${source.source}:${dimensions.customer_id}`)
					: undefined;
			const net = source.net_amount,
				tax = source.tax_amount,
				freight = source.freight;
			const treatment = order?.freight_treatment ?? null;
			const denomination = order?.currency ?? source.currency;
			const booked = treatment ? bookedNet(net, freight, treatment) : null;
			const digits = currencyDigits(denomination);
			const lotCost =
				source.lot_number && source.unit_cost !== null
					? BigDecimal.multiply(
							BigDecimal.fromStringUnsafe(source.unit_cost),
							BigDecimal.fromStringUnsafe(source.quantity)
						)
					: null;
			const bookedCost =
				source.booked_cost == null ? null : BigDecimal.fromStringUnsafe(source.booked_cost);
			const cost = bookedCost ?? lotCost;
			const costCurrency =
				bookedCost !== null
					? (source.booked_cost_currency ?? null)
					: lotCost !== null
						? denomination
						: null;
			const costDigits = costCurrency ? currencyDigits(costCurrency) : null;
			// the margin is in the cost's currency: a foreign sale meets its base-currency cost at its Kingdee rate
			const rate = order?.kingdee?.exchange_rate;
			const costedNet =
				booked === null || costCurrency === null
					? null
					: costCurrency === denomination
						? booked
						: rate
							? BigDecimal.multiply(booked, BigDecimal.fromStringUnsafe(rate))
							: null;
			const margin =
				cost !== null && costedNet !== null && costDigits !== null
					? BigDecimal.round(BigDecimal.subtract(costedNet, cost), { scale: costDigits })
					: null;
			return [
				{
					order: order?.id ?? null,
					order_line: source.order_line ?? null,
					ordered_on: order?.ordered_on ?? null,
					product_code: line?.product_code ?? null,
					product: product?.id ?? null,
					product_category: product?.category ?? dimensions?.product_category ?? null,
					party: order?.party?.id ?? null,
					party_region:
						order?.party?.region ?? standaloneParty?.region ?? dimensions?.customer_region ?? null,
					related_party: order?.party?.related_party ?? standaloneParty?.related_party ?? false,
					owner: order?.owner ?? null,
					source_owner: dimensions ? sourceOwner(source) : null,
					sold_price:
						net === null || BigDecimal.isZero(BigDecimal.fromStringUnsafe(source.quantity))
							? null
							: new Intl.NumberFormat('en', {
									useGrouping: false,
									minimumFractionDigits: 8,
									maximumFractionDigits: 8
								}).format(
									numeric(
										BigDecimal.format(
											BigDecimal.round(
												BigDecimal.divideUnsafe(
													BigDecimal.fromStringUnsafe(net),
													BigDecimal.fromStringUnsafe(source.quantity)
												),
												{ scale: 8 }
											)
										)
									)
								),
					floor_net: line?.floor_net ?? null,
					order_number: order?.number ?? '',
					party_name: order?.party?.name ?? dimensions?.customer ?? '',
					product_name: line?.product_name ?? dimensions?.product ?? '',
					owner_name: (order ? byUser.get(order.owner) : dimensions?.employee) ?? '',
					reference: source.reference,
					external_code: source.external_code,
					business_on: source.business_on,
					kind: source.kind,
					unit: source.unit,
					quantity: source.quantity,
					lot_number: source.lot_number,
					lot_unit_cost: source.unit_cost,
					cost:
						costDigits === null || cost === null
							? null
							: new Intl.NumberFormat('en', {
									useGrouping: false,
									minimumFractionDigits: costDigits,
									maximumFractionDigits: costDigits
								}).format(
									numeric(BigDecimal.format(BigDecimal.round(cost, { scale: costDigits })))
								),
					cost_currency: costCurrency,
					margin:
						margin &&
						new Intl.NumberFormat('en', {
							useGrouping: false,
							minimumFractionDigits: costDigits ?? digits,
							maximumFractionDigits: costDigits ?? digits
						}).format(numeric(BigDecimal.format(margin))),
					// the margin over the booked net (net after a deducted freight), in percent
					margin_rate:
						margin && costedNet && !BigDecimal.isZero(costedNet)
							? BigDecimal.format(
									BigDecimal.round(
										BigDecimal.divideUnsafe(
											BigDecimal.multiply(margin, BigDecimal.fromBigInt(100n)),
											costedNet
										),
										{ scale: 1 }
									)
								)
							: null,
					currency: denomination,
					freight_treatment: treatment,
					source_net: net,
					net:
						booked &&
						new Intl.NumberFormat('en', {
							useGrouping: false,
							minimumFractionDigits: digits,
							maximumFractionDigits: digits
						}).format(numeric(BigDecimal.format(BigDecimal.round(booked, { scale: digits })))),
					tax,
					freight,
					total:
						net === null || tax === null
							? null
							: new Intl.NumberFormat('en', {
									useGrouping: false,
									minimumFractionDigits: digits,
									maximumFractionDigits: digits
								}).format(
									numeric(
										BigDecimal.format(
											BigDecimal.round(
												BigDecimal.sum(
													BigDecimal.fromStringUnsafe(net),
													BigDecimal.fromStringUnsafe(tax)
												),
												{ scale: digits }
											)
										)
									)
								)
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
/** The issued invoices of `orders` and the active payments against them: what each sales line was billed and collected. */
export const salesCollectionRead = (orders: readonly Id<'orders'>[]) =>
	({
		transactions: {
			where: { order: { in: orders }, kind: { eq: 'invoice' }, status: { eq: 'issued' } },
			fields: ['order', 'reference', 'issued_on', 'due_on', 'total', 'items'],
			limit: 10_000
		},
		source_payments: {
			where: { order: { in: orders }, active: { eq: true } },
			fields: ['invoice', 'amount', 'settled_on'],
			limit: 10_000
		}
	}) as const;
type CollectionAnswer = ReadAnswer<ReturnType<typeof salesCollectionRead>>;
export type Collection = 'uninvoiced' | 'unpaid' | 'partial' | 'paid';
/**
 * Each sales line with its invoices (an invoice line's own; a delivery's, by its order line and lot), their latest
 * dates and how far they are collected. A line with no order has no invoice to follow.
 */
export function salesCollection<R extends ReturnType<typeof salesDetail>[number]>(
	rows: readonly R[],
	answer: CollectionAnswer
) {
	const settled = new Map<string, { amount: BigDecimal.BigDecimal; on: PlainDate }>();
	for (const payment of answer.source_payments.rows) {
		if (!payment.invoice) continue;
		const prior = settled.get(payment.invoice);
		settled.set(payment.invoice, {
			amount: BigDecimal.sum(
				prior?.amount ?? BigDecimal.fromBigInt(0n),
				BigDecimal.fromStringUnsafe(payment.amount)
			),
			on: prior && prior.on > payment.settled_on ? prior.on : payment.settled_on
		});
	}
	const byOrder = Map.groupBy(answer.transactions.rows, (invoice) => invoice.order);
	const latest = (dates: readonly (PlainDate | null)[]) =>
		dates.reduce<PlainDate | null>((max, on) => (on && (!max || on > max) ? on : max), null);
	return rows.map((row) => {
		const invoices = (row.order ? (byOrder.get(row.order) ?? []) : []).filter((invoice) =>
			row.kind === 'invoice' || row.kind === 'invoice_only'
				? invoice.reference === row.reference.slice(0, row.reference.lastIndexOf('/'))
				: invoice.items?.some(
						(item) =>
							item.order_line_id === row.order_line &&
							(!row.lot_number || !item.lot_number || item.lot_number === row.lot_number)
					)
		);
		const billed = BigDecimal.sumAll(
			invoices.flatMap((invoice) =>
				invoice.total ? [BigDecimal.fromStringUnsafe(invoice.total)] : []
			)
		);
		const collected = BigDecimal.sumAll(
			invoices.flatMap((invoice) => {
				const paid = settled.get(invoice.id);
				return paid ? [paid.amount] : [];
			})
		);
		const collection: Collection | null = !row.order
			? null
			: invoices.length === 0
				? 'uninvoiced'
				: !BigDecimal.isPositive(collected)
					? 'unpaid'
					: BigDecimal.isLessThan(collected, billed)
						? 'partial'
						: 'paid';
		return {
			...row,
			invoice_numbers: invoices.map((invoice) => invoice.reference).join(', '),
			invoiced_on: latest(invoices.map((invoice) => invoice.issued_on)),
			due_on: latest(invoices.map((invoice) => invoice.due_on)),
			collection,
			collected_on:
				collection === 'paid'
					? latest(invoices.map((invoice) => settled.get(invoice.id)?.on ?? null))
					: null
		};
	});
}
/** The purchase side of `lots`: their audited receipts and the purchase invoices billing them. */
export const purchaseChainRead = (lots: readonly string[]) =>
	({
		source_purchase_lines: {
			where: {
				lot_number: { in: lots },
				kind: { in: ['receipt', 'invoice'] },
				active: { eq: true }
			},
			fields: [
				'kind',
				'external_code',
				'upstream',
				'reference',
				'business_on',
				'supplier_name',
				'product_code',
				'lot_number',
				'quantity',
				'net_amount',
				'order_reference',
				'billed_amount',
				'open_amount',
				'paid_on'
			],
			limit: 10_000
		}
	}) as const;
type PurchaseLine = ReadAnswer<
	ReturnType<typeof purchaseChainRead>
>['source_purchase_lines']['rows'][number];
export type SupplierPayment = 'uninvoiced' | 'unpaid' | 'partial' | 'paid';
/**
 * Each sold line with where its lot came from: the purchase orders and suppliers that received it, its purchase
 * price (receipt cost over quantity), its first receipt, the purchase invoices billing those receipts and how far
 * the supplier is paid. A line with no lot, or a lot no audited receipt names, has no chain.
 */
export function purchaseChain<
	R extends { readonly product_code: string | null; readonly lot_number: string | null }
>(rows: readonly R[], lines: readonly PurchaseLine[]) {
	const byLot = Map.groupBy(lines, (line) => `${line.product_code}:${line.lot_number}`);
	const distinct = (values: readonly (string | null)[]) =>
		[...new Set(values.flatMap((value) => (value ? [value] : [])))].join(', ');
	const extreme = (
		dates: readonly (PlainDate | null)[],
		before: (a: PlainDate, b: PlainDate) => boolean
	) =>
		dates.reduce<PlainDate | null>(
			(found, on) => (on && (!found || before(on, found)) ? on : found),
			null
		);
	const sum = (values: readonly string[]) =>
		BigDecimal.sumAll(values.map((value) => BigDecimal.fromStringUnsafe(value)));
	return rows.map((row) => {
		const lot =
			row.product_code && row.lot_number
				? (byLot.get(`${row.product_code}:${row.lot_number}`) ?? [])
				: [];
		const receipts = lot.filter((line) => line.kind === 'receipt');
		const received = new Set(receipts.map((line) => line.external_code));
		// a payable belongs to its invoice: one per invoice number
		const invoices = [
			...new Map(
				lot
					.filter(
						(line) =>
							line.kind === 'invoice' && line.upstream !== null && received.has(line.upstream)
					)
					.map((line) => [line.reference, line])
			).values()
		];
		const quantity = sum(receipts.map((line) => line.quantity));
		const costs = receipts.flatMap((line) => (line.net_amount === null ? [] : [line.net_amount]));
		const open = invoices.map((line) => line.open_amount ?? line.billed_amount);
		const payment: SupplierPayment | null = !receipts.length
			? null
			: !invoices.length
				? 'uninvoiced'
				: open.every(
							(value) => value !== null && BigDecimal.isZero(BigDecimal.fromStringUnsafe(value))
					  )
					? 'paid'
					: invoices.every(
								(line) =>
									line.open_amount !== null &&
									line.billed_amount !== null &&
									BigDecimal.equals(
										BigDecimal.fromStringUnsafe(line.open_amount),
										BigDecimal.fromStringUnsafe(line.billed_amount)
									)
						  )
						? 'unpaid'
						: 'partial';
		return {
			...row,
			order_reference: distinct(receipts.map((line) => line.order_reference)),
			supplier: distinct(receipts.map((line) => line.supplier_name)),
			purchase_price:
				costs.length === receipts.length && receipts.length && !BigDecimal.isZero(quantity)
					? BigDecimal.format(
							BigDecimal.round(BigDecimal.divideUnsafe(sum(costs), quantity), { scale: 4 })
						)
					: null,
			first_received_on: extreme(
				receipts.map((line) => line.business_on),
				(a, b) => a < b
			),
			purchase_invoices: distinct(invoices.map((line) => line.reference)),
			purchase_invoiced_on: extreme(
				invoices.map((line) => line.business_on),
				(a, b) => a > b
			),
			supplier_payment: payment,
			supplier_paid_on:
				payment === 'paid'
					? extreme(
							invoices.map((line) => line.paid_on),
							(a, b) => a > b
						)
					: null
		};
	});
}
/** The aging read on `as_of`: issued invoices with their order, and the active payments settled by then. */
const agingDirection = (direction: 'sales' | 'purchasing') =>
	({ order: { is: { direction: { eq: direction } } } }) as const;
export const agingRead = (
	as_of: PlainDate,
	covered: readonly Id<'sys_integration'>[] = [],
	limit = 10_000,
	direction: 'sales' | 'purchasing' = 'sales'
) =>
	({
		transactions: {
			where: {
				...agingDirection(direction),
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
				...agingDirection(direction),
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

/** Each ledger's receivables snapshot without its entries: which ledgers it covers, and when it was taken. */
export const receivablesHeadRead = {
	source_receivables: { fields: ['source', 'observed_at'], source: { fields: ['name'] } }
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

/** Every aging page, read beside the ledgers' receivables `snapshots`, as the aging entries on `cutoff`. */
export const readAgingReport = <E>(
	reader: ReportReader<E>,
	request: ReturnType<typeof agingRead>,
	first: AgingAnswer,
	cutoff: PlainDate,
	snapshots: Effect.Effect<readonly ReceivablesSnapshot[], E>
) =>
	Effect.all(
		{
			snapshots,
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
		{ concurrency: 3 }
	).pipe(
		Effect.map((rows) =>
			agingDetails(
				{
					transactions: { ...first.transactions, rows: rows.transactions, next: null },
					source_payments: { ...first.source_payments, rows: rows.source_payments, next: null }
				},
				cutoff,
				rows.snapshots
			)
		)
	);

/**
 * The aging entries on `as_of` and the receivables snapshot heads they used (`receivables`: the reader holds them).
 * `rows` is null for a cutoff before the snapshots' account history starts.
 */
export const readAgingAt = <E>(reader: ReportReader<E>, as_of: PlainDate, receivables: boolean) =>
	Effect.gen(function* () {
		const heads = receivables
			? (yield* reader.query(receivablesHeadRead)).source_receivables.rows
			: [];
		if (heads.length > 0 && as_of < earliestReceivablesCutoff) return { heads, rows: null };
		const request = agingRead(as_of, [...new Set(heads.flatMap((head) => head.source?.id ?? []))]);
		const [first, snapshots] = yield* Effect.all(
			[
				reader.query(request),
				heads.length > 0 ? readReceivablesReport(reader) : Effect.succeed([])
			],
			{ concurrency: 2 }
		);
		return {
			heads,
			rows: yield* readAgingReport(reader, request, first, as_of, Effect.succeed(snapshots))
		};
	});
const AGING = [
	[0, 'not_due'],
	[30, '1_30'],
	[60, '31_60'],
	[90, '61_90'],
	[Infinity, 'over_90']
] as const;
export const agingBuckets = ['not_due', '1_30', '31_60', '61_90', 'over_90'] as const;
const zero = '0';
/** An invoice with no due date cannot be overdue: it is not due. */
function agingBucket(due: PlainDate | null, cutoff: PlainDate): AgingBucket {
	if (due === null) return 'not_due';
	const days = Duration.toDays(
		DateTime.distance(DateTime.makeUnsafe(due), DateTime.makeUnsafe(cutoff))
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
	const paidByInvoice = new Map<string, BigDecimal.BigDecimal>();
	for (const payment of answer.source_payments.rows)
		if (payment.invoice) {
			paidByInvoice.set(
				payment.invoice,
				BigDecimal.sum(
					paidByInvoice.get(payment.invoice) ?? BigDecimal.fromBigInt(0n),
					BigDecimal.fromStringUnsafe(payment.amount)
				)
			);
		}
	return answer.transactions.rows.flatMap((invoice) => {
		const order = invoice.order;
		if (!order || invoice.total === null) return [];
		const total = BigDecimal.fromStringUnsafe(invoice.total);
		const raw = BigDecimal.subtract(
			total,
			paidByInvoice.get(invoice.id) ?? BigDecimal.fromBigInt(0n)
		);
		if (BigDecimal.isZero(raw)) return [];
		const balance = BigDecimal.isNegative(raw)
			? zero
			: new Intl.NumberFormat('en', {
					useGrouping: false,
					minimumFractionDigits: raw.scale,
					maximumFractionDigits: raw.scale
				}).format(numeric(BigDecimal.format(raw)));
		const credit =
			BigDecimal.isNegative(total) && BigDecimal.isNegative(raw)
				? new Intl.NumberFormat('en', {
						useGrouping: false,
						minimumFractionDigits: raw.scale,
						maximumFractionDigits: raw.scale
					}).format(numeric(BigDecimal.format(BigDecimal.negate(raw))))
				: zero;
		const overpaid =
			!BigDecimal.isNegative(total) && BigDecimal.isNegative(raw)
				? new Intl.NumberFormat('en', {
						useGrouping: false,
						minimumFractionDigits: raw.scale,
						maximumFractionDigits: raw.scale
					}).format(numeric(BigDecimal.format(BigDecimal.negate(raw))))
				: zero;
		return [
			{
				...agingAccount(order, invoice.source),
				contact_id: null,
				settlement: null,
				delivered_on: null,
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
			const amount = BigDecimal.round(
				BigDecimal.sumAll(
					[
						entry.remaining,
						...entry.settlements
							.filter((settlement) => settlement.on > as_of)
							.map((settlement) => settlement.amount)
					].map(BigDecimal.fromStringUnsafe)
				),
				{
					scale:
						new Intl.NumberFormat('en', {
							style: 'currency',
							currency: snapshot.currency
						}).resolvedOptions().maximumFractionDigits ?? 2
				}
			);
			if (BigDecimal.isZero(amount)) return [];
			const receipt = entry.kind === 'receipt';
			return [
				{
					order: null,
					contact_id: entry.contact_id,
					settlement: receipt ? null : (entry.settlement ?? null),
					delivered_on: receipt ? null : (entry.delivered_on ?? null),
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
					balance:
						receipt || BigDecimal.isNegative(amount)
							? zero
							: new Intl.NumberFormat('en', {
									useGrouping: false,
									minimumFractionDigits: amount.scale,
									maximumFractionDigits: amount.scale
								}).format(numeric(BigDecimal.format(amount))),
					overpaid: zero,
					credit:
						!receipt && BigDecimal.isNegative(amount)
							? new Intl.NumberFormat('en', {
									useGrouping: false,
									minimumFractionDigits: amount.scale,
									maximumFractionDigits: amount.scale
								}).format(numeric(BigDecimal.format(BigDecimal.negate(amount))))
							: zero,
					unapplied: receipt
						? new Intl.NumberFormat('en', {
								useGrouping: false,
								minimumFractionDigits: amount.scale,
								maximumFractionDigits: amount.scale
							}).format(numeric(BigDecimal.format(amount)))
						: zero,
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
							settlement: null,
							delivered_on: null,
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
export type AgingDetail = {
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
	/** An account-wide entry's own settlement method and first delivery; a linked invoice has neither here. */
	settlement: string | null;
	delivered_on: PlainDate | null;
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
	const groups = new Map<
		string,
		{ invoices: { row: AgingDetail; id: bigint }[]; available: BigDecimal.BigDecimal }
	>();
	for (const row of details) {
		if (row.contact_id === null) continue;
		const key = agingGroup(row);
		const group = groups.get(key) ?? { invoices: [], available: BigDecimal.fromBigInt(0n) };
		if (BigDecimal.isPositive(BigDecimal.fromStringUnsafe(row.balance)))
			group.invoices.push({ row, id: BigInt(row.contact_id) });
		group.available = BigDecimal.sum(
			BigDecimal.sum(group.available, BigDecimal.fromStringUnsafe(row.unapplied)),
			BigDecimal.fromStringUnsafe(row.credit)
		);
		groups.set(key, group);
	}
	const estimates = new Map<AgingDetail, AgingEstimate>();
	for (const group of groups.values()) {
		let available = BigDecimal.isNegative(group.available)
			? BigDecimal.fromBigInt(0n)
			: group.available;
		group.invoices.sort((a, b) => {
			if (a.row.due_on !== b.row.due_on) {
				if (a.row.due_on === null) return 1;
				if (b.row.due_on === null) return -1;
				return a.row.due_on.localeCompare(b.row.due_on);
			}
			return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
		});
		for (const { row: invoice } of group.invoices) {
			const balance = BigDecimal.fromStringUnsafe(invoice.balance);
			const applied = BigDecimal.isLessThan(balance, available) ? balance : available;
			available = BigDecimal.subtract(available, applied);
			const remaining = BigDecimal.subtract(balance, applied);
			estimates.set(invoice, {
				estimated_applied: new Intl.NumberFormat('en', {
					useGrouping: false,
					minimumFractionDigits: applied.scale,
					maximumFractionDigits: applied.scale
				}).format(numeric(BigDecimal.format(applied))),
				estimated_balance: new Intl.NumberFormat('en', {
					useGrouping: false,
					minimumFractionDigits: remaining.scale,
					maximumFractionDigits: remaining.scale
				}).format(numeric(BigDecimal.format(remaining)))
			});
		}
	}
	return details.map((row) => {
		const estimate =
			row.contact_id !== null && BigDecimal.isPositive(BigDecimal.fromStringUnsafe(row.credit))
				? {
						estimated_applied: new Intl.NumberFormat('en', {
							useGrouping: false,
							minimumFractionDigits: BigDecimal.fromStringUnsafe(row.credit).scale,
							maximumFractionDigits: BigDecimal.fromStringUnsafe(row.credit).scale
						}).format(
							numeric(BigDecimal.format(BigDecimal.negate(BigDecimal.fromStringUnsafe(row.credit))))
						),
						estimated_balance: zero
					}
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
			over_90: zero
		};
		for (const field of ['balance', 'overpaid', 'credit', 'unapplied'] as const) {
			const total = BigDecimal.sum(
				BigDecimal.fromStringUnsafe(summary[field]),
				BigDecimal.fromStringUnsafe(row[field])
			);
			summary[field] = new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: total.scale,
				maximumFractionDigits: total.scale
			}).format(numeric(BigDecimal.format(total)));
		}
		if (row.estimated_balance != null) {
			const total = BigDecimal.sum(
				BigDecimal.fromStringUnsafe(summary.estimated_balance ?? zero),
				BigDecimal.fromStringUnsafe(row.estimated_balance)
			);
			summary.estimated_balance = new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: total.scale,
				maximumFractionDigits: total.scale
			}).format(numeric(BigDecimal.format(total)));
		}
		if (row.bucket !== 'unapplied') {
			const total = BigDecimal.sum(
				BigDecimal.fromStringUnsafe(summary[row.bucket]),
				BigDecimal.fromStringUnsafe(row.estimated_balance ?? row.balance)
			);
			summary[row.bucket] = new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: total.scale,
				maximumFractionDigits: total.scale
			}).format(numeric(BigDecimal.format(total)));
		}
		groups.set(group, summary);
	}
	return [...groups.values()]
		.map((row) => {
			const net = [row.unapplied, row.overpaid, row.credit].reduce(
				(net, amount) => BigDecimal.subtract(net, BigDecimal.fromStringUnsafe(amount)),
				BigDecimal.fromStringUnsafe(row.balance)
			);
			return {
				...row,
				net: new Intl.NumberFormat('en', {
					useGrouping: false,
					minimumFractionDigits: net.scale,
					maximumFractionDigits: net.scale
				}).format(numeric(BigDecimal.format(net)))
			};
		})
		.sort(
			(a, b) =>
				a.party_name.localeCompare(b.party_name) ||
				a.currency.localeCompare(b.currency) ||
				a.ledger_name.localeCompare(b.ledger_name)
		);
}
/** Each currency's customers owing past due on the aging cutoff, and the sum of their overdue buckets. */
export const overdueTotals = (summary: readonly AgingSummary[]) =>
	[...Map.groupBy(summary, (row) => row.currency)].flatMap(([currency, group]) => {
		const owed = group
			.map((row) =>
				BigDecimal.sumAll(
					(['1_30', '31_60', '61_90', 'over_90'] as const).map((bucket) =>
						BigDecimal.fromStringUnsafe(row[bucket])
					)
				)
			)
			.filter(BigDecimal.isPositive);
		return owed.length
			? [{ currency, customers: owed.length, overdue: BigDecimal.format(BigDecimal.sumAll(owed)) }]
			: [];
	});
/** Whole days `due` lies before `on`; zero when it is not past due or has no due date. */
export const daysOverdue = (due: PlainDate | null, on: PlainDate) =>
	due === null || due >= on
		? 0
		: Duration.toDays(DateTime.distance(DateTime.makeUnsafe(due), DateTime.makeUnsafe(on)));
/** Every customer's Kingdee credit position, with the party it names. */
export const creditRead = {
	credit_snapshots: {
		fields: ['source', 'currency', 'credit_limit', 'credit_used', 'credit_hold', 'as_of'],
		party: { fields: ['name', 'external_code'] },
		limit: 10_000
	}
} as const;
type CreditSnapshot = ReadAnswer<typeof creditRead>['credit_snapshots']['rows'][number];
/**
 * The customers needing credit attention `on` a day — held in Kingdee, over their limit, or with overdue invoices —
 * and those invoices. An aging entry names its customer by its order's party or by the ledger's own customer id (a
 * receivables snapshot's), which a party carries as its code; credit and overdue meet only in one currency.
 */
export function creditExceptions(
	snapshots: readonly CreditSnapshot[],
	aging: readonly AgingDetail[],
	on: PlainDate
) {
	const invoices = aging.flatMap((row) => {
		const days = row.bucket === 'unapplied' ? 0 : daysOverdue(row.due_on, on);
		return days > 0 && BigDecimal.isPositive(BigDecimal.fromStringUnsafe(row.balance))
			? [{ ...row, customer: `${row.ledger}:${row.party}:${row.currency}`, days_overdue: days }]
			: [];
	});
	const byCustomer = Map.groupBy(invoices, (row) => row.customer);
	const credit = snapshots.map((snapshot) => {
		const keys = [snapshot.party?.id, snapshot.party?.external_code].flatMap((id) =>
			id ? [`${snapshot.source}:${id}:${snapshot.currency}`] : []
		);
		const over =
			snapshot.credit_limit !== null && snapshot.credit_used !== null
				? BigDecimal.subtract(
						BigDecimal.fromStringUnsafe(snapshot.credit_used),
						BigDecimal.fromStringUnsafe(snapshot.credit_limit)
					)
				: null;
		return {
			keys,
			party_name: snapshot.party?.name ?? '',
			currency: snapshot.currency,
			held: snapshot.credit_hold,
			credit_limit: snapshot.credit_limit,
			credit_used: snapshot.credit_used,
			over_limit: over && BigDecimal.isPositive(over) ? BigDecimal.format(over) : null
		};
	});
	const named = new Set(credit.flatMap((row) => row.keys));
	// overdue customers no credit snapshot names, or in another currency than their credit
	const uncovered = [...byCustomer].flatMap(([key, [first]]) =>
		named.has(key) || !first
			? []
			: [
					{
						keys: [key],
						party_name: first.party_name,
						currency: first.currency,
						held: false,
						credit_limit: null,
						credit_used: null,
						over_limit: null
					}
				]
	);
	const customers = [...credit, ...uncovered]
		.map((row) => {
			const owed = row.keys.flatMap((key) => byCustomer.get(key) ?? []);
			return {
				...row,
				overdue: owed.length
					? BigDecimal.format(
							BigDecimal.sumAll(owed.map((invoice) => BigDecimal.fromStringUnsafe(invoice.balance)))
						)
					: null,
				oldest_overdue: owed.length
					? Math.max(...owed.map((invoice) => invoice.days_overdue))
					: null
			};
		})
		.flatMap((row) => {
			const reasons = [
				...(row.held ? (['held'] as const) : []),
				...(row.over_limit !== null ? (['over_limit'] as const) : []),
				...(row.overdue !== null ? (['overdue'] as const) : [])
			];
			return reasons.length ? [{ ...row, reasons }] : [];
		})
		.toSorted(
			(a, b) =>
				Number(b.held) - Number(a.held) ||
				(b.oldest_overdue ?? 0) - (a.oldest_overdue ?? 0) ||
				a.party_name.localeCompare(b.party_name)
		);
	const flagged = new Set(customers.flatMap((row) => row.keys));
	return { customers, invoices: invoices.filter((row) => flagged.has(row.customer)) };
}
/** Each currency's credit exceptions: how many customers, and what they owe past due and over their limits. */
export const creditTotals = (
	customers: readonly Pick<
		ReturnType<typeof creditExceptions>['customers'][number],
		'currency' | 'overdue' | 'over_limit'
	>[]
) =>
	[...Map.groupBy(customers, (row) => row.currency)].map(([currency, group]) => ({
		currency,
		customers: group.length,
		figures: (['overdue', 'over_limit'] as const).map((field) => ({
			field,
			value: BigDecimal.format(
				BigDecimal.sumAll(
					group.flatMap((row) => (row[field] ? [BigDecimal.fromStringUnsafe(row[field])] : []))
				)
			)
		}))
	}));
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

/* ── Payables aging (AP) ─────────────────────────────────────────────────────────────────── */

export const payablesRead = {
	source_payables: {
		fields: ['source', 'shard', 'currency', 'observed_at', 'entries', 'accruals'],
		source: { fields: ['name'] }
	}
} as const;
type PayablesSnapshot = ReadAnswer<typeof payablesRead>['source_payables']['rows'][number];

/** Each ledger's payables snapshot head (without entries): covered ledgers, timestamp and GL 2202.03 accruals. */
export const payablesHeadRead = {
	source_payables: {
		fields: ['source', 'shard', 'currency', 'observed_at', 'accruals'],
		source: { fields: ['name'] }
	}
} as const;

export const readPayablesReport = <E>(reader: ReportReader<E>) =>
	Effect.gen(function* () {
		const request = {
			...payablesRead,
			source_payables: { ...payablesRead.source_payables, limit: 1 }
		};
		const first = yield* reader.query(request);
		return yield* reportPages(first.source_payables, (after) =>
			Effect.map(
				reader.query({ ...request, source_payables: { ...request.source_payables, after } }),
				(page) => page.source_payables
			)
		);
	});

/** Roll back AP open-item balances to `as_of` using post-cutoff settlements; reuses `AgingDetail` and AR aging math. */
export function payablesDetails(
	snapshots: readonly PayablesSnapshot[],
	as_of: PlainDate
): (AgingDetail & { readonly entry_kind: 'invoice' | 'expense' | 'payment' })[] {
	return snapshots.flatMap((snapshot) =>
		snapshot.entries.flatMap((entry) => {
			if (!snapshot.source || entry.business_on > as_of) return [];
			const digits = currencyDigits(snapshot.currency);
			const amount = BigDecimal.round(
				BigDecimal.sumAll(
					[
						entry.remaining,
						...entry.settlements
							.filter((settlement) => settlement.on > as_of)
							.map((settlement) => settlement.amount)
					].map(BigDecimal.fromStringUnsafe)
				),
				{ scale: digits, mode: 'half-from-zero' }
			);
			if (BigDecimal.isZero(amount)) return [];
			const payment = entry.kind === 'payment';
			const formatted = (value: BigDecimal.BigDecimal) => fixedDecimal(value, digits);
			return [
				{
					order: null,
					contact_id: entry.contact_id,
					entry_kind: entry.kind,
					settlement: payment ? null : (entry.settlement ?? null),
					delivered_on: payment ? null : (entry.received_on ?? null),
					order_number: '',
					party: entry.supplier_id,
					party_name: entry.supplier,
					ledger: snapshot.source.id,
					ledger_name: snapshot.source.name,
					invoice: null,
					reference: entry.reference,
					currency: snapshot.currency,
					issued_on: payment ? null : entry.business_on,
					due_on: payment ? null : (entry.due_on ?? null),
					settled_on: payment ? entry.business_on : null,
					as_of,
					balance: payment || BigDecimal.isNegative(amount) ? zero : formatted(amount),
					overpaid: zero,
					credit:
						!payment && BigDecimal.isNegative(amount) ? formatted(BigDecimal.negate(amount)) : zero,
					unapplied: payment ? formatted(amount) : zero,
					bucket: payment ? ('unapplied' as const) : agingBucket(entry.due_on ?? null, as_of)
				}
			];
		})
	);
}

export type PayableAgingDetail = AgingDetail & {
	readonly entry_kind?: 'invoice' | 'expense' | 'payment';
};

export function payableAgingDetails(
	answer: AgingAnswer,
	as_of: PlainDate,
	snapshots: readonly PayablesSnapshot[] = []
): PayableAgingDetail[] {
	const covered = new Set(snapshots.flatMap((snapshot) => snapshot.source?.id ?? []));
	return [
		...payablesDetails(snapshots, as_of),
		...arAging(answer, as_of)
			.filter((invoice) => !covered.has(invoice.ledger))
			.map((invoice) => ({ ...invoice, entry_kind: 'invoice' as const })),
		...answer.source_payments.rows.flatMap((payment) =>
			payment.invoice || !payment.order || covered.has(payment.source)
				? []
				: [
						{
							...agingAccount(payment.order, payment.source),
							contact_id: null,
							entry_kind: 'payment' as const,
							settlement: null,
							delivered_on: null,
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

export type PayableAccrualSummary = {
	readonly ledger: Id<'sys_integration'>;
	readonly ledger_name: string;
	readonly currency: Row<'source_payables'>['currency'];
	readonly period: string;
	readonly amount: string;
};

/**
 * Payables aging entries on `as_of`, snapshot heads, GL 2202.03 accrued-not-invoiced period totals,
 * and the set of related-party keys (`${source}:${external_code}` and `${source}:${party_id}`).
 * `rows` is null for a cutoff before the snapshots' account history starts.
 */
export const readPayablesAgingAt = <E>(
	reader: ReportReader<E>,
	as_of: PlainDate,
	payables: boolean
) =>
	Effect.gen(function* () {
		const emptyHeads: ReadAnswer<typeof payablesHeadRead>['source_payables']['rows'] = [];
		const [heads, partyPage] = yield* Effect.all(
			[
				payables
					? reader.query(payablesHeadRead).pipe(Effect.map((a) => a.source_payables.rows))
					: Effect.succeed(emptyHeads),
				reader.query({
					parties: { fields: ['source', 'external_code', 'related_party'], limit: 10_000 }
				})
			],
			{ concurrency: 2 }
		);
		const relatedKeys = new Set<string>();
		for (const party of partyPage.parties.rows) {
			if (!party.related_party) continue;
			relatedKeys.add(`${party.source}:${party.external_code}`);
			relatedKeys.add(`${party.source}:${party.id}`);
		}
		const period = as_of.slice(0, 7);
		const accruals: PayableAccrualSummary[] = heads.flatMap((head) => {
			if (head.shard !== 0 || !head.source || !head.accruals) return [];
			const found = head.accruals.find((item) => item.period === period);
			return found
				? [
						{
							ledger: head.source.id,
							ledger_name: head.source.name,
							currency: head.currency,
							period: found.period,
							amount: found.amount
						}
					]
				: [];
		});
		if (heads.length > 0 && as_of < earliestPayablesCutoff)
			return { heads, rows: null, accruals, relatedKeys };
		const covered = [...new Set(heads.flatMap((head) => head.source?.id ?? []))];
		const request = agingRead(as_of, covered, 10_000, 'purchasing');
		const [first, snapshots] = yield* Effect.all(
			[reader.query(request), heads.length > 0 ? readPayablesReport(reader) : Effect.succeed([])],
			{ concurrency: 2 }
		);
		const [transactions, sourcePayments] = yield* Effect.all(
			[
				reportPages(first.transactions, (after) =>
					Effect.map(
						reader.query({ transactions: { ...request.transactions, after } }),
						(page) => page.transactions
					)
				),
				reportPages(first.source_payments, (after) =>
					Effect.map(
						reader.query({ source_payments: { ...request.source_payments, after } }),
						(page) => page.source_payments
					)
				)
			],
			{ concurrency: 2 }
		);
		return {
			heads,
			accruals,
			relatedKeys,
			rows: payableAgingDetails(
				{
					transactions: { ...first.transactions, rows: transactions, next: null },
					source_payments: { ...first.source_payments, rows: sourcePayments, next: null }
				},
				as_of,
				snapshots
			)
		};
	});

/** Split supplier payable and prepaid totals by related-party vs third-party per currency. */
export function payablePartySplit(
	suppliers: readonly {
		readonly currency: string;
		readonly related_party: boolean;
		readonly owed: string;
		readonly in_credit: string;
	}[]
) {
	const sum = (values: readonly string[]) =>
		BigDecimal.format(BigDecimal.sumAll(values.map(BigDecimal.fromStringUnsafe)));
	return [...Map.groupBy(suppliers, (row) => row.currency)].map(([currency, rows]) => {
		const related = rows.filter((row) => row.related_party);
		const third = rows.filter((row) => !row.related_party);
		return {
			currency,
			related: {
				payable: sum(related.map((row) => row.owed)),
				prepaid: sum(related.map((row) => row.in_credit))
			},
			third: {
				payable: sum(third.map((row) => row.owed)),
				prepaid: sum(third.map((row) => row.in_credit))
			}
		};
	});
}

/* ── Purchase listing (采购明细) ─────────────────────────────────────────────────────────── */

export const purchaseListingHeadRead = {
	source_purchase_orders: {
		fields: ['source', 'period', 'currency', 'observed_at', 'expense_notice'],
		source: { fields: ['name'] }
	}
} as const;

export const purchaseListingPeriodRead = (from: PlainDate | null, to: PlainDate | null) =>
	({
		source_purchase_orders: {
			where: {
				...(from || to
					? {
							period: {
								...(from ? { gte: from.slice(0, 7) } : {}),
								...(to ? { lte: to.slice(0, 7) } : {})
							}
						}
					: {})
			},
			fields: ['source', 'period', 'currency', 'observed_at', 'entries'],
			source: { fields: ['name'] },
			limit: 1000
		}
	}) as const;

export const localPurchaseOrdersRead = (
	from: PlainDate | null,
	to: PlainDate | null,
	covered: readonly Id<'sys_integration'>[] = []
) =>
	({
		orders: {
			where: {
				direction: { eq: 'purchasing' },
				status: { eq: 'confirmed' },
				archived: { eq: false },
				...(covered.length ? { not: { ledger: { in: covered } } } : {}),
				...(from || to
					? {
							ordered_on: {
								...(from ? { gte: from } : {}),
								...(to ? { lte: to } : {})
							}
						}
					: {})
			},
			fields: ['number', 'ordered_on', 'currency', 'ledger', 'party', 'notes', 'kingdee'],
			party: { fields: ['name', 'external_code', 'related_party'] },
			payment_terms: { fields: ['name'] },
			ledger: { fields: ['name'] },
			lines: {
				fields: [
					'product',
					'product_code',
					'product_name',
					'product_spec',
					'quantity',
					'unit_price',
					'tax_rate',
					'net',
					'tax',
					'total',
					'source_entry_id'
				]
			},
			transactions: {
				fields: ['kind', 'reference', 'status', 'issued_on', 'due_on', 'total', 'items']
			},
			order_by: [{ ordered_on: 'desc' }, { number: 'asc' }],
			limit: 10_000
		},
		products: { fields: ['category', 'spec'], limit: 10_000 }
	}) as const;

export type PurchaseListingRow = {
	readonly key: string;
	readonly order: Id<'orders'> | null;
	readonly ledger: Id<'sys_integration'>;
	readonly ledger_name: string;
	readonly order_number: string;
	readonly ordered_on: PlainDate;
	readonly supplier_id: string | null;
	readonly supplier_name: string;
	readonly related_party: boolean;
	readonly product_category: string | null;
	readonly product_spec: string | null;
	readonly quantity: string;
	readonly currency: string | null;
	readonly base_currency: string;
	readonly unit_price: string | null;
	readonly exchange_rate: string | null;
	readonly amount: string | null;
	readonly amount_base: string | null;
	readonly received_qty: string;
	readonly last_received_on: PlainDate | null;
	readonly unreceived_qty: string;
	readonly invoice_numbers: string | null;
	readonly invoiced_on: PlainDate | null;
	readonly invoiced_qty: string | null;
	readonly invoice_amount: string | null;
	readonly duty: string | null;
	readonly vat_amount: string | null;
	readonly net_amount: string | null;
	readonly settlement: string | null;
	readonly due_on: PlainDate | null;
	readonly paid_amount: string | null;
	readonly paid_on: PlainDate | null;
	readonly unpaid_amount: string | null;
	readonly payment_status: PurchasePaymentStatus | null;
	readonly note: string | null;
};

export type PurchaseListingNotice = {
	readonly ledger: Id<'sys_integration'>;
	readonly ledger_name: string;
	readonly currency: string;
	readonly unattached_rows: number;
	readonly unattached_amount: string;
	readonly before_start_rows: number;
	readonly before_start_amount: string;
};

type PurchasePeriodRow = ReadAnswer<
	ReturnType<typeof purchaseListingPeriodRead>
>['source_purchase_orders']['rows'][number];
type LocalPurchaseOrdersAnswer = ReadAnswer<ReturnType<typeof localPurchaseOrdersRead>>;
type LocalPurchasePayment = Pick<
	Row<'source_payments'>,
	'order' | 'invoice' | 'amount' | 'settled_on'
>;

/** Map Kingdee period snapshots and local purchasing orders into unified Purchase Listing rows. */
export function purchaseListingRows(input: {
	readonly periods: readonly PurchasePeriodRow[];
	readonly local?: LocalPurchaseOrdersAnswer;
	readonly payments?: readonly LocalPurchasePayment[];
	readonly relatedKeys: ReadonlySet<string>;
	readonly from: PlainDate | null;
	readonly to: PlainDate | null;
}): PurchaseListingRow[] {
	const out: PurchaseListingRow[] = [];
	for (const bucket of input.periods) {
		if (!bucket.source) continue;
		const digits = currencyDigits(bucket.currency);
		for (const entry of bucket.entries) {
			if (input.from && entry.ordered_on < input.from) continue;
			if (input.to && entry.ordered_on > input.to) continue;
			const unreceived = fixedDecimal(
				BigDecimal.subtract(
					BigDecimal.fromStringUnsafe(entry.quantity),
					BigDecimal.fromStringUnsafe(entry.received_qty)
				),
				3
			);
			const unpaid =
				entry.invoice_amount == null || entry.paid_amount == null
					? null
					: fixedDecimal(
							BigDecimal.subtract(
								BigDecimal.fromStringUnsafe(entry.invoice_amount),
								BigDecimal.fromStringUnsafe(entry.paid_amount)
							),
							digits
						);
			out.push({
				key: `${bucket.source.id}:${entry.order_id}:${entry.entry_id}`,
				order: null,
				ledger: bucket.source.id,
				ledger_name: bucket.source.name,
				order_number: entry.order_number,
				ordered_on: entry.ordered_on,
				supplier_id: entry.supplier_id ?? null,
				supplier_name: entry.supplier_name ?? '',
				related_party:
					entry.supplier_id != null &&
					input.relatedKeys.has(`${bucket.source.id}:${entry.supplier_id}`),
				product_category: entry.product_category ?? null,
				product_spec: entry.product_spec ?? null,
				quantity: entry.quantity,
				currency: entry.currency ?? null,
				base_currency: bucket.currency,
				unit_price: entry.unit_price ?? null,
				exchange_rate: entry.exchange_rate ?? null,
				amount: entry.amount ?? null,
				amount_base: entry.amount_base ?? null,
				received_qty: entry.received_qty,
				last_received_on: entry.last_received_on ?? null,
				unreceived_qty: unreceived,
				invoice_numbers: entry.invoice_numbers ?? null,
				invoiced_on: entry.invoiced_on ?? null,
				invoiced_qty: entry.invoiced_qty ?? null,
				invoice_amount: entry.invoice_amount ?? null,
				duty: entry.duty ?? null,
				vat_amount: entry.vat_amount ?? null,
				net_amount: entry.net_amount ?? null,
				settlement: entry.settlement ?? null,
				due_on: entry.due_on ?? null,
				paid_amount: entry.paid_amount ?? null,
				paid_on: entry.paid_on ?? null,
				unpaid_amount: unpaid,
				payment_status: entry.payment_status ?? null,
				note: entry.note ?? null
			});
		}
	}

	if (input.local) {
		const byProduct = new Map(input.local.products.rows.map((p) => [p.id, p]));
		const paidByInvoice = new Map<string, { amount: BigDecimal.BigDecimal; on: PlainDate }>();
		for (const payment of input.payments ?? []) {
			if (!payment.invoice) continue;
			const prior = paidByInvoice.get(payment.invoice);
			paidByInvoice.set(payment.invoice, {
				amount: BigDecimal.sum(
					prior?.amount ?? BigDecimal.fromBigInt(0n),
					BigDecimal.fromStringUnsafe(payment.amount)
				),
				on: prior && prior.on > payment.settled_on ? prior.on : payment.settled_on
			});
		}
		const latestDate = (dates: readonly (PlainDate | null)[]) =>
			dates.reduce<PlainDate | null>((max, d) => (d && (!max || d > max) ? d : max), null);
		for (const order of input.local.orders.rows) {
			const ledgerId = order.ledger?.id;
			if (!ledgerId) continue;
			const digits = currencyDigits(order.currency);
			const issued = order.transactions.filter((tx) => tx.status === 'issued');
			// In Trade Operations, a purchase order's receipt transaction carries kind = 'delivery'.
			const receiptsByLine = new Map<
				string,
				{ on: PlainDate | null; qty: BigDecimal.BigDecimal }[]
			>();
			const invoicesByLine = new Map<
				string,
				{ tx: (typeof issued)[number]; qty: BigDecimal.BigDecimal }[]
			>();
			for (const tx of issued) {
				if (tx.kind === 'delivery') {
					for (const item of tx.items ?? []) {
						if (!item.order_line_id) continue;
						const list = receiptsByLine.get(item.order_line_id);
						const entry = { on: tx.issued_on, qty: BigDecimal.fromStringUnsafe(item.quantity) };
						if (list) list.push(entry);
						else receiptsByLine.set(item.order_line_id, [entry]);
					}
				} else if (tx.kind === 'invoice') {
					const byLine = new Map<string, BigDecimal.BigDecimal>();
					for (const item of tx.items ?? []) {
						if (!item.order_line_id) continue;
						const prior = byLine.get(item.order_line_id);
						const qty = BigDecimal.fromStringUnsafe(item.quantity);
						byLine.set(item.order_line_id, prior ? BigDecimal.sum(prior, qty) : qty);
					}
					for (const [lineId, qty] of byLine) {
						const list = invoicesByLine.get(lineId);
						if (list) list.push({ tx, qty });
						else invoicesByLine.set(lineId, [{ tx, qty }]);
					}
				}
			}
			const rate = order.kingdee?.exchange_rate ?? null;
			for (const line of order.lines) {
				const product = byProduct.get(line.product);
				const lineReceipts = receiptsByLine.get(line.id) ?? [];
				const receivedQty = BigDecimal.sumAll(lineReceipts.map((r) => r.qty));
				const orderedQty = BigDecimal.fromStringUnsafe(line.quantity);
				const unreceivedQty = BigDecimal.subtract(orderedQty, receivedQty);
				const lineInvoices = invoicesByLine.get(line.id) ?? [];
				const invoicedQty = lineInvoices.length
					? BigDecimal.sumAll(lineInvoices.map((i) => i.qty))
					: null;
				const ratio =
					invoicedQty && !BigDecimal.isZero(orderedQty)
						? BigDecimal.divideUnsafe(invoicedQty, orderedQty)
						: null;
				const netAmount =
					ratio === null
						? null
						: BigDecimal.round(BigDecimal.multiply(BigDecimal.fromStringUnsafe(line.net), ratio), {
								scale: digits,
								mode: 'half-from-zero'
							});
				const vatAmount =
					ratio === null
						? null
						: BigDecimal.round(BigDecimal.multiply(BigDecimal.fromStringUnsafe(line.tax), ratio), {
								scale: digits,
								mode: 'half-from-zero'
							});
				const invoiceAmount =
					netAmount !== null && vatAmount !== null ? BigDecimal.sum(netAmount, vatAmount) : null;
				let paidTotal = BigDecimal.fromBigInt(0n);
				let statusMin: number | null = null;
				let statusMax: number | null = null;
				const payDates: (PlainDate | null)[] = [];
				for (const { tx, qty } of lineInvoices) {
					const settled = paidByInvoice.get(tx.id);
					const billed = tx.total ? BigDecimal.fromStringUnsafe(tx.total) : null;
					const paid = settled?.amount ?? BigDecimal.fromBigInt(0n);
					if (settled) payDates.push(settled.on);
					const statusCode =
						billed === null || BigDecimal.isZero(billed)
							? null
							: BigDecimal.isZero(paid)
								? 0
								: BigDecimal.isLessThan(paid, billed)
									? 1
									: 2;
					if (statusCode !== null) {
						statusMin = statusMin === null ? statusCode : Math.min(statusMin, statusCode);
						statusMax = statusMax === null ? statusCode : Math.max(statusMax, statusCode);
					}
					if (billed && !BigDecimal.isZero(billed) && !BigDecimal.isZero(orderedQty)) {
						const lineInvoiceAmt = BigDecimal.multiply(
							BigDecimal.fromStringUnsafe(line.total),
							BigDecimal.divideUnsafe(qty, orderedQty)
						);
						paidTotal = BigDecimal.sum(
							paidTotal,
							BigDecimal.divideUnsafe(BigDecimal.multiply(lineInvoiceAmt, paid), billed)
						);
					}
				}
				const paidAmount = lineInvoices.length ? fixedDecimal(paidTotal, digits) : null;
				const unpaidAmount =
					invoiceAmount !== null && paidAmount !== null
						? fixedDecimal(
								BigDecimal.subtract(invoiceAmount, BigDecimal.fromStringUnsafe(paidAmount)),
								digits
							)
						: null;
				const lineQtyStr = fixedDecimal(orderedQty, 3);
				const invoicedQtyStr = invoicedQty ? fixedDecimal(invoicedQty, 3) : null;
				out.push({
					key: `${order.id}:${line.id}`,
					order: order.id,
					ledger: ledgerId,
					ledger_name: order.ledger?.name ?? '',
					order_number: order.number,
					ordered_on: order.ordered_on,
					supplier_id: order.party?.external_code ?? order.party?.id ?? null,
					supplier_name: order.party?.name ?? '',
					related_party: Boolean(order.party?.related_party),
					product_category: product?.category ?? null,
					product_spec: line.product_spec ?? product?.spec ?? null,
					quantity: lineQtyStr,
					currency: order.currency,
					base_currency: order.currency,
					unit_price: line.unit_price,
					exchange_rate: rate,
					amount: line.total,
					amount_base: rate
						? fixedDecimal(
								BigDecimal.multiply(
									BigDecimal.fromStringUnsafe(line.total),
									BigDecimal.fromStringUnsafe(rate)
								),
								digits
							)
						: line.total,
					received_qty: fixedDecimal(receivedQty, 3),
					last_received_on: latestDate(lineReceipts.map((r) => r.on)),
					unreceived_qty: fixedDecimal(unreceivedQty, 3),
					invoice_numbers: lineInvoices.length
						? lineInvoices.map(({ tx }) => tx.reference).join(', ')
						: null,
					invoiced_on: latestDate(lineInvoices.map(({ tx }) => tx.issued_on)),
					invoiced_qty: invoicedQtyStr,
					invoice_amount: invoiceAmount ? fixedDecimal(invoiceAmount, digits) : null,
					duty: null,
					vat_amount: vatAmount ? fixedDecimal(vatAmount, digits) : null,
					net_amount: netAmount ? fixedDecimal(netAmount, digits) : null,
					settlement: order.payment_terms?.name ?? null,
					due_on: latestDate(lineInvoices.map(({ tx }) => tx.due_on)),
					paid_amount: paidAmount,
					paid_on: latestDate(payDates),
					unpaid_amount: unpaidAmount,
					payment_status: purchasePaymentStatus(
						lineInvoices.length,
						statusMin,
						statusMax,
						invoicedQtyStr,
						lineQtyStr
					),
					note: order.notes ?? null
				});
			}
		}
	}

	return out.sort(
		(a, b) =>
			b.ordered_on.localeCompare(a.ordered_on) ||
			a.order_number.localeCompare(b.order_number) ||
			a.key.localeCompare(b.key)
	);
}

/** Read Purchase Listing rows for `[from, to]`, combining Kingdee snapshots with uncovered local POs. */
export const readPurchaseListingAt = <E>(
	reader: ReportReader<E>,
	range: { readonly from: PlainDate | null; readonly to: PlainDate | null },
	options: { readonly sourcePurchaseOrders: boolean; readonly localOrders: boolean }
) =>
	Effect.gen(function* () {
		const emptyHeads: ReadAnswer<typeof purchaseListingHeadRead>['source_purchase_orders']['rows'] =
			[];
		const [heads, partyPage] = yield* Effect.all(
			[
				options.sourcePurchaseOrders
					? reader
							.query(purchaseListingHeadRead)
							.pipe(Effect.map((a) => a.source_purchase_orders.rows))
					: Effect.succeed(emptyHeads),
				reader.query({
					parties: { fields: ['source', 'external_code', 'related_party'], limit: 10_000 }
				})
			],
			{ concurrency: 2 }
		);
		const relatedKeys = new Set<string>();
		for (const party of partyPage.parties.rows) {
			if (!party.related_party) continue;
			relatedKeys.add(`${party.source}:${party.external_code}`);
			relatedKeys.add(`${party.source}:${party.id}`);
		}
		const covered = [...new Set(heads.flatMap((head) => head.source?.id ?? []))];
		const latestByLedger = new Map<
			Id<'sys_integration'>,
			{
				readonly source: NonNullable<(typeof heads)[number]['source']>;
				readonly observed_at: (typeof heads)[number]['observed_at'];
				readonly currency: (typeof heads)[number]['currency'];
				readonly period: string;
				readonly notice: (typeof heads)[number]['expense_notice'];
			}
		>();
		for (const head of heads) {
			if (!head.source) continue;
			const existing = latestByLedger.get(head.source.id);
			const nextPeriod = !existing || head.period > existing.period ? head.period : existing.period;
			const nextObserved =
				!existing || head.observed_at > existing.observed_at
					? head.observed_at
					: existing.observed_at;
			const nextNotice = head.expense_notice ?? existing?.notice ?? null;
			latestByLedger.set(head.source.id, {
				source: head.source,
				observed_at: nextObserved,
				currency: head.currency,
				period: nextPeriod,
				notice: nextNotice
			});
		}
		const notices: PurchaseListingNotice[] = [...latestByLedger.values()].flatMap((item) =>
			item.notice
				? [
						{
							ledger: item.source.id,
							ledger_name: item.source.name,
							currency: item.currency,
							unattached_rows: item.notice.unattached_rows,
							unattached_amount: item.notice.unattached_amount,
							before_start_rows: item.notice.before_start_rows,
							before_start_amount: item.notice.before_start_amount
						}
					]
				: []
		);
		const emptyPeriods: PurchasePeriodRow[] = [];
		const [periods, local] = yield* Effect.all(
			[
				heads.length > 0
					? reader
							.query(purchaseListingPeriodRead(range.from, range.to))
							.pipe(Effect.map((a) => a.source_purchase_orders.rows))
					: Effect.succeed(emptyPeriods),
				options.localOrders
					? reader.query(localPurchaseOrdersRead(range.from, range.to, covered))
					: Effect.succeed(undefined)
			],
			{ concurrency: 2 }
		);
		const localOrderIds = local?.orders.rows.map((order) => order.id) ?? [];
		const payments =
			localOrderIds.length > 0
				? (yield* reader.query({
						source_payments: {
							where: { order: { in: localOrderIds }, active: { eq: true } },
							fields: ['order', 'invoice', 'amount', 'settled_on'],
							limit: 10_000
						}
					})).source_payments.rows
				: [];
		return {
			heads: [...latestByLedger.values()],
			notices,
			rows: purchaseListingRows({
				periods,
				...(local ? { local } : {}),
				payments,
				relatedKeys,
				from: range.from,
				to: range.to
			})
		};
	});

/** Purchase listing summary totals per base currency (never adding across currencies). */
export function purchaseListingTotals(rows: readonly PurchaseListingRow[]) {
	const sum = (values: readonly (string | null)[]) =>
		BigDecimal.format(
			BigDecimal.sumAll(values.flatMap((v) => (v === null ? [] : [BigDecimal.fromStringUnsafe(v)])))
		);
	return [...Map.groupBy(rows, (row) => row.base_currency)].map(([currency, group]) => ({
		currency,
		lines: group.length,
		quantity: sum(group.map((row) => row.quantity)),
		received_qty: sum(group.map((row) => row.received_qty)),
		unreceived_qty: sum(group.map((row) => row.unreceived_qty)),
		figures: (
			[
				'amount_base',
				'invoice_amount',
				'duty',
				'vat_amount',
				'paid_amount',
				'unpaid_amount'
			] as const
		).map((field) => ({
			field,
			value: sum(group.map((row) => row[field]))
		}))
	}));
}
