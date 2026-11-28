import { bills, directionsOf, type Bill } from './bills.js';
import { BigDecimal, Effect, Predicate } from 'effect';
import type { CurrencyCode, StoredRow, Id, Json } from '@norbital-ai/bolt';
import {
	erpId,
	readOrderGraph,
	selectByIds,
	type NativeProjection,
	type OrderSourceContext
} from './order-source.js';
import {
	columns,
	currency,
	Instant,
	SourceRowInvalid,
	SourceUnavailable,
	type SqlRow
} from './polling.js';
import { kingdeeDeliveryCostAccount } from './configuration.js';
import { numeric } from '../../lib/commercial.js';

const invalid = (column: string, reason: string): never => {
	throw new SourceRowInvalid({ column, reason });
};
const checked = <A>(read: () => A) =>
	Effect.try({
		try: read,
		catch: (cause) =>
			cause instanceof SourceRowInvalid
				? cause
				: new SourceRowInvalid({ column: '$row', reason: String(cause) })
	});
const id = (row: SqlRow, name: string): string => {
	const value = row[name];
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
	if (typeof value === 'string' && /^\d+$/.test(value.trim()))
		return BigInt(value.trim()).toString();
	return invalid(name, 'Expected an exact nonnegative Kingdee identifier');
};
const text = (row: SqlRow, name: string): string => {
	const value = columns(row).text(name).trim();
	return value || invalid(name, 'Required source text is empty');
};
type Owner = {
	readonly order: Id<'orders'>;
	readonly currency: string;
};
type FinancialLine = {
	readonly entryId: string;
	readonly detailId: string;
	readonly unit: string;
	readonly quantity: BigDecimal.BigDecimal;
	readonly lotNumber: string | null;
	readonly netAmount: BigDecimal.BigDecimal | null;
	readonly grossAmount: BigDecimal.BigDecimal | null;
	readonly costAmount?: BigDecimal.BigDecimal | null;
	readonly localLine: { readonly id: string };
	readonly upstream: { readonly fid: string; readonly entryId: string } | null;
};
export type FinancialDocument = {
	readonly fid: string;
	readonly reference: string;
	readonly issuedOn: string;
	readonly currency: string;
	readonly status: 'issued' | 'void';
	readonly owner: Owner;
	readonly lines: readonly FinancialLine[];
};
type SalesFact = Pick<
	StoredRow<'source_sales_lines'>,
	| 'external_code'
	| 'order'
	| 'order_line'
	| 'kind'
	| 'reference'
	| 'business_on'
	| 'source_updated_at'
	| 'unit'
	| 'quantity'
	| 'currency'
	| 'lot_number'
	| 'unit_cost'
	| 'booked_cost'
	| 'booked_cost_currency'
	| 'net_amount'
	| 'tax_amount'
	| 'freight'
	| 'active'
>;

