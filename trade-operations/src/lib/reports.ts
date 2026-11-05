import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Result, Schema } from 'effect';
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
import { type Id, type ReadAnswer, type Row, type Where } from '@norbital-ai/bolt';
import { hash } from './commercial.js';
import { minorDigits, Decimal, sum } from '@norbital-ai/std/decimal';
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
			quantity: Decimal.of(rawQuantity),
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
		const quantity = fact ? Decimal.of(fact.quantity).abs().toString() : line.quantity;
		const factNet = fact?.net_amount;
		if (fact && factNet == null) return { ...base, reason: 'expression_error' as const };
		const net = factNet == null ? line.net : Decimal.of(factNet).abs().toString();
		const evaluated = Result.try(() => {
			if (rule.engine_version && rule.engine_version !== COMMISSION_ENGINE)
				throw new Error('Unknown commission engine');
			const factor =
				line.commission_factor &&
				Decimal.of(line.commission_factor).gt(0) &&
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
					? Decimal.of(net).div(quantity, 18).minus(line.floor_net).div(factor, 18).round(8)
					: null;
			return {
				...base,
				spread,
				amount: (fact?.kind === 'return' ? result.amount.neg() : result.amount).round(
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
						: !line.commission_factor || Decimal.of(line.commission_factor).lte(0)
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
		return commissionLines(order, version?.seal_hash).map(({ order_line, ...line }) => ({
			...line,
			owner_name: '',
			order: order.id,
			number: order.number,
			owner: order.owner,
			ordered_on: order.ordered_on,
			currency: order.currency
		}));
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
		: sum(lines.flatMap((line) => (line.amount === null ? [] : [line.amount]))).round(
				minorDigits(order.currency)
			);
	const snapshot = {
		seal_hash: order.seal_hash ?? '',
		eligible: actual ? Boolean(version) : Boolean(executableAgreement(record)),
		lines: lines.map((line) => ({
			order_line: line.order_line,
			product: line.product,
			quantity: line.quantity.toString(),
			basis_unit: line.basis_unit,
			spread: line.spread?.toString() ?? null,
			amount: line.amount?.toString() ?? null,
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
		where: { active: { eq: true } },
		fields: [
			'order',
			'order_line',
			'seal_hash',
			'reference',
			'external_code',
			'business_on',
			'kind',
			'unit',
			'quantity',
			'lot_number',
			'unit_cost',
			'net_amount',
			'tax_amount',
			'freight'
		]
	},
	'source_sales_lines.order': {
		where: { direction: { eq: 'sales' }, seal_hash: { isNull: false } },
		fields: [...agreementFields, 'number', 'party', 'owner', 'currency']
	},
	'source_sales_lines.order.party': { fields: ['name'] },
	'source_sales_lines.order.lines': { fields: ['product'] },
	products: { fields: ['name'] },
	sys_user: { output: 'directory', fields: ['name'] }
} as const;
type SalesAnswer = ReadAnswer<typeof salesRead>;
type SalesRange = { readonly from?: string | null; readonly to?: string | null };
const inRange = (on: string, range: SalesRange) =>
	!(range.from && on < range.from) && !(range.to && on > range.to);
/** Net sales after the agreed freight treatment, `null` while a needed amount is unknown. */
function bookedNet(
	net: Decimal | null,
	freight: Decimal | null,
	treatment: Row<'orders'>['freight_treatment']
) {
	if (net === null) return null;
	if (treatment !== 'deduct') return net;
	return freight === null ? null : net.minus(freight);
}
/** Monthly sales and returns by currency and salesperson (an inverted range reads nothing). */
export function salesAnalysis(answer: SalesAnswer, range: SalesRange = {}) {
	const byUser = new Map(answer.sys_user.rows.map((u) => [u.id, u.name]));
	const groups = new Map<
		string,
		{
			currency: Row<'orders'>['currency'];
			owner: Row<'orders'>['owner'];
			owner_name: string;
			period: Row<'source_sales_lines'>['business_on'];
			freight_treatment: Row<'orders'>['freight_treatment'];
			orderIds: Set<string>;
			source_lines: number;
			unresolved_lines: number;
			net: Decimal | null;
			tax: Decimal | null;
			total: Decimal | null;
			freight: Decimal | null;
		}
	>();
	for (const source of answer.source_sales_lines.rows) {
		if (!inRange(source.business_on, range)) continue;
		const record = source.order;
		const version = record ? agreement(record, source.seal_hash) : undefined;
		if (!record || !version) continue;
		const order = withAgreement(record, version);
		const period = source.business_on.slice(0, 7) + '-01';
		const key = `${order.currency}:${order.owner}:${period}:${order.freight_treatment}`;
		const group = groups.get(key) ?? {
			currency: order.currency,
			owner: order.owner,
			owner_name: byUser.get(order.owner) ?? '',
			period: PlainDate(period),
			freight_treatment: order.freight_treatment,
			orderIds: new Set<string>(),
			source_lines: 0,
			unresolved_lines: 0,
			net: Decimal.of(0),
			tax: Decimal.of(0),
			total: Decimal.of(0),
			freight: Decimal.of(0)
		};
		const net = source.net_amount,
			tax = source.tax_amount,
			freight = source.freight;
		const booked = bookedNet(net, freight, order.freight_treatment);
		group.orderIds.add(order.id);
		group.source_lines++;
		if (net === null || tax === null || freight === null) group.unresolved_lines++;
		group.net = group.net === null || booked === null ? null : group.net.plus(booked);
		group.tax = group.tax === null || tax === null ? null : group.tax.plus(tax);
		group.freight = group.freight === null || freight === null ? null : group.freight.plus(freight);
		group.total =
			group.total === null || net === null || tax === null ? null : group.total.plus(net).plus(tax);
		groups.set(key, group);
	}
	return [...groups.values()]
		.map(({ orderIds, ...row }) => ({
			...row,
			orders: orderIds.size,
			net: row.net?.round(minorDigits(row.currency)) ?? null,
			tax: row.tax?.round(minorDigits(row.currency)) ?? null,
			total: row.total?.round(minorDigits(row.currency)) ?? null,
			freight: row.freight?.round(minorDigits(row.currency)) ?? null
		}))
		.sort(
			(a, b) =>
				b.period.localeCompare(a.period) ||
				a.currency.localeCompare(b.currency) ||
				a.owner.localeCompare(b.owner) ||
				a.freight_treatment.localeCompare(b.freight_treatment)
		);
}
/** Sales and returns per source line for the selected dates, priced against the seal each line names. */
export function salesDetail(answer: SalesAnswer, range: SalesRange = {}) {
	const byProduct = new Map(answer.products.rows.map((row) => [row.id, row.name]));
	const byUser = new Map(answer.sys_user.rows.map((row) => [row.id, row.name]));
	return answer.source_sales_lines.rows
		.flatMap((source) => {
			const record = source.order;
			const version = record ? agreement(record, source.seal_hash) : undefined;
			const order = record && version ? withAgreement(record, version) : undefined;
			if (!order || !inRange(source.business_on, range)) return [];
			const sealed = version?.snapshot.lines.find((item) => item.id === source.order_line);
			const line = order.lines.find((row) => row.id === source.order_line);
			const net = source.net_amount,
				tax = source.tax_amount,
				freight = source.freight;
			const booked = bookedNet(net, freight, order.freight_treatment);
			const digits = minorDigits(order.currency);
			const cost =
				source.lot_number && source.unit_cost !== null
					? Decimal.of(source.unit_cost).times(source.quantity)
					: null;
			return [
				{
					order: order.id,
					product: answer.products.rows.find((p) => p.id === sealed?.product)?.id ?? null,
					party: order.party?.id ?? null,
					owner: order.owner,
					sold_price: net === null ? null : net.div(source.quantity, 8),
					floor_net: sealed?.floor_net ? Decimal.of(sealed.floor_net) : null,
					order_number: order.number,
					party_name: order.party?.name ?? '',
					product_name: sealed?.product_name ?? (line ? (byProduct.get(line.product) ?? '') : ''),
					owner_name: byUser.get(order.owner) ?? '',
					reference: source.reference,
					external_code: source.external_code,
					business_on: source.business_on,
					kind: source.kind,
					unit: source.unit,
					quantity: source.quantity,
					lot_number: source.lot_number,
					cost: cost?.round(digits) ?? null,
					margin: cost && booked !== null ? booked.minus(cost).round(digits) : null,
					currency: order.currency,
					freight_treatment: order.freight_treatment,
					net: booked?.round(digits) ?? null,
					tax,
					freight,
					total: net === null || tax === null ? null : net.plus(tax).round(digits)
				}
			];
		})
		.sort(
			(a, b) =>
				b.business_on.localeCompare(a.business_on) || a.external_code.localeCompare(b.external_code)
		);
}
/** The aging read on `as_of`: issued invoices with their order, and the active payments settled by then. */
export const agingRead = (as_of: PlainDate) =>
	({
		transactions: {
			where: { kind: { eq: 'invoice' }, status: { eq: 'issued' }, issued_on: { lte: as_of } },
			fields: ['order', 'reference', 'currency', 'total', 'due_on']
		},
		'transactions.order': { fields: ['number', 'party_name'] },
		source_payments: {
			where: { settled_on: { lte: as_of }, active: { eq: true } },
			fields: ['invoice', 'amount']
		}
	}) as const;
const AGING = [
	[0, 'not_due'],
	[30, '1_30'],
	[60, '31_60'],
	[90, '61_90'],
	[Infinity, 'over_90']
] as const;
/** Open issued invoices by due-date bucket on `as_of`; unapplied payments stay with the payment ledger. */
export function arAging(answer: ReadAnswer<ReturnType<typeof agingRead>>, as_of: PlainDate) {
	return answer.transactions.rows.flatMap((invoice) => {
		const order = invoice.order;
		if (!order || invoice.total === null) return [];
		const paid = sum(
			answer.source_payments.rows.filter((p) => p.invoice === invoice.id).map((p) => p.amount)
		);
		const raw = Decimal.of(invoice.total).minus(paid);
		const balance = raw.lt(0) ? Decimal.of(0) : raw;
		const overpaid = raw.lt(0) ? Decimal.of(0).minus(raw) : Decimal.of(0);
		if (balance.eq(0) && overpaid.eq(0)) return [];
		const days = invoice.due_on
			? Math.floor(
					(Date.parse(as_of + 'T00:00:00Z') - Date.parse(invoice.due_on + 'T00:00:00Z')) / 86400000
				)
			: null;
		const bucket =
			days === null
				? ('no_due_date' as const)
				: (AGING.find(([threshold]) => days <= threshold)?.[1] ?? 'over_90');
		return [
			{
				order: order.id,
				order_number: order.number,
				party_name: order.party_name ?? '',
				invoice: invoice.id,
				invoice_number: invoice.reference,
				currency: invoice.currency,
				due_on: invoice.due_on,
				as_of,
				balance,
				overpaid,
				bucket
			}
		];
	});
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
			fields: ['order', 'invoice', 'reference', 'currency', 'amount', 'settled_on', 'active']
		},
		'source_payments.order': { fields: ['number', 'party'] },
		'source_payments.order.party': { fields: ['name'] },
		'source_payments.invoice': { fields: ['reference'] }
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
