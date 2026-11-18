import { BigDecimal, Effect } from 'effect';
import type { InstanceId, Json, SyncCtx } from '@norbital-ai/bolt';
import { kingdeePurchaseAccount } from './configuration.js';
import { exactId, flag, isoCurrency, nullableText, sourceDate, text } from './order-source.js';
import {
	columns,
	currency,
	Instant,
	readSource,
	SourceRowInvalid,
	SourceUnavailable,
	type DatabaseContext,
	type SqlRow
} from './polling.js';
import { sourcePage, type SourceProjection } from './sql.js';

// The purchase side of the account set, read like every other document feed: by each header's native rowversion,
// never listed again after the first pass. A line is the identity (document id and entry); its links upstream (a
// receipt's purchase order, an invoice's receipt) are the native FSource* columns.
const ref = (tableAlias: string, name: string) => ({ tableAlias, name });
const field = (tableAlias: string, name: string, aggregate?: 'max') => ({
	column: ref(tableAlias, name),
	...(aggregate ? { aggregate } : {})
});
const join = (
	kind: 'left' | 'inner',
	name: string,
	alias: string,
	on: readonly (readonly [ReturnType<typeof ref>, string])[],
	where?: Readonly<Record<string, number>>
) => ({
	kind,
	table: { schema: 'dbo', name },
	alias,
	on: on.map(([left, key]) => ({ left, right: ref(alias, key) })),
	...(where ? { where } : {})
});
const masters = (header: string) => [
	join('left', 't_Supplier', 'supplier', [[ref(header, 'FSupplyID'), 'FItemID']]),
	join('left', 't_Item', 'product', [[ref('line', 'FItemID'), 'FItemID']]),
	join('left', 't_Item', 'unit', [[ref('line', 'FUnitID'), 'FItemID']])
];
const line = (header: string) => ({
	document_id: field(header, 'FInterID'),
	entry_id: field('line', 'FEntryID'),
	reference: field(header, 'FBillNo'),
	business_on: field(header, 'FDate'),
	checked_on: field(header, 'FCheckDate'),
	cancelled: field(header, 'FCancellation'),
	supplier_code: field(header, 'FSupplyID'),
	supplier_name: field('supplier', 'FName'),
	product_code: field('line', 'FItemID'),
	product_name: field('product', 'FName'),
	unit: field('unit', 'FName'),
	quantity: field('line', 'FQty')
});
const common = {
	key: 'document_id',
	keyParts: ['document_id', 'entry_id'],
	rowversion: 'FOperDate',
	dates: ['business_on', 'checked_on'],
	texts: ['document_id', 'entry_id', 'supplier_code', 'product_code']
} as const;

/** Purchase receipt lines (`ICStockBill` type 1): the lot, its warehouse and cost, and the order it received. */
export const purchaseReceiptProjection: SourceProjection = (() => {
	const fields = {
		...line('receipt'),
		net: field('line', 'FAmount'),
		lot_number: field('line', 'FBatchNo'),
		warehouse_code: field('line', 'FDCStockID'),
		source_type: field('line', 'FSourceTranType'),
		source_document: field('line', 'FSourceInterID'),
		source_entry: field('line', 'FSourceEntryID'),
		order_reference: field('po', 'FBillNo')
	};
	return {
		...common,
		table: { schema: 'dbo', name: 'ICStockBill' },
		alias: 'receipt',
		columns: Object.keys(fields),
		fields,
		joins: [
			join('inner', 'ICStockBillEntry', 'line', [[ref('receipt', 'FInterID'), 'FInterID']]),
			...masters('receipt'),
			// a line's source is a purchase order only where its source type says so; the mapper checks it
			join('left', 'POOrder', 'po', [[ref('line', 'FSourceInterID'), 'FInterID']], {
				FTranType: 71
			})
		],
		filters: [{ field: ref('receipt', 'FTranType'), op: 'eq', value: 1 }],
		decimals: ['quantity', 'net'],
		texts: [...common.texts, 'warehouse_code', 'source_type', 'source_document', 'source_entry']
	};
})();