/** A red document reverses both quantity and money; every part must share one sign and tax may not exceed gross. */
const signedAmounts = (
	quantity: BigDecimal.BigDecimal | null,
	net: BigDecimal.BigDecimal | null,
	gross: BigDecimal.BigDecimal | null
): boolean => {
	if (quantity !== null && BigDecimal.isZero(quantity)) return false;
	if (net === null || gross === null) return true;
	if (BigDecimal.isNegative(net) !== BigDecimal.isNegative(gross)) return false;
	return BigDecimal.isGreaterThanOrEqualTo(BigDecimal.abs(gross), BigDecimal.abs(net));
};
/** Invoice money belongs to its exact delivery line; matching only product or local line would double-count split deliveries. */
export function mapSalesFacts(
	deliveries: readonly FinancialDocument[],
	invoices: readonly FinancialDocument[],
	observedAt: string,
	costCurrency?: CurrencyCode
): readonly (SalesFact & { readonly $id: string })[] {
	const observed = Instant(observedAt);
	const deliveryLines = new Map<string, { delivery: FinancialDocument; line: FinancialLine }>(
		deliveries.flatMap((delivery) =>
			delivery.lines.map((line) => [`${delivery.fid}:${line.entryId}`, { delivery, line }] as const)
		)
	);
	const billedByDelivery = new Map<string, FinancialLine[]>();
	const invoiceFacts = invoices
		.filter((invoice) => invoice.status === 'issued')
		.flatMap((invoice) =>
			invoice.lines.map((line) => {
				const key = line.upstream ? `${line.upstream.fid}:${line.upstream.entryId}` : '';
				const source = deliveryLines.get(key);
				if (
					!source ||
					invoice.owner.order !== source.delivery.owner.order ||
					invoice.currency !== source.delivery.currency ||
					line.localLine.id !== source.line.localLine.id ||
					line.unit !== source.line.unit
				)
					return invalid('FSourceEntryID', 'Invoice evidence has no matching owned delivery line');
				const net = line.netAmount;
				const gross = line.grossAmount;
				if (
					!signedAmounts(line.quantity, net, gross) ||
					(net !== null && BigDecimal.isNegative(line.quantity) !== BigDecimal.isNegative(net))
				)
					return invalid(
						'FAmount',
						'Source invoice amounts have an unsupported sign or tax relationship'
					);
				const billed = billedByDelivery.get(key) ?? [];
				billed.push(line);
				billedByDelivery.set(key, billed);
				const tax = net !== null && gross !== null ? BigDecimal.subtract(gross, net) : null;
				const external = `invoice:${invoice.fid}:${line.detailId}`;
				const fact: SalesFact & { $id: string } = {
					$id: external,
					external_code: external,
					order: invoice.owner.order,
					order_line: line.localLine.id,
					kind: 'invoice',
					reference: `${invoice.reference}/${line.entryId}`,
					business_on: invoice.issuedOn,
					source_updated_at: observed,
					unit: line.unit,
					quantity: new Intl.NumberFormat('en', {
						useGrouping: false,
						minimumFractionDigits: line.quantity.scale,
						maximumFractionDigits: line.quantity.scale
					}).format(numeric(BigDecimal.format(line.quantity))),
					currency: currency(invoice.currency),
					lot_number: source.line.lotNumber,
					unit_cost: null,
					booked_cost: null,
					booked_cost_currency: null,
					net_amount:
						net === null
							? null
							: new Intl.NumberFormat('en', {
									useGrouping: false,
									minimumFractionDigits: net.scale,
									maximumFractionDigits: net.scale
								}).format(numeric(BigDecimal.format(net))),
					tax_amount:
						tax === null
							? null
							: new Intl.NumberFormat('en', {
									useGrouping: false,
									minimumFractionDigits: tax.scale,
									maximumFractionDigits: tax.scale
								}).format(numeric(BigDecimal.format(tax))),
					freight: null,
					active: true
				};
				return { key, fact, deliveryLine: source.line };
			})
		);
	const billedQuantities = new Map(
		[...billedByDelivery].map(([key, lines]) => [
			key,
			BigDecimal.sumAll(lines.map((line) => line.quantity))
		])
	);
	const invoiced = invoiceFacts.map(({ key, fact, deliveryLine }) => {
		const quantity = billedQuantities.get(key);
		if (
			!costCurrency ||
			deliveryLine.costAmount == null ||
			!quantity ||
			BigDecimal.isZero(deliveryLine.quantity)
		)
			return fact;
		if (
			BigDecimal.isGreaterThan(BigDecimal.abs(quantity), BigDecimal.abs(deliveryLine.quantity)) ||
			(!BigDecimal.isZero(quantity) &&
				BigDecimal.isNegative(quantity) !== BigDecimal.isNegative(deliveryLine.quantity))
		)
			return fact;
		return {
			...fact,
			booked_cost: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: 10,
				maximumFractionDigits: 10
			}).format(
				numeric(
					BigDecimal.format(
						BigDecimal.round(
							BigDecimal.divideUnsafe(
								BigDecimal.multiply(
									deliveryLine.costAmount,
									BigDecimal.fromStringUnsafe(fact.quantity)
								),
								deliveryLine.quantity
							),
							{ scale: 10 }
						)
					)
				)
			),
			booked_cost_currency: costCurrency
		};
	});
	const shipmentFacts = deliveries.flatMap((delivery) =>
		delivery.lines.map((line): SalesFact & { $id: string } => {
			if (delivery.currency !== delivery.owner.currency || BigDecimal.isZero(line.quantity))
				return invalid('FQty', 'An owned delivery requires a quantity and its order currency');
			const returned = BigDecimal.isNegative(line.quantity);
			if (
				returned &&
				((line.netAmount !== null && BigDecimal.isPositive(line.netAmount)) ||
					(line.grossAmount !== null && BigDecimal.isPositive(line.grossAmount)))
			)
				return invalid('FAmount', 'A return requires negative money with its negative quantity');
			const billed = billedByDelivery.get(`${delivery.fid}:${line.entryId}`) ?? [];
			const complete =
				billed.length > 0 &&
				BigDecimal.equals(
					BigDecimal.sumAll(billed.map((entry) => entry.quantity)),
					line.quantity
				) &&
				billed.every((entry) => entry.netAmount !== null && entry.grossAmount !== null);
			// billed money when its invoices cover the line; an unbilled return keeps the signed money it carries
			const net = complete
				? BigDecimal.sumAll(billed.flatMap((entry) => entry.netAmount ?? []))
				: returned
					? line.netAmount
					: null;
			const gross = complete
				? BigDecimal.sumAll(billed.flatMap((entry) => entry.grossAmount ?? []))
				: returned
					? line.grossAmount
					: null;
			if (!signedAmounts(null, net, gross))
				return invalid(
					'FAmount',
					'Source invoice amounts have an unsupported sign or tax relationship'
				);
			const external = `${returned ? 'return' : 'shipment'}:${delivery.fid}:${line.entryId}`;
			const booked = costCurrency ? (line.costAmount ?? null) : null;
			const tax = net !== null && gross !== null ? BigDecimal.subtract(gross, net) : null;
			return {
				$id: external,
				external_code: external,
				order: delivery.owner.order,
				order_line: line.localLine.id,
				kind: returned ? 'return' : 'shipment',
				reference: `${delivery.reference}/${line.entryId}`,
				business_on: delivery.issuedOn,
				source_updated_at: observed,
				unit: line.unit,
				quantity: new Intl.NumberFormat('en', {
					useGrouping: false,
					minimumFractionDigits: line.quantity.scale,
					maximumFractionDigits: line.quantity.scale
				}).format(numeric(BigDecimal.format(line.quantity))),
				currency: currency(delivery.currency),
				lot_number: line.lotNumber,
				unit_cost: null,
				booked_cost:
					booked === null
						? null
						: new Intl.NumberFormat('en', {
								useGrouping: false,
								minimumFractionDigits: booked.scale,
								maximumFractionDigits: booked.scale
							}).format(numeric(BigDecimal.format(booked))),
				booked_cost_currency: booked === null ? null : (costCurrency ?? null),
				net_amount:
					net === null
						? null
						: new Intl.NumberFormat('en', {
								useGrouping: false,
								minimumFractionDigits: net.scale,
								maximumFractionDigits: net.scale
							}).format(numeric(BigDecimal.format(net))),
				tax_amount:
					tax === null
						? null
						: new Intl.NumberFormat('en', {
								useGrouping: false,
								minimumFractionDigits: tax.scale,
								maximumFractionDigits: tax.scale
							}).format(numeric(BigDecimal.format(tax))),
				freight: null,
				active: delivery.status === 'issued'
			};
		})
	);
	return [...shipmentFacts, ...invoiced];
}

