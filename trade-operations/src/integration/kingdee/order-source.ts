import { BigDecimal, Duration, Effect, Schema } from 'effect';
import type { Id, Row, SyncCtx, Json } from '@norbital-ai/bolt';
import { hash, sha256Hex, numeric } from '../../lib/commercial.js';
import { sourceOrderUuid } from './submission.js';
import { requireReadAccount } from './sql.js';
import { bills, directionsOf, type Bill, type Direction } from './bills.js';
import {
	columns,
	currency,
	Instant,
	PlainDate,
	query,
	SourceRowInvalid,
	type DatabaseContext,
	type SourcePage,
	type SqlRow
} from './polling.js';

export type OrderSourceContext = Pick<SyncCtx<'kingdee'>, 'query' | 'configuration' | 'request'>;
type LocalLine = Pick<Row<'order_lines'>, 'id' | 'product_name'>;
type SalesLine = {
	readonly entryId: string;
	readonly detailId: string;
	readonly itemId: string;
	readonly unit: string;
	readonly quantity: BigDecimal.BigDecimal;
	readonly lotNumber: string | null;
	readonly netAmount: BigDecimal.BigDecimal | null;
	readonly grossAmount: BigDecimal.BigDecimal | null;
	readonly costAmount?: BigDecimal.BigDecimal | null;
	readonly localLine: LocalLine;
	readonly upstream: { readonly fid: string; readonly entryId: string } | null;
};
type OwnedSales = {
	readonly direction: Direction;
	readonly fid: string;
	readonly order: Id<'orders'>;
	readonly currency: string;
	readonly status: 'draft' | 'issued' | 'void';
	readonly reference: string;
	readonly lines: readonly SalesLine[];
};
type SalesDocument = {
	readonly fid: string;
	readonly reference: string;
	readonly issuedOn: string;
	readonly dueOn: string | null;
	readonly currency: string;
	readonly status: 'issued' | 'void';
	readonly owner: OwnedSales;
	readonly lines: readonly SalesLine[];
	readonly total: BigDecimal.BigDecimal | null;
};
type DocumentIssue = { readonly document: string; readonly column: string };
type DocumentReview = {
	readonly held: Set<Id<'orders'>>;
	readonly issues: DocumentIssue[];
};
const invalid = (name: string, reason: string): never => {
	throw new SourceRowInvalid({ column: name, reason });
};
export const exactId = (row: SqlRow, name: string): string => {
	const value = row[name];
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
	if (typeof value === 'string' && /^\d+$/.test(value.trim()))
		return BigInt(value.trim()).toString();
	return invalid(name, 'Expected an exact nonnegative Kingdee identifier');
};
export const flag = (row: SqlRow, name: string) =>
	typeof row[name] === 'boolean' ? row[name] : exactId(row, name) !== '0';
export const text = (row: SqlRow, name: string) => {
	const value = columns(row).text(name).trim();
	return value || invalid(name, 'Kingdee text is empty');
};
export const nullableText = (row: SqlRow, name: string) =>
	columns(row).text(name, null)?.trim() || null;
export const checked = <A>(read: () => A) =>
	Effect.try({
		try: read,
		catch: (cause) =>
			cause instanceof SourceRowInvalid
				? cause
				: new SourceRowInvalid({ column: '$row', reason: String(cause) })
	});
export const isoCurrency = (row: SqlRow) =>
	currency(text(row, 'currency') === 'RMB' ? 'CNY' : text(row, 'currency'));
export const sourceDate = (row: SqlRow, name: string) => {
	const value = nullableText(row, name);
	return value === null || value.slice(0, 10) <= '1901-01-01'
		? null
		: PlainDate(value.slice(0, 10));
};
/** KIS leaves both approval columns NULL on an ordinary unapproved SO. */
export const sourceChecker = (row: SqlRow) =>
	row['checker'] === null && sourceDate(row, 'checked_on') === null ? '0' : exactId(row, 'checker');

/** Static SQL belongs to this template. The existing database call API binds every data value. */
export type NativeProjection = { readonly sql: string };
const textId = (column: string) => `CONVERT(varchar(30),${column})`;
const padded = (column: string) => `RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),${column}),20)`;
const ids = "(SELECT n.value('.', 'nvarchar(100)') FROM @ids.nodes('/ids/id') AS key_list(n))";
const nativeSql = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	statement: string,
	values: {
		readonly ids?: string;
		readonly branch?: string;
		readonly after?: string;
		readonly account?: string;
		readonly from?: string;
		readonly to?: string;
	} = {}
) {
	return yield* query(ctx, {
		op: 'call',
		procedure: { schema: 'sys', name: 'sp_executesql' },
		arguments: {
			stmt: values.account ? requireReadAccount + '\n' + statement : statement,
			params:
				'@ids xml,@branch nvarchar(10),@after nvarchar(512),@from varchar(18),@to varchar(18)' +
				(values.account ? ',@read_account nvarchar(73)' : ''),
			from: values.from ?? '0x0000000000000000',
			to: values.to ?? '0x0000000000000000',
			ids: values.ids ?? '<ids/>',
			branch: values.branch ?? '',
			after: values.after ?? '',
			...(values.account ? { read_account: values.account } : {})
		}
	});
});
/** Native SQL statements return at most one bounded key page, including the re-read lookahead. */
export const readNativeRows = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	source: NativeProjection,
	values: { readonly ids?: string; readonly branch?: string; readonly account?: string } = {}
) {
	const rows: SqlRow[] = [];
	let after = '';
	for (;;) {
		const page = yield* nativeSql(
			ctx,
			`SELECT TOP 1000 * FROM (${source.sql}) AS source WHERE __key COLLATE Latin1_General_BIN2 > @after COLLATE Latin1_General_BIN2 ORDER BY __key COLLATE Latin1_General_BIN2`,
			{ ...values, after }
		);
		if (page.length > 1000)
			return yield* new SourceRowInvalid({
				column: '$result',
				reason: 'Kingdee exceeded the native page bound'
			});
		yield* checked(() => {
			let previous = after;
			for (const row of page) {
				const key = text(row, '__key');
				if (!/^[\x21-\x7e]{1,512}$/.test(key) || key <= previous)
					invalid('__key', 'Kingdee keys are not strictly increasing and unique');
				previous = key;
			}
		});
		const accepted = page.slice(0, 999);
		rows.push(...accepted);
		if (page.length < 1000) return rows;
		after = text(accepted[998] ?? {}, '__key');
	}
});
const batches = <A>(values: readonly A[]) =>
	Array.from({ length: Math.ceil(values.length / 200) }, (_, i) =>
		values.slice(i * 200, (i + 1) * 200)
	);
