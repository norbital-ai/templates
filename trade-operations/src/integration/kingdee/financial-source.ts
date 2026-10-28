import { Effect } from 'effect';
import type { StoredRow, Id } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/bolt/engine';
import { Decimal, currency, sum } from '@norbital-ai/std/decimal';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import {
	readNativeRows,
	readSalesGraph,
	snapshotPage,
	type NativeProjection,
	type OrderSourceContext
} from './order-source.js';
import { columns, SourceRowInvalid, SourceUnavailable, type SqlRow } from './polling.js';

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
	readonly unit: string;
	readonly quantity: Decimal;
	readonly lotNumber: string | null;
	readonly netAmount: Decimal | null;
	readonly grossAmount: Decimal | null;
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
	| 'net_amount'
	| 'tax_amount'
	| 'freight'
	| 'active'
>;

/** Invoice money belongs to its exact delivery line; matching only product or local line would double-count split deliveries. */
export function mapSalesFacts(
	deliveries: readonly FinancialDocument[],
	invoices: readonly FinancialDocument[],
	observedAt: string
): readonly (SalesFact & { readonly $id: string })[] {
	const observed = Instant(observedAt);
	return deliveries.flatMap((delivery) =>
		delivery.lines.map((line): SalesFact & { $id: string } => {
			if (delivery.currency !== delivery.owner.currency || line.quantity.lte(0))
				return invalid(
					'FQty',
					'An owned delivery requires positive quantity and its sealed currency'
				);
			const billed = invoices
				.filter((invoice) => invoice.status === 'issued')
				.flatMap((invoice) =>
					invoice.lines
						.filter(
							(entry) =>
								entry.upstream?.fid === delivery.fid && entry.upstream.entryId === line.entryId
						)
						.map((entry) => {
							if (
								invoice.owner.order !== delivery.owner.order ||
								invoice.owner.seal !== delivery.owner.seal ||
								invoice.currency !== delivery.currency ||
								entry.localLine.id !== line.localLine.id ||
								entry.unit !== line.unit
							)
								return invalid('FSourceEntryID', 'Invoice evidence crosses a sealed delivery line');
							return entry;
						})
				);
			const complete =
				billed.length > 0 &&
				sum(billed.map((entry) => entry.quantity)).eq(line.quantity) &&
				billed.every((entry) => entry.netAmount !== null && entry.grossAmount !== null);
			const net = complete ? sum(billed.flatMap((entry) => entry.netAmount ?? [])) : null;
			const gross = complete ? sum(billed.flatMap((entry) => entry.grossAmount ?? [])) : null;
			if (net !== null && gross !== null && (net.lt(0) || gross.lt(net)))
				return invalid(
					'FAmount',
					'Source invoice amounts have an unsupported sign or tax relationship'
				);
			const external = `shipment:${delivery.fid}:${line.entryId}`;
			return {
				$id: external,
				external_code: external,
				order: delivery.owner.order,
				order_line: line.localLine.id,
				kind: 'shipment',
				reference: `${delivery.reference}/${line.entryId}`,
				business_on: delivery.issuedOn,
				source_updated_at: observed,
				seal_hash: delivery.owner.seal,
				unit: line.unit,
				quantity: line.quantity,
				currency: currency(delivery.currency),
				lot_number: line.lotNumber,
				unit_cost: null,
				net_amount: net,
				tax_amount: net !== null && gross !== null ? gross.minus(net) : null,
				freight: null,
				active: delivery.status === 'issued'
			};
		})
	);
}