const idsSql = "(SELECT n.value('.', 'nvarchar(100)') FROM @ids.nodes('/ids/id') AS keys(n))";
/**
 * All of a header's invoice-side entries are read before using its amount; the amount is not a per-line
 * allocation. KIS stores each settlement link twice, invoice→receipt and receipt→invoice: only the invoice
 * side is read, as SalesBridge did, whichever header the mirrored row sits under.
 */
const paymentProjection = ({ settlement }: Bill): NativeProjection => ({
	sql: `/* kingdee-settlement-entries */
SELECT RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),ce.FDetailID),20) AS __key,
 CONVERT(varchar(30),ce.FDetailID) AS detail_id,CONVERT(varchar(30),ce.FInterID) AS check_id,
 CONVERT(varchar(30),ce.FType) AS type,CONVERT(varchar(30),ce.FType_SRC) AS source_type,
 CONVERT(varchar(30),ce.FInvoiceID) AS invoice_id,CONVERT(varchar(30),ce.FEntryID) AS invoice_entry,
 CONVERT(varchar(30),ce.FBillID_SRC) AS receipt_id,
 CONVERT(varchar(30),checkhead.FInterID) AS header_id,CONVERT(varchar(30),checkhead.FRP) AS header_direction,
 CONVERT(varchar(30),checkhead.FType) AS header_type,CONVERT(varchar(30),checkhead.FContactID) AS contact_id,
 CONVERT(varchar(10),checkhead.FCheckDate,23) AS settled_on,CONVERT(varchar(100),checkhead.FCheckAmount) AS amount,
 CONVERT(varchar(30),contact.FRP) AS contact_direction,CONVERT(varchar(30),contact.FType) AS contact_type,
 CONVERT(varchar(30),contact.FInvoiceID) AS contact_invoice,
 receipt.FNumber AS receipt_reference,
 CONVERT(varchar(30),receipt.FRP) AS receipt_direction,cur.FNumber AS receipt_currency
FROM dbo.t_rp_CheckEntry ce
LEFT JOIN dbo.t_RP_NewCheckInfo checkhead ON checkhead.FInterID=ce.FInterID
LEFT JOIN dbo.t_RP_Contact contact ON contact.FID=checkhead.FContactID
LEFT JOIN dbo.t_RP_NewReceiveBill receipt ON ce.FType_SRC=${settlement.source} AND receipt.FBillID=ce.FBillID_SRC
LEFT JOIN dbo.t_Currency cur ON cur.FCurrencyID=receipt.FCurrencyID
WHERE ce.FType=${settlement.type} AND EXISTS (SELECT 1 FROM dbo.t_rp_CheckEntry anchor
 WHERE anchor.FInterID=ce.FInterID AND anchor.FType=${settlement.type} AND anchor.FInvoiceID IN ${idsSql})`
});
type PaymentFact = Pick<
	StoredRow<'source_payments'>,
	| 'external_code'
	| 'order'
	| 'kind'
	| 'reference'
	| 'settled_on'
	| 'source_updated_at'
	| 'currency'
	| 'amount'
	| 'active'