export const selectByIds = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	projection: NativeProjection,
	values: readonly string[],
	branch = '',
	account?: string
) {
	const rows = new Map<string, SqlRow>();
	for (const batch of batches([...new Set(values)])) {
		const xml = yield* checked(
			() =>
				`<ids>${batch
					.map((value) => {
						if (!/^(?:[0-9]+|[0-9a-f-]{36})$/i.test(value))
							return invalid('$id', 'Expected a Kingdee integer or owned UUID');
						return `<id>${value}</id>`;
					})
					.join('')}</ids>`
		);
		const page = yield* readNativeRows(ctx, projection, {
			ids: xml,
			branch,
			...(account === undefined ? {} : { account })
		});
		yield* checked(() => {
			for (const row of page) {
				const key = text(row, '__key');
				const prior = rows.get(key);
				// One physical record can be found through several input batches.
				if (prior && JSON.stringify(prior) !== JSON.stringify(row))
					invalid('__key', 'Kingdee returned conflicting observations for the same key');
				rows.set(key, row);
			}
		});
	}
	return [...rows.values()];
});

const orderLineProjection = (bill: Bill): NativeProjection => ({
	sql: `
SELECT ${padded('line.FDetailID')} AS __key,${textId('line.FInterID')} AS fid,
 ${textId('line.FDetailID')} AS detail_id,${textId('line.FEntryID')} AS entry_id,
 ${textId('line.FItemID')} AS item_id,unit.FName AS unit,
 CONVERT(varchar(100),line.FQty) AS quantity,CONVERT(varchar(100),line.${bill.price.exclusive}) AS unit_price,
 CONVERT(varchar(100),line.${bill.price.inclusive}) AS unit_price_inclusive,
 CONVERT(varchar(100),line.${bill.price.rate}) AS tax_rate,CONVERT(varchar(100),line.FAmount) AS net_amount,
 CONVERT(varchar(100),line.${bill.price.tax}) AS tax_amount,CONVERT(varchar(100),line.FAllAmount) AS gross_amount
FROM dbo.${bill.order}Entry line LEFT JOIN dbo.t_Item unit ON unit.FItemID=line.FUnitID AND unit.FItemClassID=7
WHERE line.FBrNO=@branch AND line.FInterID IN ${ids}`
});
const deliveryLineProjection = (cost: boolean): NativeProjection => ({
	sql: `
SELECT ${padded('line.FInterID')}+':'+${padded('line.FEntryID')} AS __key,
 ${textId('line.FInterID')} AS fid,${textId('line.FEntryID')} AS entry_id,
 ${textId('line.FSourceTranType')} AS source_type,${textId('line.FSourceInterId')} AS source_fid,
 ${textId('line.FSourceEntryID')} AS source_entry,${textId('line.FItemID')} AS item_id,unit.FName AS unit,
 CONVERT(varchar(100),line.FQty) AS quantity,line.FBatchNo AS lot
 ${cost ? ',CONVERT(varchar(100),line.FAmount) AS cost_amount' : ''}
FROM dbo.ICStockBillEntry line LEFT JOIN dbo.t_Item unit ON unit.FItemID=line.FUnitID AND unit.FItemClassID=7
WHERE line.FInterID IN ${ids}`
});
export const testDeliveryCosts = (ctx: DatabaseContext, account: string) =>
	readNativeRows(ctx, deliveryLineProjection(true), { account });
const invoiceLineProjection = (bill: Bill): NativeProjection => ({
	sql: `
SELECT ${padded('line.FDetailID')} AS __key,${textId('line.FInterID')} AS fid,
 ${textId('line.FDetailID')} AS detail_id,${textId('line.FEntryID')} AS entry_id,
 ${textId('line.FSourceTranType')} AS source_type,${textId('line.FSourceInterId')} AS source_fid,
 ${textId('line.FSourceEntryID')} AS source_entry,${textId('line.FItemID')} AS item_id,unit.FName AS unit,
 CONVERT(varchar(100),line.FQty) AS quantity,CONVERT(varchar(100),line.FAmount) AS net_amount,
 CONVERT(varchar(100),line.FAllAmount) AS gross_amount
FROM dbo.${bill.invoice}Entry line LEFT JOIN dbo.t_Item unit ON unit.FItemID=line.FUnitID AND unit.FItemClassID=7
WHERE line.FInterID IN ${ids}`
});
const documentIds = (bill: Bill, kind: 'delivery' | 'invoice') => `
SELECT DISTINCT line.FInterID AS fid
FROM dbo.${kind === 'delivery' ? 'ICStockBillEntry' : `${bill.invoice}Entry`} line
WHERE line.FSourceTranType=${kind === 'delivery' ? bill.type : bill.movement} AND line.FSourceInterId IN ${ids}
${
	kind === 'delivery'
		? `UNION
SELECT red.FInterID AS fid
FROM dbo.ICStockBillEntry red
JOIN dbo.ICStockBillEntry original ON original.FInterID=red.FSourceInterId
 AND original.FEntryID=red.FSourceEntryID
WHERE red.FSourceTranType=${bill.movement} AND original.FSourceTranType=${bill.type} AND original.FSourceInterId IN ${ids}`
		: ''
}`;
const documentHeaderProjection = (bill: Bill, kind: 'delivery' | 'invoice'): NativeProjection => ({
	sql: `/* kingdee-document-headers */
SELECT ${padded('candidate.fid')} AS __key,${textId('candidate.fid')} AS fid,
 ${textId('head.FInterID')} AS header_id,head.FBillNo AS reference,
 ${textId('head.FTranType')} AS type,CONVERT(varchar(10),head.FDate,23) AS date,
 CONVERT(varchar(10),head.FCheckDate,23) AS checked_on,head.FCancellation AS cancelled,head.FROB AS rob
 ${kind === 'invoice' ? `,cur.FNumber AS currency,${bill.dueOn} AS due_on` : ''}
FROM (${documentIds(bill, kind)}) candidate
 LEFT JOIN dbo.${kind === 'delivery' ? 'ICStockBill' : bill.invoice} head ON head.FInterID=candidate.fid
 ${kind === 'invoice' ? 'LEFT JOIN dbo.t_Currency cur ON cur.FCurrencyID=head.FCurrencyID' : ''}`
});