/**
 * Purchase invoice lines (`ICPurchase`) with the lot of the receipt they bill and the invoice's payable
 * (`t_RP_Contact` FRP=0, FType=4): its amount, what remains open, its due date and the last payment against it.
 * A payment moves the payable's own rowversion, so the invoice is read again.
 */
export const purchaseInvoiceProjection: SourceProjection = (() => {
	const lineFields = {
		...line('invoice'),
		net: field('line', 'FAmount'),
		tax: field('line', 'FTaxAmount'),
		currency: field('denomination', 'FNumber'),
		source_type: field('line', 'FSourceTranType'),
		source_document: field('line', 'FSourceInterID'),
		source_entry: field('line', 'FSourceEntryID'),
		lot_number: field('received', 'FBatchNo')
	};
	// one payable per invoice is the measured shape; the maxima stay right should a payment row repeat it
	const fields = {
		...lineFields,
		billed: field('payable', 'FAmount', 'max'),
		open: field('payable', 'FRemainAmount', 'max'),
		due_on: field('payable', 'FRPDate', 'max'),
		paid_on: field('settlement', 'FCheckDate', 'max')
	};
	return {
		...common,
		table: { schema: 'dbo', name: 'ICPurchase' },
		alias: 'invoice',
		columns: Object.keys(fields),
		fields,
		joins: [
			join('inner', 'ICPurchaseEntry', 'line', [[ref('invoice', 'FInterID'), 'FInterID']]),
			...masters('invoice'),
			join('left', 't_Currency', 'denomination', [[ref('invoice', 'FCurrencyID'), 'FCurrencyID']]),
			join('left', 'ICStockBillEntry', 'received', [
				[ref('line', 'FSourceInterID'), 'FInterID'],
				[ref('line', 'FSourceEntryID'), 'FEntryID']
			]),
			join('left', 't_RP_Contact', 'payable', [[ref('invoice', 'FInterID'), 'FInvoiceID']], {
				FRP: 0,
				FType: 4
			}),
			join('left', 't_RP_NewCheckInfo', 'settlement', [[ref('payable', 'FID'), 'FContactID']], {
				FRP: 0,
				FType: 4
			})
		],
		groupBy: Object.values(lineFields).map((selected) => selected.column),
		rowversions: [ref('payable', 'FModifyTime')],
		dates: [...common.dates, 'due_on', 'paid_on'],
		decimals: ['quantity', 'net', 'tax', 'billed', 'open'],
		texts: [...common.texts, 'source_type', 'source_document', 'source_entry']
	};
})();

// Kingdee keeps ten decimals; a quantity is stored to three and an amount to its currency's minor units
const rounded = (row: SqlRow, name: string, scale: number) => {
	const value = columns(row).decimal(name, null);
	return value === null
		? null
		: BigDecimal.format(BigDecimal.normalize(BigDecimal.round(value, { scale })));
};
const minorUnits = (code: string) =>
	new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
		.maximumFractionDigits ?? 2;
const identity = (row: SqlRow) => `${exactId(row, 'document_id')}:${exactId(row, 'entry_id')}`;
/** The line's upstream identity when its native source is of `type`. */
const upstream = (row: SqlRow, type: string, kind: 'order' | 'receipt') =>
	nullableText(row, 'source_type') === type
		? `${kind}:${exactId(row, 'source_document')}:${exactId(row, 'source_entry')}`
		: null;