> & { readonly invoiceFid: string; readonly $id: string };

/** A native check-header amount is attributable only when the complete header identifies one invoice and one receipt. */
export function mapPayments(
	rows: readonly SqlRow[],
	invoices: readonly FinancialDocument[],
	observedAt: string,
	baseCurrency: string,
	bill: Bill
): readonly PaymentFact[] {
	const { rp, type, source } = bill.settlement;
	const observed = Instant(observedAt);
	const base = currency(baseCurrency);
	const grouped = new Map<string, SqlRow[]>();
	for (const row of rows) {
		const key = id(row, 'check_id');
		grouped.set(key, [...(grouped.get(key) ?? []), row]);
	}
	const result: PaymentFact[] = [];
	for (const [checkId, entries] of grouped) {
		const first = entries[0];
		if (!first) continue;
		const invoiceId = id(first, 'invoice_id');
		const receiptId = id(first, 'receipt_id');
		const invoice = invoices.find((candidate) => candidate.fid === invoiceId);
		if (!invoice)
			return invalid(
				'FInvoiceID',
				'A settlement header contains an invoice without one verified owned order'
			);
		if (invoice.status === 'void')
			return invalid(
				'FCancellation',
				'A present receipt allocation against a void invoice requires a verified reversal policy'
			);
		const amount = columns(first).decimal('amount');
		const settledOn = columns(first).date('settled_on');
		const reference = text(first, 'receipt_reference');
		const receiptCurrency = currency(
			text(first, 'receipt_currency') === 'RMB' ? 'CNY' : text(first, 'receipt_currency')
		);
		if (invoice.currency !== base || receiptCurrency !== base)
			return invalid(
				'FCheckAmount',
				'The verified settlement amount is in base currency; foreign allocation requires a verified original-currency binding'
			);
		if (
			!BigDecimal.equals(
				BigDecimal.round(amount, {
					scale:
						new Intl.NumberFormat('en', { style: 'currency', currency: base }).resolvedOptions()
							.maximumFractionDigits ?? 2
				}),
				amount
			)
		)
			return invalid('FCheckAmount', 'The settlement amount exceeds its currency precision');
		const seen = new Set<string>();
		for (const row of entries) {
			const detail = id(row, 'detail_id');
			if (seen.has(detail)) return invalid('FDetailID', 'Duplicate settlement detail');
			seen.add(detail);
			if (
				id(row, 'type') !== String(type) ||
				id(row, 'source_type') !== String(source) ||
				id(row, 'invoice_id') !== invoiceId ||
				id(row, 'receipt_id') !== receiptId
			)
				return invalid(
					'FType_SRC',
					'Mixed receipt, offset or invoice allocation requires an explicit amount attribution'
				);
			if (
				id(row, 'header_id') !== checkId ||
				id(row, 'header_direction') !== String(rp) ||
				id(row, 'header_type') !== String(type) ||
				id(row, 'contact_direction') !== String(rp) ||
				id(row, 'contact_type') !== String(type) ||
				id(row, 'contact_invoice') !== invoiceId ||
				id(row, 'receipt_direction') !== String(rp)
			)
				return invalid('FContactID', 'Settlement, AR invoice and receipt identities do not agree');
			if (!invoice.lines.some((line) => line.entryId === id(row, 'invoice_entry')))
				return invalid('FEntryID', 'Settlement detail has no verified owned invoice line');
			if (
				!BigDecimal.equals(columns(row).decimal('amount'), amount) ||
				columns(row).date('settled_on') !== settledOn ||
				text(row, 'receipt_reference') !== reference
			)
				return invalid('FCheckAmount', 'Settlement header changed during the source read');
		}
		if (BigDecimal.isNegative(amount))
			return invalid(
				'FCheckAmount',
				'A negative settlement can be an unallocation; it is not a verified cash refund'
			);
		// The native AR settlement is the evidence; an unverified receipt status is not an approval or absence rule.
		if (BigDecimal.isZero(amount)) continue;
		const external = `${bill.ids.settlement}:${checkId}`;
		result.push({
			$id: external,
			external_code: external,
			order: invoice.owner.order,
			invoiceFid: invoice.fid,
			kind: bill.ids.settlement,
			reference: `${reference}/${checkId}`,
			settled_on: settledOn,
			source_updated_at: observed,
			currency: base,
			amount: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: amount.scale,
				maximumFractionDigits: amount.scale
			}).format(numeric(BigDecimal.format(amount))),
			active: true
		});
	}
	return result;
}