/** Families are discovered from an owned UUID first; a bill number alone never establishes ownership. */
const familyColumns = (bill: Bill) => `${textId('head.FInterID')} AS fid,head.FBrNo AS branch,
 CONVERT(varchar(36),head.FUUID) AS uuid,head.FBillNo AS reference,cur.FNumber AS currency,
 ${bill.versioned ? 'head.FVersionNo' : "'000'"} AS version,head.FCancellation AS cancelled,
 ${bill.versioned ? 'head.FChangeMark' : '0'} AS archive,
 CASE WHEN head.FClosed<>0 OR head.FStatus=3 THEN 1 ELSE 0 END AS closed,
 ${textId('head.FCheckerID')} AS checker,CONVERT(varchar(10),head.FCheckDate,23) AS checked_on,
 ${textId('head.FEmpID')} AS employee_id,${textId(`head.${bill.party}`)} AS party_id,party.FName AS party_name,
 CONVERT(varchar(10),head.FDate,23) AS ordered_on,settlement.FNumber AS settlement,
 CONVERT(varchar(100),CAST(head.FExchangeRate AS decimal(28,10))) AS exchange_rate,
 CONVERT(varchar(18),CONVERT(binary(8),head.FOperDate),1) AS rowversion
FROM dbo.${bill.order} head
 LEFT JOIN dbo.t_Currency cur ON cur.FCurrencyID=head.FCurrencyID
 LEFT JOIN dbo.${bill.parties} party ON party.FItemID=head.${bill.party}
 LEFT JOIN dbo.t_Settle settlement ON settlement.FItemID=head.FSettleID`;
export const familyProjection = (bill: Bill): NativeProjection => ({
	sql: `/* kingdee-${bill.name}-orders */
SELECT ${padded('head.FInterID')} AS __key,${familyColumns(bill)}
WHERE head.FBrNo=@branch AND EXISTS (
 SELECT 1 FROM dbo.${bill.order} anchor WHERE anchor.FBrNo=head.FBrNo AND anchor.FBillNo=head.FBillNo
 AND anchor.FUUID IN ${ids})`
});
/** One owned order family: its live header, every archived version, and their lines. */
export type SourceFamily = {
	readonly order: Id<'orders'>;
	readonly reference: string;
	readonly headers: readonly SqlRow[];
	readonly live: SqlRow;
	readonly lines: readonly SqlRow[];
};
export const readSourceOrderFamilies = Effect.fnUntraced(function* (
	bill: Bill,
	owned: readonly { readonly order: Id<'orders'>; readonly uuid: string }[],
	ctx: DatabaseContext & { readonly configuration: { readonly branchNo: string } }
) {
	const anchors = new Map<string, Id<'orders'>>();
	for (const owner of owned) {
		const uuid = owner.uuid.toLowerCase();
		const prior = anchors.get(uuid);
		if (prior && prior !== owner.order)
			return yield* new SourceRowInvalid({
				column: 'FUUID',
				reason: 'An owned source UUID belongs to multiple local orders'
			});
		anchors.set(uuid, owner.order);
	}
	const headers = yield* selectByIds(
		ctx,
		familyProjection(bill),
		[...anchors.keys()],
		ctx.configuration.branchNo
	);
	const lines = yield* selectByIds(
		ctx,
		orderLineProjection(bill),
		headers.map((row) => exactId(row, 'fid')),
		ctx.configuration.branchNo
	);
	const verified = yield* selectByIds(
		ctx,
		familyProjection(bill),
		[...anchors.keys()],
		ctx.configuration.branchNo
	);
	const stamp = (header: SqlRow) =>
		JSON.stringify([
			exactId(header, 'fid'),
			nullableText(header, 'rowversion'),
			text(header, 'version'),
			flag(header, 'archive'),
			flag(header, 'cancelled'),
			sourceChecker(header),
			nullableText(header, 'checked_on')
		]);
	const coherent = yield* checked(
		() =>
			headers.length === verified.length &&
			headers.every((header) => verified.some((after) => stamp(after) === stamp(header)))
	);
	if (!coherent)
		return yield* new SourceRowInvalid({
			column: 'FOperDate',
			reason: `The Kingdee ${bill.label} family changed while its complete lines were being read; retry the observation`
		});
	return yield* checked(() => {
		const references = new Map<string, Id<'orders'>>();
		for (const header of headers) {
			if (text(header, 'branch') !== ctx.configuration.branchNo)
				invalid('FBrNo', 'Kingdee returned a version from another branch');
			const owner = anchors.get(text(header, 'uuid').toLowerCase());
			if (!owner) continue;
			const reference = text(header, 'reference');
			const prior = references.get(reference);
			if (prior && prior !== owner)
				invalid('FBillNo', 'An owned bill family belongs to multiple local orders');
			references.set(reference, owner);
		}
		if (headers.some((header) => !references.has(text(header, 'reference'))))
			invalid('FUUID', 'Kingdee returned a bill family without an owned UUID anchor');
		return [...references].map(([reference, order]): SourceFamily => {
			const family = headers.filter((header) => text(header, 'reference') === reference);
			const live = family.filter((header) => !flag(header, 'archive'));
			if (live.length !== 1)
				invalid(
					'FChangeMark',
					`An owned Kingdee family must identify exactly one live ${bill.label}`
				);
			const versions = new Set<string>();
			for (const header of family) {
				const version = text(header, 'version');
				if (!/^\d{3}$/.test(version) || versions.has(version))
					invalid('FVersionNo', `Kingdee ${bill.label} versions are missing or ambiguous`);
				versions.add(version);
			}
			const current = live[0];
			if (!current) return invalid('FChangeMark', `The owned live ${bill.label} is missing`);
			return {
				order,
				reference,
				headers: family,
				live: current,
				lines: lines.filter((line) =>
					family.some((header) => exactId(header, 'fid') === exactId(line, 'fid'))
				)
			};
		});
	});
});
const sourceStatus = (header: SqlRow): 'draft' | 'issued' | 'void' =>
	flag(header, 'cancelled') && !flag(header, 'archive')
		? 'void'
		: sourceChecker(header) !== '0' && sourceDate(header, 'checked_on') !== null
			? 'issued'
			: 'draft';