function purchaseLine(
	row: SqlRow,
	observedAt: string,
	kind: 'receipt' | 'invoice',
	denomination: string
) {
	const business_on = sourceDate(row, 'business_on');
	if (!business_on)
		throw new SourceRowInvalid({ column: 'FDate', reason: 'Expected a dated purchase document' });
	const money = (name: string) => rounded(row, name, minorUnits(denomination));
	return {
		external_code: `${kind}:${identity(row)}`,
		kind,
		reference: text(row, 'reference'),
		business_on,
		supplier_code: nullableText(row, 'supplier_code'),
		supplier_name: nullableText(row, 'supplier_name'),
		product_code: exactId(row, 'product_code'),
		product_name: nullableText(row, 'product_name'),
		lot_number: null,
		warehouse_code: null,
		unit: nullableText(row, 'unit') ?? '',
		quantity: rounded(row, 'quantity', 3) ?? '0',
		currency: currency(denomination),
		net_amount: money('net'),
		tax_amount: null,
		order_reference: null,
		upstream: null,
		billed_amount: null,
		open_amount: null,
		due_on: null,
		paid_on: null,
		source_updated_at: Instant(observedAt),
		active: sourceDate(row, 'checked_on') !== null && !flag(row, 'cancelled'),
		money
	};
}
// a receipt is costed in the account set's base currency
const receiptLine = (base: string) => (row: SqlRow, observedAt: string) => {
	const { money: _, ...line } = purchaseLine(row, observedAt, 'receipt', base);
	const ordered = upstream(row, '71', 'order');
	return {
		...line,
		lot_number: nullableText(row, 'lot_number'),
		warehouse_code: nullableText(row, 'warehouse_code'),
		order_reference: ordered ? nullableText(row, 'order_reference') : null,
		upstream: ordered
	};
};
const invoiceLine = (row: SqlRow, observedAt: string) => {
	const { money, ...line } = purchaseLine(row, observedAt, 'invoice', isoCurrency(row));
	const received = upstream(row, '1', 'receipt');
	return {
		...line,
		tax_amount: money('tax'),
		lot_number: received ? nullableText(row, 'lot_number') : null,
		upstream: received,
		billed_amount: money('billed'),
		open_amount: money('open'),
		due_on: sourceDate(row, 'due_on'),
		paid_on: sourceDate(row, 'paid_on')
	};
};

/** The purchase feeds share one verified account, enabled on one ledger per account set. */
const purchaseAccount = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	ctx: SyncCtx<'kingdee'>
) {
	const account = kingdeePurchaseAccount(ctx.configuration);
	if (account === null)
		return yield* new SourceUnavailable({
			reason: 'Purchase documents require a verified database and recovery fork identity'
		});
	const { sys_integration: ledgers } = yield* ctx.query({
		sys_integration: { where: { integration: { eq: 'kingdee' } }, fields: ['configuration'] }
	});
	if (
		ledgers.rows.some(
			(ledger) => ledger.id !== instance && kingdeePurchaseAccount(ledger.configuration) === account
		)
	)
		return yield* new SourceUnavailable({
			reason: 'Enable purchase documents on just one Kingdee ledger per account set'
		});
	return account;
});
const reader =
	<R extends object>(
		projection: SourceProjection,
		build: (ctx: SyncCtx<'kingdee'>) => (row: SqlRow, observedAt: string) => R
	) =>
	(instance: InstanceId<'kingdee'>, cursor: Json | null, ctx: SyncCtx<'kingdee'>) =>
		Effect.gen(function* () {
			if (!ctx.configuration.purchaseAccount?.trim()) return { rows: [], cursor, more: false };
			const account = yield* purchaseAccount(instance, ctx);
			return yield* readSource(projection, cursor, ctx, build(ctx), undefined, account);
		});
export const readPurchaseReceipts = reader(purchaseReceiptProjection, (ctx) =>
	receiptLine(ctx.configuration.baseCurrency)
);
export const readPurchaseInvoices = reader(purchaseInvoiceProjection, () => invoiceLine);

/** SQL Server checks every table, column and SELECT permission even when a projection returns no rows. */
export const testPurchases = (ctx: DatabaseContext, account: string) =>
	Effect.forEach(
		[purchaseReceiptProjection, purchaseInvoiceProjection],
		(projection) => sourcePage(ctx, projection, { limit: 0, account }),
		{ discard: true }
	);