/** The receipts against this ledger's sales invoices, or the payments against its purchase invoices. */
export const readPaymentSource = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext,
	unchanged: boolean
) {
	// read once, and only if Kingdee moved or something changed here
	const known = yield* Effect.cached(
		ctx.query({
			transactions: {
				where: { source: { eq: instance }, kind: { eq: 'invoice' } },
				fields: ['erp_id', 'order']
			}
		})
	);
	// a settlement waits for its invoice to arrive here
	const graph = yield* readOrderGraph(
		directionsOf(ctx.configuration),
		instance,
		cursor,
		ctx,
		unchanged,
		undefined,
		known.pipe(Effect.map(({ transactions }) => String(transactions.rows.length)))
	);
	if (graph === null) return { rows: [], cursor, more: false };
	const { transactions: invoices } = yield* known;
	const facts: { readonly bill: Bill; readonly fact: PaymentFact }[] = [];
	for (const bill of Object.values(bills)) {
		const owned = graph.invoices.filter(
			(invoice): invoice is typeof invoice & { readonly status: 'issued' | 'void' } =>
				invoice.owner.direction === bill.direction && invoice.status !== 'draft'
		);
		const complete = yield* selectByIds(
			ctx,
			paymentProjection(bill),
			owned.map((invoice) => invoice.fid)
		);
		const mapped = yield* checked(() => {
			const byFid = new Map(owned.map((invoice) => [invoice.fid, invoice]));
			return [...Map.groupBy(complete, (row) => id(row, 'check_id'))].flatMap(
				([checkId, entries]) => {
					try {
						return mapPayments(
							entries,
							owned,
							graph.observedAt,
							ctx.configuration.baseCurrency,
							bill
						);
					} catch (cause) {
						if (!(cause instanceof SourceRowInvalid)) throw cause;
						const owners = entries.flatMap(
							(row) => byFid.get(String(row['invoice_id']))?.owner.order ?? []
						);
						if (!owners.length) throw cause;
						for (const owner of owners) graph.held.add(owner);
						graph.issues.push({ document: `settlement ${checkId}`, column: cause.column });
						return [];
					}
				}
			);
		});
		facts.push(...mapped.map((fact) => ({ bill, fact })));
	}
	const current = yield* checked(() =>
		facts
			.flatMap(({ bill, fact: { invoiceFid, ...fact } }) => {
				const erp = erpId(
					invoices.rows.map((row) => row.erp_id),
					bill.ids.invoice,
					invoiceFid
				);
				const invoice = invoices.rows.find((candidate) => candidate.erp_id === erp);
				if (!invoice || invoice.order !== fact.order) {
					graph.held.add(fact.order);
					graph.issues.push({
						document: `settlement ${fact.external_code}`,
						column: 'invoice counterpart'
					});
					return [];
				}
				return [{ ...fact, invoice: invoice.id }];
			})
			.filter((fact) => !graph.held.has(fact.order))
	);
	const { source_payments: previous } = yield* ctx.query({
		source_payments: {
			where: { source: { eq: instance } },
			fields: ['external_code', 'active', 'order']
		}
	});
	const present = new Set(current.map((fact) => fact.external_code));
	const rows = [
		...current,
		...previous.rows
			.filter(
				(row) =>
					row.active &&
					!present.has(row.external_code) &&
					row.order !== null &&
					graph.affected.has(row.order) &&
					!graph.held.has(row.order)
			)
			.map((row) => ({ $id: row.external_code, external_code: row.external_code, active: false }))
	];
	return yield* graph.page<(typeof rows)[number]>(rows);
});