const uniqueEntries = (lines: readonly SqlRow[]) => {
	const entries = lines.map((line) => exactId(line, 'entry_id'));
	if (new Set(entries).size !== entries.length)
		invalid('FEntryID', 'Kingdee order entry identities are ambiguous');
	return lines;
};
/** What Kingdee holds for one owned order: its live header and lines. */
export const kingdeeOrder = (family: Omit<SourceFamily, 'order'>) => {
	const header = family.live;
	const fid = exactId(header, 'fid');
	return {
		fid,
		uuid: text(header, 'uuid').toLowerCase(),
		reference: family.reference,
		version: text(header, 'version'),
		status: sourceStatus(header),
		closed: header['closed'] != null && flag(header, 'closed'),
		exchange_rate: columns(header).decimalText('exchange_rate'),
		currency: isoCurrency(header),
		party: exactId(header, 'party_id'),
		employee: header['employee_id'] == null ? null : exactId(header, 'employee_id'),
		payment_terms: text(header, 'settlement'),
		ordered_on: text(header, 'ordered_on'),
		lines: uniqueEntries(family.lines.filter((line) => exactId(line, 'fid') === fid))
			.map((line) => {
				const r = columns(line);
				return {
					entry: exactId(line, 'entry_id'),
					detail: exactId(line, 'detail_id'),
					item: exactId(line, 'item_id'),
					unit: text(line, 'unit'),
					quantity: r.decimalText('quantity'),
					exclusive: r.decimalText('unit_price'),
					inclusive: r.decimalText('unit_price_inclusive'),
					tax_rate: r.decimalText('tax_rate'),
					net: r.decimalText('net_amount'),
					tax: r.decimalText('tax_amount'),
					total: r.decimalText('gross_amount')
				};
			})
			.sort((a, b) => Number(a.entry) - Number(b.entry))
	};
};
export type KingdeeOrder = ReturnType<typeof kingdeeOrder>;
/**
 * Pairs each Kingdee entry with its order line: by the line's `source_entry_id`, else (a line the writer sent but no read
 * has bound yet) the unbound entries in ascending order against the unbound lines in id order, as the writer
 * allocated them.
 */
export function pairLines<
	L extends {
		readonly id: string;
		readonly source_entry_id: string | null;
		readonly product_code: string;
	}
