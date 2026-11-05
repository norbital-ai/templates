import { Effect, Schema } from 'effect';
import type { CreateRow, Id, SyncCtx } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/bolt/engine';
import { Decimal, currency, sum } from '@norbital-ai/std/decimal';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { agreements, agreementFields } from '../../lib/agreements.js';
import { sha256Hex } from '../../lib/commercial.js';
import { sourceOrderUuid } from './submission.js';
import {
	columns,
	query,
	SourceRowInvalid,
	type DatabaseContext,
	type SourcePage,
	type SqlRow
} from './polling.js';

export type OrderSourceContext = Pick<SyncCtx<'kingdee'>, 'db' | 'configuration' | 'request'>;
type Agreement = ReturnType<typeof agreements>[number];
type LocalLine = Agreement['snapshot']['lines'][number];
type SalesLine = {
	readonly entryId: string;
	readonly detailId: string;
	readonly itemId: string;
	readonly unit: string;
	readonly quantity: Decimal;
	readonly lotNumber: string | null;
	readonly netAmount: Decimal | null;
	readonly grossAmount: Decimal | null;
	readonly localLine: LocalLine;
	readonly upstream: { readonly fid: string; readonly entryId: string } | null;
};
type OwnedSales = {
	readonly fid: string;
	readonly externalId: string;
	readonly order: Id<'orders'>;
	readonly seal: string;
	readonly currency: string;
	readonly version: number;
	readonly uuid: string;
	readonly status: 'draft' | 'issued' | 'void';
	readonly reference: string;
	readonly liveFid: string;
	readonly lines: readonly SalesLine[];
};
type SalesDocument = {
	readonly fid: string;
	readonly reference: string;
	readonly issuedOn: ReturnType<typeof PlainDate>;
	readonly dueOn: ReturnType<typeof PlainDate> | null;
	readonly currency: string;
	readonly status: 'issued' | 'void';
	readonly owner: OwnedSales;
	readonly lines: readonly SalesLine[];
	readonly total: Decimal | null;
};
type SalesGraph = {
	readonly orders: readonly OwnedSales[];
	readonly deliveries: readonly SalesDocument[];
	readonly invoices: readonly SalesDocument[];
	readonly observedAt: ReturnType<typeof Instant>;
	readonly source: string;
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
		readonly discovery?: number;
	} = {}
) {
	return yield* query(ctx, {
		op: 'call',
		procedure: { schema: 'sys', name: 'sp_executesql' },
		arguments: {
			stmt: statement,
			params: '@ids xml,@branch nvarchar(10),@after nvarchar(512),@discovery int',
			ids: values.ids ?? '<ids/>',
			branch: values.branch ?? '',
			after: values.after ?? '',
			discovery: values.discovery ?? 0
		}
	});
});
/** Native SQL statements return at most one bounded key page, including the re-read lookahead. */
export const readNativeRows = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	source: NativeProjection,
	values: { readonly ids?: string; readonly branch?: string; readonly discovery?: number } = {}
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
const selectByIds = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	projection: NativeProjection,
	values: readonly string[],
	branch = '',
	discovery = 0
) {
	const rows: SqlRow[] = [];
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
		rows.push(...(yield* readNativeRows(ctx, projection, { ids: xml, branch, discovery })));
	}
	return rows;
});