const idsSql = "(SELECT n.value('.', 'nvarchar(100)') FROM @ids.nodes('/ids/id') AS keys(n))";
/** All header entries are re-read before using its amount; the amount is not a per-line allocation. */
const paymentProjection: NativeProjection = {
	sql: `
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
WHERE (@discovery=0 AND ce.FType=3 AND ce.FInvoiceID IN ${idsSql})
 OR (@discovery=1 AND ce.FInterID IN ${idsSql})`
};
const readPayments = Effect.fnUntraced(function* (
	ctx: OrderSourceContext,
	identifiers: readonly string[],
	discovery: number
) {
	const result: SqlRow[] = [];
	const unique = [...new Set(identifiers)];
	for (let start = 0; start < unique.length; start += 200) {
		const xml = yield* checked(
			() =>
				`<ids>${unique
					.slice(start, start + 200)
					.map((value) => {
						if (!/^\d+$/.test(value))
							return invalid('$id', 'Expected a verified native invoice or settlement identifier');
						return `<id>${value}</id>`;
					})
					.join('')}</ids>`
		);
		result.push(...(yield* readNativeRows(ctx, paymentProjection, { ids: xml, discovery })));
	}
	return result;
});
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
	const { orders: purchases } = yield* ctx.db.query({
		orders: {
			where: {
				ledger: { eq: instance },
				direction: { eq: 'purchasing' },
				seal_hash: { isNull: false }
			},
			fields: ['status'],
			limit: 1
		}
	});
	if (purchases.rows.length)
		return yield* new SourceUnavailable({
			reason: 'Purchase payments have no verified original-order and invoice allocation binding'
		});
	const graph = yield* readSalesGraph(instance, ctx);
	const found = yield* readPayments(
		ctx,
		graph.invoices.map((invoice) => invoice.fid),
		0
	);
	const headers = yield* checked(() => found.map((row) => id(row, 'check_id')));
	const complete = yield* readPayments(ctx, headers, 1);
	const facts = yield* checked(() => {
		const returned = new Set(complete.map((row) => id(row, 'check_id')));
		if (headers.some((header) => !returned.has(header)))
			return invalid(
				'FInterID',
				'A discovered settlement disappeared during the complete source read'
			);
		return mapPayments(complete, graph.invoices, graph.observedAt, ctx.configuration.baseCurrency);
	});
	const { transactions: invoices } = yield* ctx.db.query({
		transactions: {
			where: { source: { eq: instance }, kind: { eq: 'invoice' } },
			fields: ['erp_id', 'order', 'seal_hash']
		}
	});
	const current = yield* checked(() =>
		facts.map(({ invoiceExternalId, ...fact }) => {
			const invoice = invoices.rows.find((candidate) => candidate.erp_id === invoiceExternalId);
			if (!invoice || invoice.order !== fact.order || invoice.seal_hash !== fact.seal_hash)
				return invalid(
					'invoice',
					'The verified owned invoice must synchronize before its settlement'
				);
			return { ...fact, invoice: invoice.id };
		})
	);
	const { source_payments: previous } = yield* ctx.db.query({
		source_payments: { where: { source: { eq: instance } }, fields: ['external_code', 'active'] }
	});
	const present = new Set(current.map((fact) => fact.external_code));
	const rows = [
		...current,
		...previous.rows
			.filter((row) => row.active && !present.has(row.external_code))
			.map((row) => ({ $id: row.external_code, external_code: row.external_code, active: false }))
	];
	return yield* snapshotPage<(typeof rows)[number]>(rows, cursor, graph.source);
});

export const readSalesFactSource = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const graph = yield* readSalesGraph(instance, ctx);
	const facts = yield* checked(() =>
		mapSalesFacts(graph.deliveries, graph.invoices, graph.observedAt)
	);
	const { source_sales_lines: previous } = yield* ctx.db.query({
		source_sales_lines: {
			where: { source: { eq: instance } },
			fields: ['external_code', 'order', 'order_line', 'seal_hash', 'source_updated_at', 'active']
		}
	});
	yield* checked(() => {
		for (const fact of facts) {
			const old = previous.rows.find((candidate) => candidate.external_code === fact.external_code);
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
			.filter((row) => row.active && !present.has(row.external_code))
			.map((row) => ({ $id: row.external_code, external_code: row.external_code, active: false }))
	];
	return yield* snapshotPage<(typeof rows)[number]>(rows, cursor, graph.source);
});

/** FIsCreditMgr is an enable switch, not a hold decision; no verified account policy supplies credit_hold yet. */
export const readCreditSource = Effect.fnUntraced(function* () {
	return yield* new SourceUnavailable({
		reason:
			'The Kingdee account-set credit policy and hold decision have no verified source binding'
	});
});