>(local: readonly L[], kingdee: readonly KingdeeOrder['lines'][number][]) {
	const pairs = new Map<string, L>();
	for (const line of local)
		if (line.source_entry_id && kingdee.some((entry) => entry.entry === line.source_entry_id))
			pairs.set(line.source_entry_id, line);
	const unbound = local
		.filter((line) => !line.source_entry_id)
		.sort((a, b) => a.id.localeCompare(b.id));
	const free = kingdee.filter((entry) => !pairs.has(entry.entry));
	for (const [index, line] of unbound.entries()) {
		const entry = free[index];
		if (entry && entry.item === line.product_code) pairs.set(entry.entry, line);
	}
	return pairs;
}
/** The confirmed orders of one direction this ledger receives, with the FUUID each one's Kingdee order carries. */
export const ownedOrders = Effect.fnUntraced(function* (
	direction: Direction,
	instance: Id<'sys_integration'>,
	ctx: Pick<OrderSourceContext, 'query'>
) {
	const { orders } = yield* ctx.query({
		orders: {
			where: {
				ledger: { eq: instance },
				direction: { eq: direction },
				status: { eq: 'confirmed' }
			},
			party: { fields: ['external_code'] },
			lines: {}
		}
	});
	const owned = orders.rows.flatMap((order) =>
		order.write_target && order.source_order_key
			? [{ ...order, source_order_key: order.source_order_key }]
			: []
	);
	const anchors = yield* Effect.forEach(owned, (order) =>
		sourceOrderUuid(order.id, order.source_order_key).pipe(
			Effect.map((uuid) => ({ order: order.id, uuid }))
		)
	);
	return { owned, anchors };
});
/** Each owned order's live Kingdee order, its entries paired with the order's lines. */
export const readOwnedSales = Effect.fnUntraced(function* (
	bill: Bill,
	owned: readonly {
		readonly order: Id<'orders'>;
		readonly uuid: string;
		readonly currency: string;
		readonly lines: readonly Pick<
			Row<'order_lines'>,
			'id' | 'source_entry_id' | 'product_code' | 'product_name'
		>[];
	}[],
	ctx: DatabaseContext & { readonly configuration: { readonly branchNo: string } }
) {
	const families = yield* readSourceOrderFamilies(bill, owned, ctx);
	return yield* checked(() =>
		families.flatMap((family): OwnedSales[] => {
			const order = owned.find((row) => row.order === family.order);
			if (!order) return [];
			const source = kingdeeOrder(family);
			const pairs = pairLines(order.lines, source.lines);
			return [
				{
					direction: bill.direction,
					fid: source.fid,
					order: order.order,
					currency: order.currency,
					status: source.status,
					reference: source.reference,
					lines: source.lines.flatMap((entry): SalesLine[] => {
						const line = pairs.get(entry.entry);
						return line
							? [
									{
										entryId: entry.entry,
										detailId: entry.detail,
										itemId: entry.item,
										unit: entry.unit,
										quantity: BigDecimal.fromStringUnsafe(entry.quantity),
										lotNumber: null,
										netAmount: null,
										grossAmount: null,
										localLine: line,
										upstream: null
									}
								]
							: [];
					})
				}
			];
		})
	);
});
export const readSalesDocuments = Effect.fnUntraced(function* (
	bill: Bill,
	orders: readonly OwnedSales[],
	ctx: DatabaseContext,
	kind: 'delivery' | 'invoice',
	deliveries: readonly SalesDocument[] = [],
	retained: readonly {
		readonly kind: string;
		readonly fid: string;
		readonly order: Id<'orders'>;
	}[] = [],
	costAccount?: string,
	review?: DocumentReview
) {
	const lineProjection =
		kind === 'delivery'
			? deliveryLineProjection(costAccount !== undefined)
			: invoiceLineProjection(bill);
	const sourceType = kind === 'delivery' ? bill.type : bill.movement;
	const movement = String(bill.movement);
	const sources =
		kind === 'delivery'
			? orders.map((order) => order.fid)
			: deliveries.map((delivery) => delivery.fid);
	const headers = yield* selectByIds(ctx, documentHeaderProjection(bill, kind), sources);
	const pendingIds = yield* checked(() => {
		if (
			headers.some(
				(header) =>
					header.header_id === null || exactId(header, 'header_id') !== exactId(header, 'fid')
			)
		)
			return invalid(
				'FInterID',
				'A discovered Kingdee document is missing its header; retry the observation'
			);
		return headers
			.filter((header) => sourceDate(header, 'checked_on') === null)
			.map((header) => exactId(header, 'fid'));
	});
	const pending = new Set(pendingIds);
	// Read all lines of issued documents, including lines that did not match discovery.
	const entries = yield* selectByIds(
		ctx,
		lineProjection,
		headers.map((header) => exactId(header, 'fid')).filter((fid) => !pending.has(fid)),
		'',
		costAccount
	);
	const documents = yield* checked(() => {
		const resolved = new Map<string, SalesDocument>();
		const byFid = new Map(deliveries.map((delivery) => [delivery.fid, delivery]));
		const rowsByFid = Map.groupBy(entries, (entry) => exactId(entry, 'fid'));
		const pins = new Map(
			retained.filter((pin) => pin.kind === kind).map((pin) => [pin.fid, pin.order])
		);
		const byOrderFid = new Map<string, OwnedSales[]>();
		for (const order of orders) {
			const list = byOrderFid.get(order.fid) ?? [];
			list.push(order);
			byOrderFid.set(order.fid, list);
		}
		const related = new Map<string, Set<Id<'orders'>>>();
		const issue = (fid: string, column: string, affected: ReadonlySet<Id<'orders'>>) => {
			if (!review || !affected.size) return false;
			for (const order of affected) review.held.add(order);
			review.issues.push({ document: `${kind} ${fid}`, column });
			return true;
		};
		for (const fid of pending) {
			const pinned = pins.get(fid);
			if (pinned) issue(fid, 'FCheckDate', new Set([pinned]));
		}
		const issued = headers.filter((header) => !pending.has(exactId(header, 'fid')));
		// Delivery reversals can refer to an original delivery regardless of their physical ID order.
		issued.sort((a, b) => Number(b['rob']) - Number(a['rob']));
		for (const header of issued) {
			const fid = exactId(header, 'fid');
			const rows = rowsByFid.get(fid) ?? [];
			const pinned = pins.get(fid);
			const affected = new Set<Id<'orders'>>();
			if (pinned) affected.add(pinned);
			if (review) {
				for (const entry of rows) {
					const sourceType = String(entry['source_type']);
					const sourceFid = String(entry['source_fid']);
					if (kind === 'delivery' && sourceType === String(bill.type))
						for (const order of byOrderFid.get(sourceFid) ?? []) affected.add(order.order);
					if (sourceType === movement) {
						const parent = kind === 'delivery' ? resolved.get(sourceFid) : byFid.get(sourceFid);
						if (parent) affected.add(parent.owner.order);
						if (kind === 'delivery')
							for (const order of related.get(sourceFid) ?? []) affected.add(order);
					}
				}
				related.set(fid, affected);
			}
			try {
				const rob = String(header['rob']);
				if (rob !== '1' && rob !== '-1')
					return invalid('FROB', 'Owned documents must be blue or red');
				const red = rob === '-1';
				const type = exactId(header, 'type');
				if (
					kind === 'delivery'
						? type !== movement
						: !(red ? bill.invoiceTypes.red : bill.invoiceTypes.blue).some(
								(known) => known === type
							)
				)
					return invalid(
						'FTranType',
						'This source document type has no verified transaction mapping'
					);
				if (!rows.length) return invalid('FInterID', 'Owned source document has no lines');
				let owner: OwnedSales | undefined;
				const lines = rows.map((entry): SalesLine => {
					const type = exactId(entry, 'source_type');
					const linkedReturn = kind === 'delivery' && red && type === movement;
					if (type !== String(sourceType) && !linkedReturn)
						return invalid(
							'FSourceTranType',
							'Owned document contains a line without verified order lineage'
						);
					const sourceFid = exactId(entry, 'source_fid');
					const sourceEntry = exactId(entry, 'source_entry');
					const parent = linkedReturn
						? resolved.get(sourceFid)
						: kind === 'invoice'
							? byFid.get(sourceFid)
							: undefined;
					const direct = kind === 'delivery' && !linkedReturn;
					const candidates = direct
						? (byOrderFid.get(sourceFid) ?? []).filter(
								(candidate) =>
									(!pinned || candidate.order === pinned) &&
									candidate.lines.some(
										(line) =>
											line.entryId === sourceEntry && line.itemId === exactId(entry, 'item_id')
									)
							)
						: parent
							? [parent.owner]
							: [];
					if (candidates.length !== 1)
						return invalid(
							'FSourceInterId',
							'This source document has no unique owned order; retain the existing evidence and reconcile it explicitly'
						);
					const order = candidates[0];
					if (pinned && order?.order !== pinned)
						return invalid(
							'FSourceInterId',
							'A retained physical document cannot move to another order'
						);
					const sourceLines = direct ? order?.lines : parent?.lines;
					const matches = sourceLines?.filter((line) => line.entryId === sourceEntry) ?? [];
					const source = matches[0];
					if (!order || matches.length !== 1 || !source)
						return invalid('FSourceEntryID', 'Document line has no unique owned source line');
					if (owner && owner.order !== order.order)
						return invalid(
							'FSourceInterId',
							'A multi-order source document cannot be attributed to one order'
						);
					owner = order;
					const r = columns(entry);
					const quantity = r.decimal('quantity');
					if (
						exactId(entry, 'item_id') !== source.itemId ||
						text(entry, 'unit') !== source.unit ||
						BigDecimal.isZero(quantity) ||
						(!red && BigDecimal.isNegative(quantity)) ||
						(linkedReturn &&
							(!BigDecimal.isPositive(source.quantity) ||
								BigDecimal.isGreaterThan(BigDecimal.abs(quantity), source.quantity))) ||
						!BigDecimal.equals(BigDecimal.round(quantity, { scale: 3 }), quantity)
					)
						return invalid(
							'ICStockBillEntry',
							'Source line item, unit or quantity is inconsistent with its order line'
						);
					if (
						kind === 'invoice' &&
						!red &&
						(BigDecimal.isNegative(r.decimal('net_amount')) ||
							BigDecimal.isNegative(r.decimal('gross_amount')))
					)
						return invalid(
							`${bill.invoice}Entry`,
							'A blue invoice line has a negative amount requiring an explicit reversal mapping'
						);
					const costAmount = r.decimal('cost_amount', null);
					const signed = (value: BigDecimal.BigDecimal) =>
						red ? BigDecimal.negate(BigDecimal.abs(value)) : value;
					return {
						entryId: exactId(entry, 'entry_id'),
						detailId:
							kind === 'invoice'
								? exactId(entry, 'detail_id')
								: `${fid}:${exactId(entry, 'entry_id')}`,
						itemId: source.itemId,
						unit: source.unit,
						quantity: signed(quantity),
						lotNumber: kind === 'delivery' ? nullableText(entry, 'lot') : source.lotNumber,
						netAmount: kind === 'invoice' ? signed(r.decimal('net_amount')) : null,
						grossAmount: kind === 'invoice' ? signed(r.decimal('gross_amount')) : null,
						...(costAccount ? { costAmount: costAmount === null ? null : signed(costAmount) } : {}),
						localLine: source.localLine,
						upstream: { fid: sourceFid, entryId: sourceEntry }
					};
				});
				if (!owner) return invalid('FInterID', 'Document has no owned order');
				const docCurrency = kind === 'invoice' ? isoCurrency(header) : owner.currency;
				if (docCurrency !== owner.currency)
					return invalid('FCurrencyID', 'Invoice currency differs from its order');
				const issuedOn = sourceDate(header, 'date');
				if (!issuedOn || !sourceDate(header, 'checked_on'))
					return invalid('FCheckDate', 'Owned document is not an issued, dated transaction');
				resolved.set(fid, {
					fid,
					reference: text(header, 'reference'),
					issuedOn,
					dueOn: kind === 'invoice' ? sourceDate(header, 'due_on') : null,
					currency: docCurrency,
					status: flag(header, 'cancelled') ? 'void' : 'issued',
					owner,
					lines,
					total:
						kind === 'invoice'
							? BigDecimal.sumAll(lines.flatMap((line) => line.grossAmount ?? []))
							: null
				});
			} catch (cause) {
				if (!(cause instanceof SourceRowInvalid) || !issue(fid, cause.column, affected))
					throw cause;
			}
		}
		return [...resolved.values()];
	});
	return { documents, pendingIds };
});