const salesLineProjection: NativeProjection = {
	sql: `
SELECT ${padded('line.FDetailID')} AS __key,${textId('line.FInterID')} AS fid,
 ${textId('line.FDetailID')} AS detail_id,${textId('line.FEntryID')} AS entry_id,
 ${textId('line.FItemID')} AS item_id,unit.FName AS unit,
 CONVERT(varchar(100),line.FQty) AS quantity,CONVERT(varchar(100),line.FAuxPrice) AS unit_price,
 CONVERT(varchar(100),line.FTaxPrice) AS unit_price_inclusive,
 CONVERT(varchar(100),line.FCESS) AS tax_rate,CONVERT(varchar(100),line.FAmount) AS net_amount,
 CONVERT(varchar(100),line.FTaxAmt) AS tax_amount,CONVERT(varchar(100),line.FAllAmount) AS gross_amount
FROM dbo.SEOrderEntry line LEFT JOIN dbo.t_Item unit ON unit.FItemID=line.FUnitID AND unit.FItemClassID=7
WHERE line.FBrNO=@branch AND line.FInterID IN ${ids}`
};
const deliveryLineProjection: NativeProjection = {
	sql: `
SELECT ${padded('line.FInterID')}+':'+${padded('line.FEntryID')} AS __key,
 ${textId('line.FInterID')} AS fid,${textId('line.FEntryID')} AS entry_id,
 ${textId('line.FSourceTranType')} AS source_type,${textId('line.FSourceInterId')} AS source_fid,
 ${textId('line.FSourceEntryID')} AS source_entry,${textId('line.FItemID')} AS item_id,unit.FName AS unit,
 CONVERT(varchar(100),line.FQty) AS quantity,line.FBatchNo AS lot
FROM dbo.ICStockBillEntry line LEFT JOIN dbo.t_Item unit ON unit.FItemID=line.FUnitID AND unit.FItemClassID=7
WHERE (@discovery=0 AND line.FInterID IN ${ids}) OR (@discovery=1 AND line.FSourceTranType=81 AND line.FSourceInterId IN ${ids})`
};
const invoiceLineProjection: NativeProjection = {
	sql: `
SELECT ${padded('line.FDetailID')} AS __key,${textId('line.FInterID')} AS fid,
 ${textId('line.FDetailID')} AS detail_id,${textId('line.FEntryID')} AS entry_id,
 ${textId('line.FSourceTranType')} AS source_type,${textId('line.FSourceInterId')} AS source_fid,
 ${textId('line.FSourceEntryID')} AS source_entry,${textId('line.FItemID')} AS item_id,unit.FName AS unit,
 CONVERT(varchar(100),line.FQty) AS quantity,CONVERT(varchar(100),line.FAmount) AS net_amount,
 CONVERT(varchar(100),line.FAllAmount) AS gross_amount
FROM dbo.ICSaleEntry line LEFT JOIN dbo.t_Item unit ON unit.FItemID=line.FUnitID AND unit.FItemClassID=7
WHERE (@discovery=0 AND line.FInterID IN ${ids}) OR (@discovery=1 AND line.FSourceTranType=21 AND line.FSourceInterId IN ${ids})`
};
const documentHeaderProjection = (kind: 'delivery' | 'invoice'): NativeProjection => ({
	sql: `
SELECT ${padded('head.FInterID')} AS __key,${textId('head.FInterID')} AS fid,head.FBillNo AS reference,
 ${textId('head.FTranType')} AS type,CONVERT(varchar(10),head.FDate,23) AS date,
 CONVERT(varchar(10),head.FCheckDate,23) AS checked_on,head.FCancellation AS cancelled,head.FROB AS rob
 ${kind === 'invoice' ? ',cur.FNumber AS currency,CONVERT(varchar(10),head.FSettleDate,23) AS due_on' : ''}
FROM dbo.${kind === 'delivery' ? 'ICStockBill' : 'ICSale'} head
 ${kind === 'invoice' ? 'LEFT JOIN dbo.t_Currency cur ON cur.FCurrencyID=head.FCurrencyID' : ''}
WHERE head.FInterID IN ${ids}`
});

export type SealedSalesOwner = {
	readonly order: Id<'orders'>;
	readonly agreement: Pick<Agreement, 'version' | 'seal_hash'> &
		Partial<Pick<Agreement, 'kingdee' | 'lifecycle' | 'ordered_on'>> & {
			readonly snapshot: Pick<Agreement['snapshot'], 'currency' | 'lines' | 'tax_inclusive'> &
				Partial<Pick<Agreement['snapshot'], 'party_code' | 'payment_terms'>>;
		};
};
/** Pending new lines follow the writer's ordered allocation; accepted versions use captured bindings. */
export function sourceContractLine<
	L extends { readonly id: string; readonly source_entry_id?: string | null }