export const readSalesFactSource = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext,
	unchanged: boolean
) {
	const costAccount = kingdeeDeliveryCostAccount(ctx.configuration);
	if (ctx.configuration.deliveryCostAccount?.trim() && costAccount === null)
		return yield* new SourceUnavailable({
			reason: 'Booked delivery cost requires a verified account identity'
		});
	const costCurrency = costAccount
		? yield* checked(() => currency(ctx.configuration.baseCurrency))
		: undefined;
	// The cursor's token remembers the cost account it read with. Switching booked cost on, or to another account,
	// reads every owned order's documents once more, as the feed's first read did, so retained deliveries gain it.
	const costing = costAccount ? `cost:${costAccount}` : '';
	const token =
		Predicate.hasProperty(cursor, 'token') && typeof cursor.token === 'string' ? cursor.token : '';
	const graph = yield* readOrderGraph(
		['sales'],
		instance,
		costing && token.slice(token.indexOf('|') + 1) !== costing ? null : cursor,
		ctx,
		unchanged,
		costAccount ?? undefined,
		Effect.succeed(costing)
	);
	if (graph === null) return { rows: [], cursor, more: false };
	const facts = yield* checked(() =>
		mapSalesFacts(
			graph.deliveries.filter(
				(doc): doc is typeof doc & { readonly status: 'issued' | 'void' } => doc.status !== 'draft'
			),
			graph.invoices.filter(
				(doc): doc is typeof doc & { readonly status: 'issued' | 'void' } => doc.status !== 'draft'
			),
			graph.observedAt,
			costCurrency
		)
	);
	const { source_sales_lines: previous } = yield* ctx.query({
		source_sales_lines: {
			where: { source: { eq: instance }, order: { is_null: false } },
			fields: ['external_code', 'order', 'source_updated_at', 'active', 'booked_cost_currency']
		}
	});
	yield* checked(() => {
		for (const fact of facts) {
			const old = previous.rows.find((candidate) => candidate.external_code === fact.external_code);
			if (
				old?.booked_cost_currency &&
				fact.booked_cost_currency &&
				old.booked_cost_currency !== fact.booked_cost_currency
			)
				return invalid(
					'baseCurrency',
					'The verified denomination of retained delivery costs changed'
				);
			if (old && (old.order !== fact.order || old.source_updated_at > fact.source_updated_at))
				return invalid('FSourceEntryID', 'Source evidence cannot change its original order');
		}
	});
	const present = new Set(facts.map((fact) => fact.external_code));
	const rows = [
		...facts,
		...previous.rows
			.filter(
				(row) =>
					row.active &&
					!present.has(row.external_code) &&
					row.order !== null &&
					graph.affected.has(row.order) &&
					!graph.held.has(row.order)
			)
			.map((row) => ({ $id: row.external_code, external_code: row.external_code, active: false }))
	];
	return yield* graph.page<(typeof rows)[number]>(rows);
});