/** Read only records whose existing FUUID belongs to one local order; never adopt ERP history by bill number. */
export const readOrderGraph = Effect.fnUntraced(function* (
	directions: readonly Direction[],
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext,
	costAccount?: string,
	/** What else an order held for review could be waiting on, beyond an order moving. */
	local = ''
) {
	const sides = yield* Effect.forEach(directions, (direction) =>
		ownedOrders(direction, instance, ctx).pipe(
			Effect.map((side) => ({ bill: bills[direction], ...side }))
		)
	);
	const anchors = sides.flatMap((side) => side.anchors);
	const uuid = (order: Id<'orders'>) => anchors.find((anchor) => anchor.order === order)?.uuid;
	// an order's documents are read when one of them moves in Kingdee, or when the order itself moved here: its SO
	// or PO was just read, audited or bound. Nothing lists every order's documents.
	const latest = sides
		.flatMap((side) => side.owned)
		.reduce((max, order) => (order.updated_at > max ? order.updated_at : max), '');
	const window = yield* orderWindow(
		ctx,
		cursor,
		200,
		`${latest}|${local}`,
		documentWindow(directions)
	);
	const before = window.before?.split('|')[0] ?? '';
	// commits can land out of their timestamps' order: orders stamped a little before the last read are read again
	const since =
		latest === before || !before
			? before
			: new Date(Date.parse(before) - Duration.toMillis(Duration.minutes(10))).toISOString();
	const moved = new Set(
		yield* checked(() =>
			window.headers.map((row) => `${text(row, 'direction')}:${exactId(row, 'fid')}`)
		)
	);
	const { transactions: retained } = yield* ctx.query({
		transactions: { where: { source: { eq: instance } }, fields: ['erp_id', 'order'] }
	});
	const review: DocumentReview = { held: new Set(), issues: [] };
	const deliveries: SalesDocument[] = [];
	const invoices: SalesDocument[] = [];
	const affected = new Set<Id<'orders'>>();
	for (const { bill, owned } of sides) {
		const touched = owned.filter(
			(order) =>
				(order.kingdee && moved.has(`${bill.direction}:${order.kingdee.fid}`)) ||
				(window.first &&
					((latest !== before && order.updated_at > since) ||
						window.retry.includes(uuid(order.id) ?? '')))
		);
		for (const order of touched) affected.add(order.id);
		const orders = yield* readOwnedSales(
			bill,
			touched.flatMap((order) => {
				const anchor = uuid(order.id);
				return anchor
					? [{ order: order.id, uuid: anchor, currency: order.currency, lines: order.lines }]
					: [];
			}),
			ctx
		);
		const pattern = new RegExp(`^(${bill.ids.delivery}|${bill.ids.invoice}):(\\d+)(?::|$)`);
		const pins = retained.rows.flatMap((row) => {
			const match = pattern.exec(row.erp_id);
			return match?.[1] && match[2]
				? [
						{
							kind: match[1] === bill.ids.delivery ? 'delivery' : 'invoice',
							fid: match[2],
							order: row.order
						}
					]
				: [];
		});
		const delivery = yield* readSalesDocuments(
			bill,
			orders,
			ctx,
			'delivery',
			[],
			pins,
			costAccount,
			review
		);
		const invoice = yield* readSalesDocuments(
			bill,
			orders,
			ctx,
			'invoice',
			delivery.documents,
			pins,
			undefined,
			review
		);
		deliveries.push(...delivery.documents);
		invoices.push(...invoice.documents);
	}
	return {
		...review,
		deliveries: deliveries.filter((doc) => !review.held.has(doc.owner.order)),
		invoices: invoices.filter((doc) => !review.held.has(doc.owner.order)),
		observedAt: window.observedAt,
		/** The orders this read covered: only their rows can be found missing. */
		affected,
		/** The page these rows make: an order held for review is read again when an order next moves. */
		page: Effect.fnUntraced(function* <R>(rows: readonly (R & { readonly $id: string })[]) {
			const closed = yield* window.close([...review.held].flatMap((order) => uuid(order) ?? []));
			return reviewedPage<R>({ rows, cursor: closed.cursor, more: window.more }, review);
		})
	};
});
const Cursor = Schema.Struct({
	protocol: Schema.Literal('kingdee-owned-v1'),
	source: Schema.String,
	after: Schema.String.check(Schema.isPattern(/^(?:[\x21-\x7e]{1,512})?$/)),
	finish: Schema.Boolean,
	// the order reads: the rowversion every header below has been read to, the ceiling of a window still being paged,
	// the SOs whose read is waiting on something local, and what they were waiting against
	bookmark: Schema.optionalKey(Schema.String),
	upper: Schema.optionalKey(Schema.String),
	waiting: Schema.optionalKey(Schema.Array(Schema.String)),
	token: Schema.optionalKey(Schema.String)
});
const verifyOwnedCursor = Effect.fnUntraced(function* (cursor: Json | null, source: string) {
	const previous =
		cursor === null
			? null
			: yield* Schema.decodeUnknownEffect(Cursor)(cursor).pipe(
					Effect.mapError(
						(cause) => new SourceRowInvalid({ column: '$cursor', reason: String(cause) })
					)
				);
	const old = previous?.source.split(':');
	const current = source.split(':');
	if (
		old &&
		old.length >= 2 &&
		current.length >= 2 &&
		(old[0] !== current[0] || (old.length === 3 && old[1] !== current[1]))
	)
		return yield* new SourceRowInvalid({
			column: '$cursor',
			reason:
				'The source database, recovery fork or branch changed; review the source before resetting its cursor'
		});
	return previous;
});
const WAITING = 500;
const within = (column: string) =>
	`${column}>=CONVERT(binary(8),@from,1) AND ${column}<CONVERT(binary(8),@to,1)`;