>(
	version: {
		readonly version: number;
		readonly lifecycle?: string | null;
		readonly snapshot: { readonly lines: readonly L[] };
		readonly kingdee?: {
			readonly entries?:
				readonly { readonly entry_id: string; readonly local_line_id: string }[] | null;
		} | null;
	},
	entryIds: readonly string[],
	position: string
): L | undefined {
	const mapping = version.kingdee?.entries?.find((entry) => entry.entry_id === position);
	if (mapping) return version.snapshot.lines.find((line) => line.id === mapping.local_line_id);
	const explicit = version.snapshot.lines.find((line) => line.source_entry_id === position);
	if (explicit) return explicit;
	if (version.lifecycle === 'pending' && version.version > 1) {
		const bound = new Set(version.snapshot.lines.flatMap((line) => line.source_entry_id ?? []));
		for (const entry of version.kingdee?.entries ?? []) bound.add(entry.entry_id);
		const unboundEntries = entryIds
			.filter((id) => !bound.has(id))
			.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
		const unboundLines = version.snapshot.lines.filter(
			(line) =>
				!line.source_entry_id &&
				!version.kingdee?.entries?.some((entry) => entry.local_line_id === line.id)
		);
		return unboundLines[unboundEntries.indexOf(position)];
	}
	return version.snapshot.lines[Number(position) - 1];
}
/** Families are discovered from an owned UUID first; a bill number alone never establishes ownership. */
const salesFamilyProjection: NativeProjection = {
	sql: `/* kingdee-contract-versions */
SELECT ${padded('head.FInterID')} AS __key,${textId('head.FInterID')} AS fid,head.FBrNo AS branch,
 CONVERT(varchar(36),head.FUUID) AS uuid,head.FBillNo AS reference,cur.FNumber AS currency,
 head.FVersionNo AS version,head.FCancellation AS cancelled,head.FChangeMark AS archive,head.FClosed AS closed,
 ${textId('head.FCheckerID')} AS checker,CONVERT(varchar(10),head.FCheckDate,23) AS checked_on,
 ${textId('head.FCustID')} AS customer_id,customer.FName AS customer_name,
 CONVERT(varchar(10),head.FDate,23) AS ordered_on,settlement.FNumber AS settlement,
 CONVERT(varchar(100),head.FExchangeRate) AS exchange_rate,
 CONVERT(varchar(33),head.FChangeDate,126) AS changed_at,${textId('head.FChangeUser')} AS changed_by,
 CONVERT(varchar(18),head.FOperDate,1) AS rowversion
FROM dbo.SEOrder head
 LEFT JOIN dbo.t_Currency cur ON cur.FCurrencyID=head.FCurrencyID
 LEFT JOIN dbo.t_Organization customer ON customer.FItemID=head.FCustID
 LEFT JOIN dbo.t_Settle settlement ON settlement.FItemID=head.FSettleID
WHERE head.FBrNo=@branch AND EXISTS (
 SELECT 1 FROM dbo.SEOrder anchor WHERE anchor.FBrNo=head.FBrNo AND anchor.FBillNo=head.FBillNo
 AND anchor.FUUID IN ${ids})`
};
export const readSourceOrderFamilies = Effect.fnUntraced(function* (
	local: readonly SealedSalesOwner[],
	ctx: DatabaseContext & { readonly configuration: { readonly branchNo: string } }
) {
	const anchors = new Map<string, Id<'orders'>>();
	for (const owner of local) {
		const values = [yield* sourceOrderUuid(owner.order, owner.agreement.seal_hash)];
		if (owner.agreement.kingdee?.source_uuid) values.push(owner.agreement.kingdee.source_uuid);
		for (const raw of values) {
			const uuid = raw.toLowerCase();
			const prior = anchors.get(uuid);
			if (prior && prior !== owner.order)
				return yield* new SourceRowInvalid({
					column: 'FUUID',
					reason: 'An owned source UUID belongs to multiple local orders'
				});
			anchors.set(uuid, owner.order);
		}
	}
	const headers = yield* selectByIds(
		ctx,
		salesFamilyProjection,
		[...anchors.keys()],
		ctx.configuration.branchNo
	);
	const lines = yield* selectByIds(
		ctx,
		salesLineProjection,
		headers.map((row) => exactId(row, 'fid')),
		ctx.configuration.branchNo
	);
	const verified = yield* selectByIds(
		ctx,
		salesFamilyProjection,
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
			reason:
				'The Kingdee contract family changed while its complete lines were being read; retry the observation'
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
		return [...references].map(([reference, order]) => {
			const family = headers.filter((header) => text(header, 'reference') === reference);
			const live = family.filter((header) => !flag(header, 'archive'));
			if (live.length !== 1)
				invalid('FChangeMark', 'An owned Kingdee family must identify exactly one live SO');
			const versions = new Set<string>();
			for (const header of family) {
				const version = text(header, 'version');
				if (!/^\d{3}$/.test(version) || versions.has(version))
					invalid('FVersionNo', 'Kingdee contract versions are missing or ambiguous');
				versions.add(version);
			}
			const current = live[0];
			if (!current) return invalid('FChangeMark', 'The owned live SO is missing');
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
/** Read each immutable local version against its actual current/archive source row. */
export const readOwnedSales = Effect.fnUntraced(function* (
	local: readonly SealedSalesOwner[],
	ctx: DatabaseContext & { readonly configuration: { readonly branchNo: string } }
) {
	const families = yield* readSourceOrderFamilies(local, ctx);
	return yield* checked(() => {
		const mapped: OwnedSales[] = [];
		for (const family of families) {
			const owners = local.filter((owner) => owner.order === family.order);
			const liveVersion = text(family.live, 'version');
			if (
				!owners.some(
					(owner) =>
						(owner.agreement.kingdee?.source_version ??
							String(owner.agreement.version - 1).padStart(3, '0')) === liveVersion
				)
			)
				return invalid(
					'FVersionNo',
					'Import the new Kingdee contract version before attributing its documents'
				);
			for (const owner of owners) {
				const { agreement } = owner;
				const version =
					agreement.kingdee?.source_version ?? String(agreement.version - 1).padStart(3, '0');
				const header = family.headers.find((header) => text(header, 'version') === version);
				const fid = header ? exactId(header, 'fid') : agreement.kingdee?.source_id;
				if (!fid) continue;
				const matching = header
					? family.lines.filter((entry) => exactId(entry, 'fid') === fid)
					: [];
				if (
					header &&
					(isoCurrency(header) !== agreement.snapshot.currency ||
						(agreement.snapshot.party_code !== undefined &&
							exactId(header, 'customer_id') !== agreement.snapshot.party_code) ||
						(agreement.snapshot.payment_terms !== undefined &&
							text(header, 'settlement') !== agreement.snapshot.payment_terms) ||
						(agreement.ordered_on !== undefined &&
							text(header, 'ordered_on') !== agreement.ordered_on))
				)
					return invalid(
						'SEOrder',
						'Kingdee commercial header differs from its immutable contract version'
					);
				if (
					header &&
					(matching.length !== agreement.snapshot.lines.length || matching.length === 0)
				)
					return invalid('SEOrderEntry', 'Owned source version has missing or additional lines');
				const positions = new Set<string>();
				const lines = header
					? matching.map((entry): SalesLine => {
							const position = exactId(entry, 'entry_id');
							const line = sourceContractLine(
								agreement,
								matching.map((entry) => exactId(entry, 'entry_id')),
								position
							);
							if (!line || positions.has(position))
								return invalid(
									'FEntryID',
									'Source positions cannot identify an immutable contract line'
								);
							positions.add(position);
							const r = columns(entry);
							const effective = Decimal.of(line.unit_price)
								.times(Decimal.of(100).minus(line.discount_pct))
								.div(100, 12);
							if (
								exactId(entry, 'item_id') !== line.product_code ||
								text(entry, 'unit') !== line.unit ||
								!r.decimal('quantity').eq(line.quantity) ||
								!r
									.decimal(agreement.snapshot.tax_inclusive ? 'unit_price_inclusive' : 'unit_price')
									.eq(effective) ||
								!r.decimal('tax_rate').eq(line.tax_rate) ||
								!r.decimal('net_amount').eq(line.net) ||
								!r.decimal('tax_amount').eq(line.tax) ||
								!r.decimal('gross_amount').eq(line.total)
							)
								return invalid(
									'SEOrderEntry',
									'Kingdee content differs from its immutable contract version'
								);
							return {
								entryId: position,
								detailId: exactId(entry, 'detail_id'),
								itemId: exactId(entry, 'item_id'),
								unit: line.unit,
								quantity: r.decimal('quantity'),
								lotNumber: null,
								netAmount: null,
								grossAmount: null,
								localLine: line,
								upstream: null
							};
						})
					: agreement.snapshot.lines.map((line, index): SalesLine => {
							const entry = agreement.kingdee?.entries?.find(
								(entry) => entry.local_line_id === line.id
							);
							if (!entry)
								return invalid(
									'FEntryID',
									'Missing archive history has no retained source line binding'
								);
							return {
								entryId: entry.entry_id,
								detailId: entry.detail_id,
								itemId: line.product_code,
								unit: line.unit,
								quantity: Decimal.of(line.quantity),
								lotNumber: null,
								netAmount: null,
								grossAmount: null,
								localLine: line,
								upstream: null
							};
						});
				const archived = header ? flag(header, 'archive') : true;
				const cancelled = header ? flag(header, 'cancelled') : false;
				const approved = header
					? sourceChecker(header) !== '0' && sourceDate(header, 'checked_on') !== null
					: agreement.kingdee?.status === 'issued';
				mapped.push({
					fid,
					liveFid: exactId(family.live, 'fid'),
					externalId: `sales:${ctx.configuration.branchNo}:${fid}:${agreement.seal_hash}`,
					order: owner.order,
					seal: agreement.seal_hash,
					currency: agreement.snapshot.currency,
					version: agreement.version,
					uuid: header
						? text(header, 'uuid').toLowerCase()
						: (agreement.kingdee?.source_uuid ?? ''),
					status: cancelled && !archived ? 'void' : approved ? 'issued' : 'draft',
					reference: family.reference,
					lines
				});
			}
		}
		return {
			orders: mapped,
			ownership: [
				...new Set(local.map((owner) => `${owner.order}:${owner.agreement.seal_hash}`))
			].sort()
		};
	});
});

const graphOrders = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	ctx: OrderSourceContext
) {
	const { orders } = yield* ctx.db.query({
		orders: {
			where: { ledger: { eq: instance }, direction: { eq: 'sales' } },
			fields: [...agreementFields, 'direction']
		}
	});
	return yield* readOwnedSales(
		orders.rows.flatMap((order) =>
			agreements(order).map((agreement) => ({ order: order.id, agreement }))
		),
		ctx
	);
});

export const readSalesDocuments = Effect.fnUntraced(function* (
	orders: readonly OwnedSales[],
	ctx: DatabaseContext,
	kind: 'delivery' | 'invoice',
	deliveries: readonly SalesDocument[] = [],
	retained: readonly { readonly kind: string; readonly fid: string; readonly seal: string }[] = []
) {
	const lineProjection = kind === 'delivery' ? deliveryLineProjection : invoiceLineProjection;
	const sourceType = kind === 'delivery' ? 81 : 21;
	const sources =
		kind === 'delivery'
			? orders.flatMap((order) => [order.fid, order.liveFid])
			: deliveries.map((delivery) => delivery.fid);
	const candidates = yield* selectByIds(ctx, lineProjection, sources, '', 1);
	const fids = yield* checked(() => [...new Set(candidates.map((row) => exactId(row, 'fid')))]);
	const headers = yield* selectByIds(ctx, documentHeaderProjection(kind), fids);
	// Re-read ALL lines by captured IDs. Never publish only the lines that matched a discovery join.
	const entries = yield* selectByIds(ctx, lineProjection, fids);
	const pendingIds = yield* checked(() =>
		headers
			.filter((header) => sourceDate(header, 'checked_on') === null)
			.map((header) => exactId(header, 'fid'))
	);
	const documents = yield* checked(() =>
		headers
			.filter((header) => !pendingIds.includes(exactId(header, 'fid')))
			.map((header): SalesDocument => {
				const fid = exactId(header, 'fid');
				if (exactId(header, 'type') !== (kind === 'delivery' ? '21' : '80'))
					return invalid(
						'FTranType',
						'This source document type has no verified transaction mapping'
					);
				if (String(header['rob']) !== '1')
					return invalid('FROB', 'Owned red/return documents require an explicit reversal mapping');
				const rows = entries.filter((entry) => exactId(entry, 'fid') === fid);
				if (!rows.length) return invalid('FInterID', 'Owned source document has no lines');
				let owner: OwnedSales | undefined;
				const lines = rows.map((entry): SalesLine => {
					if (exactId(entry, 'source_type') !== String(sourceType))
						return invalid(
							'FSourceTranType',
							'Owned document contains a line without verified order lineage'
						);
					const sourceFid = exactId(entry, 'source_fid');
					const sourceEntry = exactId(entry, 'source_entry');
					const pinned = retained.find(
						(document) => document.kind === kind && document.fid === fid
					);
					const candidates =
						kind === 'delivery'
							? orders.filter(
									(candidate) =>
										(candidate.fid === sourceFid || candidate.liveFid === sourceFid) &&
										(!pinned || candidate.seal === pinned.seal) &&
										candidate.lines.some(
											(line) =>
												line.entryId === sourceEntry && line.itemId === exactId(entry, 'item_id')
										)
								)
							: deliveries
									.filter((candidate) => candidate.fid === sourceFid)
									.map((candidate) => candidate.owner);
					if (candidates.length !== 1)
						return invalid(
							'contractVersion',
							'This source document has no unique contract-version lineage; retain the existing evidence and reconcile its version explicitly'
						);
					const order = candidates[0];
					if (pinned && order?.seal !== pinned.seal)
						return invalid(
							'contractVersion',
							'A retained physical document cannot move to another contract version'
						);
					const sourceLines =
						kind === 'delivery'
							? order?.lines
							: deliveries.find((candidate) => candidate.fid === sourceFid)?.lines;
					const matches = sourceLines?.filter((line) => line.entryId === sourceEntry) ?? [];
					const source = matches[0];
					if (!order || matches.length !== 1 || !source)
						return invalid('FSourceEntryID', 'Document line has no unique owned source line');
					if (owner && owner.externalId !== order.externalId)
						return invalid(
							'FSourceInterId',
							'A multi-order source document cannot be attributed to one sealed order'
						);
					owner = order;
					const r = columns(entry);
					const quantity = r.decimal('quantity');
					if (
						exactId(entry, 'item_id') !== source.itemId ||
						text(entry, 'unit') !== source.unit ||
						quantity.lte(0) ||
						!quantity.round(3).eq(quantity)
					)
						return invalid(
							'ICStockBillEntry',
							'Source line item, unit or quantity is inconsistent with its original sealed line'
						);
					if (
						kind === 'invoice' &&
						(r.decimal('net_amount').lt(0) || r.decimal('gross_amount').lt(0))
					)
						return invalid(
							'ICSaleEntry',
							'A blue invoice line has a negative amount requiring an explicit reversal mapping'
						);
					return {
						entryId: exactId(entry, 'entry_id'),
						detailId:
							kind === 'invoice'
								? exactId(entry, 'detail_id')
								: `${fid}:${exactId(entry, 'entry_id')}`,
						itemId: source.itemId,
						unit: source.unit,
						quantity: r.decimal('quantity'),
						lotNumber: kind === 'delivery' ? nullableText(entry, 'lot') : source.lotNumber,
						netAmount: kind === 'invoice' ? r.decimal('net_amount') : null,
						grossAmount: kind === 'invoice' ? r.decimal('gross_amount') : null,
						localLine: source.localLine,
						upstream: { fid: sourceFid, entryId: sourceEntry }
					};
				});
				if (!owner) return invalid('FInterID', 'Document has no owned order');
				const docCurrency = kind === 'invoice' ? isoCurrency(header) : owner.currency;
				if (docCurrency !== owner.currency)
					return invalid('FCurrencyID', 'Invoice currency differs from the original sealed order');
				const issuedOn = sourceDate(header, 'date');
				if (!issuedOn || !sourceDate(header, 'checked_on'))
					return invalid('FCheckDate', 'Owned document is not an issued, dated transaction');
				return {
					fid,
					reference: text(header, 'reference'),
					issuedOn,
					dueOn: kind === 'invoice' ? sourceDate(header, 'due_on') : null,
					currency: docCurrency,
					status: flag(header, 'cancelled') ? 'void' : 'issued',
					owner,
					lines,
					total: kind === 'invoice' ? sum(lines.flatMap((line) => line.grossAmount ?? [])) : null
				};
			})
	);
	return { documents, pendingIds };
});

export const observation = Effect.fnUntraced(function* (ctx: DatabaseContext) {
	const identity = yield* nativeSql(
		ctx,
		'SELECT database_guid,recovery_fork_guid FROM sys.database_recovery_status WHERE database_id=DB_ID()'
	);
	const clock = yield* nativeSql(
		ctx,
		"SELECT CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at"
	);
	return yield* checked(() => ({
		identity: {
			database: text(identity[0] ?? {}, 'database_guid'),
			fork: text(identity[0] ?? {}, 'recovery_fork_guid')
		},
		observedAt: Instant(text(clock[0] ?? {}, 'observed_at'))
	}));
});
export const ownershipSource = Effect.fnUntraced(function* (
	identity: { readonly database: string; readonly fork: string },
	branch: string,
	ownership: readonly string[]
) {
	return `${yield* sha256Hex(JSON.stringify(identity))}:${yield* sha256Hex(JSON.stringify([branch, ownership]))}`;
});
/** Read only records whose existing FUUID belongs to one local sealed order; never adopt ERP history by bill number. */
export const readSalesGraph = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	ctx: OrderSourceContext
) {
	const decoded = yield* observation(ctx);
	const owned = yield* graphOrders(instance, ctx);
	const { ext_sales_orders: parents, transactions: retained } = yield* ctx.db.query({
		ext_sales_orders: {
			where: { source: { eq: instance } },
			fields: ['order', 'agreement_hash', 'external_id']
		},
		transactions: { where: { source: { eq: instance } }, fields: ['erp_id', 'seal_hash'] }
	});
	const orders = owned.orders.map((order) => ({
		...order,
		externalId:
			parents.rows.find(
				(parent) => parent.order === order.order && parent.agreement_hash === order.seal
			)?.external_id ?? order.externalId
	}));
	const pins = retained.rows.flatMap((row) => {
		const match = /^(delivery|invoice):(\d+):/.exec(row.erp_id);
		return match?.[1] && match[2] ? [{ kind: match[1], fid: match[2], seal: row.seal_hash }] : [];
	});
	const delivery = yield* readSalesDocuments(orders, ctx, 'delivery', [], pins);
	const invoice = yield* readSalesDocuments(orders, ctx, 'invoice', delivery.documents, pins);
	const pending = [
		...delivery.pendingIds.map((id) => `delivery:${id}:`),
		...invoice.pendingIds.map((id) => `invoice:${id}:`)
	];
	if (pending.length > 0) {
		const { transactions: retained } = yield* ctx.db.query({
			transactions: { where: { source: { eq: instance } }, fields: ['erp_id'] }
		});
		if (retained.rows.some((row) => pending.some((prefix) => row.erp_id.startsWith(prefix))))
			return yield* new SourceRowInvalid({
				column: 'FCheckDate',
				reason:
					'A previously synchronized Kingdee document is no longer issued; review its unaudit or reversal before replacing the retained evidence'
			});
	}
	return {
		orders,
		deliveries: delivery.documents,
		invoices: invoice.documents,
		observedAt: decoded.observedAt,
		source: yield* ownershipSource(decoded.identity, ctx.configuration.branchNo, owned.ownership)
	} satisfies SalesGraph;
});
const Cursor = Schema.Struct({
	protocol: Schema.Literal('kingdee-owned-v1'),
	source: Schema.String,
	after: Schema.String.check(Schema.isPattern(/^(?:[\x21-\x7e]{1,512})?$/)),
	finish: Schema.Boolean
});
/** Page an already collected owned listing. Callers explicitly void missing records; no native hard-delete reconciliation. */
export const snapshotPage = Effect.fnUntraced(function* <R extends object>(
	rows: readonly (R & { readonly $id: string })[],
	cursor: Json | null,
	source: string
): Effect.fn.Return<SourcePage<R>, SourceRowInvalid> {
	const previous =
		cursor === null
			? null
			: yield* Schema.decodeUnknownEffect(Cursor)(cursor).pipe(
					Effect.mapError(
						(cause) => new SourceRowInvalid({ column: '$cursor', reason: String(cause) })
					)
				);
	if (
		previous?.source.includes(':') &&
		source.includes(':') &&
		previous.source.split(':')[0] !== source.split(':')[0]
	)
		return yield* new SourceRowInvalid({
			column: '$cursor',
			reason:
				'The source database or recovery fork changed; review the source before resetting its cursor'
		});
	// A newly approved local agreement starts a new authoritative listing, never finishes the previous scope.
	const current = previous?.source === source ? previous : null;
	if (current?.finish) return { rows: [], cursor: null, more: false };
	const sorted = yield* checked(() => {
		const result = [...rows].sort((a, b) => (a.$id < b.$id ? -1 : a.$id > b.$id ? 1 : 0));
		if (result.some((row, index) => index > 0 && row.$id === result[index - 1]?.$id))
			invalid('$id', 'Mapped Kingdee identities are not unique');
		return result;
	});
	const pending = sorted.filter((row) => row.$id > (current?.after ?? ''));
	const page = pending.slice(0, 999);
	return {
		rows: page,
		more: true,
		cursor: {
			protocol: 'kingdee-owned-v1',
			source,
			after: page.at(-1)?.$id ?? current?.after ?? '',
			finish: pending.length <= 999
		}
	};
});
export const readSalesOrders = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const observed = yield* observation(ctx);
	const owned = yield* graphOrders(instance, ctx);
	const source = yield* ownershipSource(
		observed.identity,
		ctx.configuration.branchNo,
		owned.ownership
	);
	const { ext_sales_orders: existing } = yield* ctx.db.query({
		ext_sales_orders: {
			where: { source: { eq: instance } },
			fields: ['external_id', 'order', 'agreement_hash']
		}
	});
	const stable = owned.orders.map((order) => ({
		...order,
		externalId:
			existing.rows.find((old) => old.order === order.order && old.agreement_hash === order.seal)
				?.external_id ?? order.externalId
	}));
	const present = new Set(stable.map((order) => order.externalId));
	const rows = stable.map((order) => ({
		$id: order.externalId,
		external_id: order.externalId,
		order: order.order,
		reference: order.reference,
		agreement_hash: order.seal,
		currency: currency(order.currency),
		status: order.status,
		source_updated_at: observed.observedAt
	}));
	const missing = existing.rows
		.filter(
			(order) =>
				!present.has(order.external_id) && !stable.some((version) => version.order === order.order)
		)
		.map((order) => ({
			$id: order.external_id,
			external_id: order.external_id,
			status: 'void' as const
		}));
	return yield* snapshotPage([...rows, ...missing], cursor, source);
});
export const readPurchaseOrders = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const { orders } = yield* ctx.db.query({
		orders: {
			where: { ledger: { eq: instance }, direction: { eq: 'purchasing' } },
			fields: agreementFields
		}
	});
	if (orders.rows.some((order) => agreements(order).length > 0))
		return yield* new SourceRowInvalid({
			column: 'POOrder',
			reason:
				'The purchase-order source has no verified sealed-order correlation; configure a verified binding before importing purchase orders'
		});
	return yield* snapshotPage<Pick<CreateRow<'ext_purchase_orders'>, 'external_id'>>(
		[],
		cursor,
		`purchase-empty:${instance}`
	);
});
export const readTransactions = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const graph = yield* readSalesGraph(instance, ctx);
	const { ext_sales_orders: parents, transactions: existing } = yield* ctx.db.query({
		ext_sales_orders: {
			where: { source: { eq: instance } },
			fields: ['external_id', 'status', 'order', 'agreement_hash']
		},
		transactions: { where: { source: { eq: instance } }, fields: ['erp_id'] }
	});
	const documents = [
		...graph.deliveries.map((document) => ({ kind: 'delivery' as const, document })),
		...graph.invoices.map((document) => ({ kind: 'invoice' as const, document }))
	];
	for (const { kind, document } of documents) {
		const parent = parents.rows.find((row) => row.external_id === document.owner.externalId);
		// A document poll can precede the SO poll; wait without writing or reconciling any evidence.
		if (!parent || parent.status === 'draft')
			return {
				rows: [],
				cursor,
				more: false,
				health: {
					state: 'attention' as const,
					code: 'parentPending',
					message: 'Waiting for the issued Kingdee SO counterpart before importing its documents.'
				}
			};
		if (
			parent.order !== document.owner.order ||
			parent.agreement_hash !== document.owner.seal ||
			(parent.status === 'void' &&
				(document.status !== 'void' ||
					!existing.rows.some(
						(row) => row.erp_id === `${kind}:${document.fid}:${document.owner.seal}`
					)))
		)
			return yield* new SourceRowInvalid({
				column: 'ext_sales_order',
				reason: 'Source documents must retain their issued SO counterpart and sealed agreement'
			});
	}
	const rows = yield* checked(() =>
		documents.map(({ kind, document }) => {
			const parent = parents.rows.find((row) => row.external_id === document.owner.externalId);
			if (!parent)
				return invalid(
					'ext_sales_order',
					'The owned order confirmation must sync before its documents'
				);
			const items = new Map<
				string,
				{
					order_line_id: string;
					product_name: string;
					unit: string;
					quantity: Decimal;
					lot_number: string | null;
					net_amount: Decimal | null;
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
						'Grouped source document rows disagree on their sealed line or unit'
					);
				// A merged invoice can contain several deliveries of the same sealed line and lot.
				items.set(identity, {
					order_line_id: line.localLine.id,
					product_name: line.localLine.product_name,
					unit: line.unit,
					quantity: previous ? previous.quantity.plus(line.quantity) : line.quantity,
					lot_number: line.lotNumber,
					net_amount: previous
						? previous.net_amount === null || line.netAmount === null
							? null
							: previous.net_amount.plus(line.netAmount)
						: line.netAmount
				});
			}
			const erp_id = `${kind}:${document.fid}:${document.owner.seal}`;
			return {
				$id: erp_id,
				erp_id,
				kind,
				order: document.owner.order,
				ext_sales_order: parent.id,
				ext_purchase_order: null,
				reference: document.reference,
				seal_hash: document.owner.seal,
				currency: currency(document.currency),
				status: document.status,
				issued_on: document.issuedOn,
				due_on: document.dueOn,
				total: document.total,
				items: [...items.values()],
				documents: [],
				source_updated_at: graph.observedAt
			};
		})
	);
	const present = new Set(rows.map((row) => row.erp_id));
	const missing = existing.rows
		.filter((row) => !present.has(row.erp_id))
		.map((row) => ({ $id: row.erp_id, erp_id: row.erp_id, status: 'void' as const }));
	return yield* snapshotPage([...rows, ...missing], cursor, graph.source);
});
