import { Effect } from 'effect';
import type { StoredRow, Id } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/bolt/engine';
import { Decimal, currency, minor_digits, sum } from '@norbital-ai/std/decimal';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import {
	readSalesGraph,
	reviewedPage,
	selectByIds,
	snapshotPage,
	type NativeProjection,
	type OrderSourceContext
} from './order-source.js';
import { columns, SourceRowInvalid, SourceUnavailable, type SqlRow } from './polling.js';
import { kingdeeDeliveryCostAccount } from './configuration.js';

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
	readonly seal: string;
	readonly currency: string;
};
type FinancialLine = {
	readonly entryId: string;
	readonly detailId: string;
	readonly unit: string;
	readonly quantity: Decimal;
	readonly lotNumber: string | null;
	readonly netAmount: Decimal | null;
	readonly grossAmount: Decimal | null;
	readonly costAmount?: Decimal | null;
	readonly localLine: { readonly id: string };
	readonly upstream: { readonly fid: string; readonly entryId: string } | null;
};
export type FinancialDocument = {
	readonly fid: string;
	readonly reference: string;
	readonly issuedOn: ReturnType<typeof PlainDate>;
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
	| 'seal_hash'
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
	quantity: Decimal | null,
	net: Decimal | null,
	gross: Decimal | null
): boolean => {
	if (quantity !== null && quantity.is_zero()) return false;
	if (net === null || gross === null) return true;
	if (net.lt(0) !== gross.lt(0)) return false;
	return gross.abs().gte(net.abs());
};
/** Invoice money belongs to its exact delivery line; matching only product or local line would double-count split deliveries. */
export function mapSalesFacts(
	deliveries: readonly FinancialDocument[],
	invoices: readonly FinancialDocument[],
	observedAt: string,
	costCurrency?: ReturnType<typeof currency>
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
					invoice.owner.seal !== source.delivery.owner.seal ||
					invoice.currency !== source.delivery.currency ||
					line.localLine.id !== source.line.localLine.id ||
					line.unit !== source.line.unit
				)
					return invalid('FSourceEntryID', 'Invoice evidence has no matching sealed delivery line');
				const net = line.netAmount;
				const gross = line.grossAmount;
				if (
					!signedAmounts(line.quantity, net, gross) ||
					(net !== null && line.quantity.lt(0) !== net.lt(0))
				)
					return invalid(
						'FAmount',
						'Source invoice amounts have an unsupported sign or tax relationship'
					);
				const billed = billedByDelivery.get(key) ?? [];
				billed.push(line);
				billedByDelivery.set(key, billed);
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
					seal_hash: invoice.owner.seal,
					unit: line.unit,
					quantity: line.quantity,
					currency: currency(invoice.currency),
					lot_number: source.line.lotNumber,
					unit_cost: null,
					booked_cost: null,
					booked_cost_currency: null,
					net_amount: net,
					tax_amount: net !== null && gross !== null ? gross.minus(net) : null,
					freight: null,
					active: true
				};
				return { key, fact, deliveryLine: source.line };
			})
		);
	const billedQuantities = new Map(
		[...billedByDelivery].map(([key, lines]) => [key, sum(lines.map((line) => line.quantity))])
	);
	const invoiced = invoiceFacts.map(({ key, fact, deliveryLine }) => {
		const quantity = billedQuantities.get(key);
		if (
			!costCurrency ||
			deliveryLine.costAmount == null ||
			!quantity ||
			deliveryLine.quantity.is_zero()
		)
			return fact;
		if (
			quantity.abs().gt(deliveryLine.quantity.abs()) ||
			(!quantity.is_zero() && quantity.lt(0) !== deliveryLine.quantity.lt(0))
		)
			return fact;
		return {
			...fact,
			booked_cost: deliveryLine.costAmount.times(fact.quantity).div(deliveryLine.quantity, 10),
			booked_cost_currency: costCurrency
		};
	});
	const shipmentFacts = deliveries.flatMap((delivery) =>
		delivery.lines.map((line): SalesFact & { $id: string } => {
			if (delivery.currency !== delivery.owner.currency || line.quantity.is_zero())
				return invalid('FQty', 'An owned delivery requires a quantity and its sealed currency');
			const returned = line.quantity.lt(0);
			if (
				returned &&
				((line.netAmount !== null && line.netAmount.gt(0)) ||
					(line.grossAmount !== null && line.grossAmount.gt(0)))
			)
				return invalid('FAmount', 'A return requires negative money with its negative quantity');
			const billed = billedByDelivery.get(`${delivery.fid}:${line.entryId}`) ?? [];
			const complete =
				billed.length > 0 &&
				sum(billed.map((entry) => entry.quantity)).eq(line.quantity) &&
				billed.every((entry) => entry.netAmount !== null && entry.grossAmount !== null);
			const net = complete ? sum(billed.flatMap((entry) => entry.netAmount ?? [])) : null;
			const gross = complete ? sum(billed.flatMap((entry) => entry.grossAmount ?? [])) : null;
			if (!signedAmounts(null, net, gross))
				return invalid(
					'FAmount',
					'Source invoice amounts have an unsupported sign or tax relationship'
				);
			const external = `${returned ? 'return' : 'shipment'}:${delivery.fid}:${line.entryId}`;
			const booked = costCurrency ? (line.costAmount ?? null) : null;
			return {
				$id: external,
				external_code: external,
				order: delivery.owner.order,
				order_line: line.localLine.id,
				kind: returned ? 'return' : 'shipment',
				reference: `${delivery.reference}/${line.entryId}`,
				business_on: delivery.issuedOn,
				source_updated_at: observed,
				seal_hash: delivery.owner.seal,
				unit: line.unit,
				quantity: line.quantity,
				currency: currency(delivery.currency),
				lot_number: line.lotNumber,
				unit_cost: null,
				booked_cost: booked,
				booked_cost_currency: booked === null ? null : (costCurrency ?? null),
				net_amount: net,
				tax_amount: net !== null && gross !== null ? gross.minus(net) : null,
				freight: null,
				active: delivery.status === 'issued'
			};
		})
	);
	return [...shipmentFacts, ...invoiced];
}