/** The order headers of the branch that moved in the window, each keyed and named by its direction. */
export const headerWindow = (directions: readonly Direction[]) =>
	`${directions
		.map(
			(direction) =>
				`SELECT '${direction}' AS direction,'${direction[0]}'+${padded('head.FInterID')} AS __key,${familyColumns(bills[direction])}
WHERE head.FBrNo=@branch AND ${within('head.FOperDate')}`
		)
		.join('\nUNION ALL\n')} /* kingdee-order-window */`;
/**
 * The orders a goods movement, return, invoice or settlement that moved in the window belongs to. KIS stamps document
 * headers, never their lines, so each is followed from its header to the order its lines name; a settlement allocated
 * to an invoice moves that invoice's open item in `t_RP_Contact`.
 */
const documentWindow = (directions: readonly Direction[]) => `/* kingdee-document-window */
SELECT moved.direction,LEFT(moved.direction,1)+${padded('moved.fid')} AS __key,${textId('moved.fid')} AS fid FROM (
${directions
	.map((direction) => {
		const { type, movement, invoice, settlement } = bills[direction];
		return ` SELECT '${direction}' AS direction,line.FSourceInterId AS fid FROM dbo.ICStockBill head JOIN dbo.ICStockBillEntry line ON line.FInterID=head.FInterID
 WHERE head.FTranType=${movement} AND line.FSourceTranType=${type} AND ${within('head.FOperDate')}
 UNION SELECT '${direction}',original.FSourceInterId FROM dbo.ICStockBill head
 JOIN dbo.ICStockBillEntry red ON red.FInterID=head.FInterID AND red.FSourceTranType=${movement}
 JOIN dbo.ICStockBillEntry original ON original.FInterID=red.FSourceInterId AND original.FEntryID=red.FSourceEntryID
 WHERE head.FTranType=${movement} AND original.FSourceTranType=${type} AND ${within('head.FOperDate')}
 UNION SELECT '${direction}',delivery.FSourceInterId FROM dbo.${invoice} head
 JOIN dbo.${invoice}Entry line ON line.FInterID=head.FInterID AND line.FSourceTranType=${movement}
 JOIN dbo.ICStockBillEntry delivery ON delivery.FInterID=line.FSourceInterId
 WHERE delivery.FSourceTranType=${type} AND ${within('head.FOperDate')}
 UNION SELECT '${direction}',delivery.FSourceInterId FROM dbo.t_RP_Contact contact
 JOIN dbo.${invoice}Entry line ON line.FInterID=contact.FInvoiceID AND line.FSourceTranType=${movement}
 JOIN dbo.ICStockBillEntry delivery ON delivery.FInterID=line.FSourceInterId
 WHERE contact.FRP=${settlement.rp} AND contact.FType=${settlement.type} AND delivery.FSourceTranType=${type} AND ${within('contact.FModifyTime')}`;
	})
	.join('\n UNION\n')}
) moved WHERE moved.fid IS NOT NULL GROUP BY moved.direction,moved.fid`;

const invalidCursor = (reason: string) => new SourceRowInvalid({ column: '$cursor', reason });
/**
 * The order headers of the branch whose native rowversion moved since the bookmark, a page at a time: `[bookmark, upper)`
 * with `upper` the server's oldest active rowversion, captured before any row. Nothing is listed in full: a header
 * that did not move is not read, and Kingdee's deletes are soft, so they move a header too. An SO whose read waits on
 * something local (a customer not synchronized yet) is kept by UUID and read again when `token`, the caller's summary
 * of what it could be waiting on, changes.
 */
export const orderWindow = Effect.fnUntraced(function* (
	ctx: DatabaseContext & { readonly configuration: { readonly branchNo: string } },
	cursor: Json | null,
	size: number,
	token: string,
	moved: string
) {
	const [current] = yield* nativeSql(
		ctx,
		`SELECT database_guid,recovery_fork_guid,
CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at,
CONVERT(varchar(18),MIN_ACTIVE_ROWVERSION(),1) AS upper
FROM sys.database_recovery_status WHERE database_id=DB_ID()`
	);
	const observed = yield* checked(() => {
		const upper = text(current ?? {}, 'upper').toLowerCase();
		if (!/^0x[0-9a-f]{16}$/.test(upper)) invalid('upper', 'The rowversion ceiling is unavailable');
		return {
			database: text(current ?? {}, 'database_guid'),
			fork: text(current ?? {}, 'recovery_fork_guid'),
			at: Instant(text(current ?? {}, 'observed_at')),
			upper
		};
	});
	const scope = `${yield* sha256Hex(JSON.stringify({ database: observed.database, fork: observed.fork }))}:${yield* sha256Hex(ctx.configuration.branchNo)}`;
	const previous = yield* verifyOwnedCursor(cursor, scope);
	const open = previous && !previous.finish && previous.upper ? previous : null;
	const from = previous?.bookmark ?? '0x0000000000000000';
	const to = open?.upper ?? observed.upper;
	const after = open?.after ?? '';
	if (to < from)
		return yield* invalidCursor('The source rowversion moved behind the saved bookmark');
	const page = yield* nativeSql(
		ctx,
		`SELECT TOP ${size + 1} * FROM (${moved}) AS source WHERE __key COLLATE Latin1_General_BIN2 > @after COLLATE Latin1_General_BIN2 ORDER BY __key COLLATE Latin1_General_BIN2`,
		{ branch: ctx.configuration.branchNo, after, from, to }
	);
	const headers = page.slice(0, size);
	const more = page.length > size;
	const first = after === '';
	const kept = previous?.waiting ?? [];
	const retry = first && previous?.token !== token ? kept : [];
	return {
		account: `${observed.database}/${observed.fork}`.toLowerCase(),
		observedAt: observed.at,
		/** The token the last completed read left, `null` before any. */
		before: previous?.token ?? null,
		headers,
		first,
		more,
		retry,
		/** The cursor this page leaves, with the SOs still waiting; unchanged when nothing moved. */
		close: Effect.fnUntraced(function* (waiting: readonly string[]) {
			const next = [...new Set([...kept.filter((uuid) => !retry.includes(uuid)), ...waiting])];
			const base = {
				protocol: 'kingdee-owned-v1' as const,
				source: scope,
				...(next.length ? { waiting: next.slice(0, WAITING) } : {}),
				token
			};
			const last = headers.at(-1);
			return {
				backlog: next.length > WAITING,
				cursor: more
					? {
							...base,
							after: yield* checked(() => text(last ?? {}, '__key')),
							finish: false,
							bookmark: from,
							upper: to
						}
					: {
							...base,
							after: '',
							finish: true,
							// an empty window keeps its bookmark: the cursor does not move, so nothing is committed
							bookmark: first && headers.length === 0 ? from : to
						}
			};
		})
	};
});
/** A document's transaction id: `<prefix>:<FInterID>`, or the id an earlier read gave it. */
export const erpId = (existing: readonly string[], kind: string, fid: string) =>
	existing.find((id) => id === `${kind}:${fid}` || id.startsWith(`${kind}:${fid}:`)) ??
	`${kind}:${fid}`;