const idsSql = "(SELECT n.value('.', 'nvarchar(100)') FROM @ids.nodes('/ids/id') AS keys(n))";
/** All header entries are read before using its amount; the amount is not a per-line allocation. */
const paymentProjection: NativeProjection = {
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
LEFT JOIN dbo.t_RP_NewReceiveBill receipt ON ce.FType_SRC=5 AND receipt.FBillID=ce.FBillID_SRC
LEFT JOIN dbo.t_Currency cur ON cur.FCurrencyID=receipt.FCurrencyID
WHERE EXISTS (SELECT 1 FROM dbo.t_rp_CheckEntry anchor
 WHERE anchor.FInterID=ce.FInterID AND anchor.FType=3 AND anchor.FInvoiceID IN ${idsSql})`
};
type PaymentFact = Pick<
	StoredRow<'source_payments'>,
	| 'external_code'
	| 'order'
	| 'kind'
	| 'reference'
	| 'settled_on'
	| 'source_updated_at'
	| 'seal_hash'
	| 'currency'
	| 'amount'
	| 'active'
> & { readonly invoiceExternalId: string; readonly $id: string };

/** A native check-header amount is attributable only when the complete header identifies one invoice and one receipt. */
export function mapPayments(
	rows: readonly SqlRow[],
	invoices: readonly FinancialDocument[],
	observedAt: string,
	baseCurrency: string
): readonly PaymentFact[] {
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
				'A settlement header contains an invoice without one verified sealed owner'
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
		if (!amount.round(minor_digits(base)).eq(amount))
			return invalid('FCheckAmount', 'The settlement amount exceeds its currency precision');
		const seen = new Set<string>();
		for (const row of entries) {
			const detail = id(row, 'detail_id');
			if (seen.has(detail)) return invalid('FDetailID', 'Duplicate settlement detail');
			seen.add(detail);
			if (
				id(row, 'type') !== '3' ||
				id(row, 'source_type') !== '5' ||
				id(row, 'invoice_id') !== invoiceId ||
				id(row, 'receipt_id') !== receiptId
			)
				return invalid(
					'FType_SRC',
					'Mixed receipt, offset or invoice allocation requires an explicit amount attribution'
				);
			if (
				id(row, 'header_id') !== checkId ||
				id(row, 'header_direction') !== '1' ||
				id(row, 'header_type') !== '3' ||
				id(row, 'contact_direction') !== '1' ||
				id(row, 'contact_type') !== '3' ||
				id(row, 'contact_invoice') !== invoiceId ||
				id(row, 'receipt_direction') !== '1'
			)
				return invalid('FContactID', 'Settlement, AR invoice and receipt identities do not agree');
			if (!invoice.lines.some((line) => line.entryId === id(row, 'invoice_entry')))
				return invalid('FEntryID', 'Settlement detail has no verified owned invoice line');
			if (
				!columns(row).decimal('amount').eq(amount) ||
				columns(row).date('settled_on') !== settledOn ||
				text(row, 'receipt_reference') !== reference
			)
				return invalid('FCheckAmount', 'Settlement header changed during the source read');
		}
		if (amount.lt(0))
			return invalid(
				'FCheckAmount',
				'A negative settlement can be an unallocation; it is not a verified cash refund'
			);
		// The native AR settlement is the evidence; an unverified receipt status is not an approval or absence rule.
		if (amount.eq(0)) continue;
		const external = `receipt:${checkId}`;
		result.push({
			$id: external,
			external_code: external,
			order: invoice.owner.order,
			invoiceExternalId: `invoice:${invoice.fid}:${invoice.owner.seal}`,
			kind: 'receipt',
			reference: `${reference}/${checkId}`,
			settled_on: settledOn,
			source_updated_at: observed,
			seal_hash: invoice.owner.seal,
			currency: base,
			amount,
			active: true
		});
	}
	return result;
}

export const readPaymentSource = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const { orders: purchases } = yield* ctx.query({
		orders: {
			where: {
				ledger: { eq: instance },
				direction: { eq: 'purchasing' },
				seal_hash: { is_null: false }
			},
			fields: ['status'],
			limit: 1
		}
	});
	if (purchases.rows.length)
		return yield* new SourceUnavailable({
			reason: 'Purchase payments have no verified original-order and invoice allocation binding'
		});
	const graph = yield* readSalesGraph(instance, cursor, ctx);
	const complete = yield* selectByIds(
		ctx,
		paymentProjection,
		graph.invoices.map((invoice) => invoice.fid)
	);
	const facts = yield* checked(() => {
		const invoices = new Map(graph.invoices.map((invoice) => [invoice.fid, invoice]));
		return [...Map.groupBy(complete, (row) => id(row, 'check_id'))].flatMap(
			([checkId, entries]) => {
				try {
					return mapPayments(
						entries,
						graph.invoices,
						graph.observedAt,
						ctx.configuration.baseCurrency
					);
				} catch (cause) {
					if (!(cause instanceof SourceRowInvalid)) throw cause;
					const owners = entries.flatMap(
						(row) => invoices.get(String(row['invoice_id']))?.owner.order ?? []
					);
					if (!owners.length) throw cause;
					for (const owner of owners) graph.held.add(owner);
					graph.issues.push({ document: `settlement ${checkId}`, column: cause.column });
					return [];
				}
			}
		);
	});
	const { transactions: invoices } = yield* ctx.query({
		transactions: {
			where: { source: { eq: instance }, kind: { eq: 'invoice' } },
			fields: ['erp_id', 'order', 'seal_hash']
		}
	});
	const current = yield* checked(() =>
		facts
			.flatMap(({ invoiceExternalId, ...fact }) => {
				const invoice = invoices.rows.find((candidate) => candidate.erp_id === invoiceExternalId);
				if (!invoice || invoice.order !== fact.order || invoice.seal_hash !== fact.seal_hash) {
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
					(row.order === null || !graph.held.has(row.order))
			)
			.map((row) => ({ $id: row.external_code, external_code: row.external_code, active: false }))
	];
	return reviewedPage(
		yield* snapshotPage<(typeof rows)[number]>(rows, cursor, graph.source),
		graph
	);
});

export const readSalesFactSource = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const costAccount = kingdeeDeliveryCostAccount(ctx.configuration);
	if (ctx.configuration.deliveryCostAccount?.trim() && costAccount === null)
		return yield* new SourceUnavailable({
			reason: 'Booked delivery cost requires a verified account identity'
		});
	const costCurrency = costAccount
		? yield* checked(() => currency(ctx.configuration.baseCurrency))
		: undefined;
	const graph = yield* readSalesGraph(instance, cursor, ctx, costAccount ?? undefined);
	const facts = yield* checked(() =>
		mapSalesFacts(graph.deliveries, graph.invoices, graph.observedAt, costCurrency)
	);
	const { source_sales_lines: previous } = yield* ctx.query({
		source_sales_lines: {
			where: { source: { eq: instance }, order: { is_null: false } },
			fields: [
				'external_code',
				'order',
				'order_line',
				'seal_hash',
				'source_updated_at',
				'active',
				'booked_cost_currency'
			]
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
			if (
				old &&
				(old.order !== fact.order ||
					old.order_line !== fact.order_line ||
					old.seal_hash !== fact.seal_hash ||
					old.source_updated_at > fact.source_updated_at)
			)
				return invalid(
					'FSourceEntryID',
					'Source evidence cannot change its original sealed order or line'
				);
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
					(row.order === null || !graph.held.has(row.order))
			)
			.map((row) => ({ $id: row.external_code, external_code: row.external_code, active: false }))
	];
	return reviewedPage(
		yield* snapshotPage<(typeof rows)[number]>(rows, cursor, graph.source),
		graph
	);
});

/** FIsCreditMgr is an enable switch, not a hold decision; no verified account policy supplies credit_hold yet. */
export const readCreditSource = Effect.fnUntraced(function* () {
	return yield* new SourceUnavailable({
		reason:
			'The Kingdee account-set credit policy and hold decision have no verified source binding'
	});
});