export const readTransactions = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const directions = directionsOf(ctx.configuration);
	const graph = yield* readOrderGraph(directions, instance, cursor, ctx);
	const { transactions: existing, orders } = yield* ctx.query({
		transactions: { where: { source: { eq: instance } }, fields: ['erp_id', 'order'] },
		orders: {
			where: { ledger: { eq: instance }, direction: { in: [...directions] } },
			fields: ['kingdee']
		}
	});
	const known = existing.rows.map((row) => row.erp_id);
	const documents = [
		...graph.deliveries.map((document) => ({ kind: 'delivery' as const, document })),
		...graph.invoices.map((document) => ({ kind: 'invoice' as const, document }))
	];
	// a document needs its order's Kingdee order read as issued; a void one only voids documents already recorded
	for (const { kind, document } of documents) {
		const bill = bills[document.owner.direction];
		const status = orders.rows.find((order) => order.id === document.owner.order)?.kingdee?.status;
		if (
			!status ||
			status === 'draft' ||
			(status === 'void' &&
				(document.status !== 'void' ||
					!existing.rows.some((row) => row.erp_id === erpId(known, bill.ids[kind], document.fid))))
		) {
			graph.held.add(document.owner.order);
			graph.issues.push({
				document: `${kind} ${document.fid}`,
				column: `${bill.label} counterpart`
			});
		}
	}
	const rows = yield* checked(() =>
		documents
			.filter(({ document }) => !graph.held.has(document.owner.order))
			.map(({ kind, document }) => {
				const items = new Map<
					string,
					{
						order_line_id: string;
						product_name: string;
						unit: string;
						quantity: BigDecimal.BigDecimal;
						lot_number: string | null;
						net_amount: BigDecimal.BigDecimal | null;
					}
				>();
				for (const line of document.lines) {
					const identity = `${line.localLine.id}/${line.lotNumber ?? ''}`;
					const previous = items.get(identity);
					if (
						previous &&
						(previous.unit !== line.unit || previous.product_name !== line.localLine.product_name)
					)
						return invalid(
							'FEntryID',
							'Grouped source document rows disagree on their order line or unit'
						);
					// A merged invoice can contain several deliveries of the same order line and lot.
					items.set(identity, {
						order_line_id: line.localLine.id,
						product_name: line.localLine.product_name,
						unit: line.unit,
						quantity: previous ? BigDecimal.sum(previous.quantity, line.quantity) : line.quantity,
						lot_number: line.lotNumber,
						net_amount: previous
							? previous.net_amount === null || line.netAmount === null
								? null
								: BigDecimal.sum(previous.net_amount, line.netAmount)
							: line.netAmount
					});
				}
				const erp_id = erpId(known, bills[document.owner.direction].ids[kind], document.fid);
				return {
					$id: erp_id,
					erp_id,
					kind,
					order: document.owner.order,
					reference: document.reference,
					currency: currency(document.currency),
					status: document.status,
					issued_on: document.issuedOn,
					due_on: document.dueOn,
					total:
						document.total === null
							? null
							: new Intl.NumberFormat('en', {
									useGrouping: false,
									minimumFractionDigits: document.total.scale,
									maximumFractionDigits: document.total.scale
								}).format(numeric(BigDecimal.format(document.total))),
					items: [...items.values()].map((item) => ({
						...item,
						quantity: new Intl.NumberFormat('en', {
							useGrouping: false,
							minimumFractionDigits: item.quantity.scale,
							maximumFractionDigits: item.quantity.scale
						}).format(numeric(BigDecimal.format(item.quantity))),
						net_amount:
							item.net_amount === null
								? null
								: new Intl.NumberFormat('en', {
										useGrouping: false,
										minimumFractionDigits: item.net_amount.scale,
										maximumFractionDigits: item.net_amount.scale
									}).format(numeric(BigDecimal.format(item.net_amount)))
					})),
					documents: [],
					source_updated_at: graph.observedAt
				};
			})
	);
	const present = new Set(rows.map((row) => row.erp_id));
	const missing = existing.rows
		.filter(
			(row) =>
				graph.affected.has(row.order) && !present.has(row.erp_id) && !graph.held.has(row.order)
		)
		.map((row) => ({ $id: row.erp_id, erp_id: row.erp_id, status: 'void' as const }));
	return yield* graph.page([...rows, ...missing]);
});

export const reviewedPage = <R>(page: SourcePage<R>, review: DocumentReview): SourcePage<R> =>
	review.issues.length === 0
		? page
		: {
				...page,
				health: {
					state: 'attention',
					code: 'documentReview',
					message: `Review Kingdee ${review.issues
						.slice(0, 3)
						.map(({ document, column }) => `${document} (${column})`)
						.join(', ')}. Existing evidence is retained for ${review.held.size} affected order(s).`
				}
			};
