import { BigDecimal, Effect, Schema } from 'effect';
import type { Id, SyncCtx } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/bolt/engine';
import { dec, div, round, sum, text as decimalText, type D } from '../../lib/values.js';
import { agreements, agreementFields } from '../../lib/agreements.js';
import { hash, sha256Hex } from '../../lib/commercial.js';
import { sourceOrderUuid } from './submission.js';
import { requireReadAccount } from './sql.js';
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
type Agreement = ReturnType<typeof agreements>[number];
type LocalLine = Agreement['snapshot']['lines'][number];
type SalesLine = {
	readonly entryId: string;
	readonly detailId: string;
	readonly itemId: string;
	readonly unit: string;
	readonly quantity: D;
	readonly lotNumber: string | null;
	readonly netAmount: D | null;
	readonly grossAmount: D | null;
	readonly costAmount?: D | null;
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
	readonly issuedOn: string;
	readonly dueOn: string | null;
	readonly currency: string;
	readonly status: 'issued' | 'void';
	readonly owner: OwnedSales;
	readonly lines: readonly SalesLine[];
	readonly total: D | null;
};
type DocumentIssue = { readonly document: string; readonly column: string };
type DocumentReview = {
	readonly held: Set<Id<'orders'>>;
	readonly issues: DocumentIssue[];
};
type SalesGraph = DocumentReview & {
	readonly deliveries: readonly SalesDocument[];
	readonly invoices: readonly SalesDocument[];
	readonly observedAt: string;
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
		readonly account?: string;
	} = {}
) {
	return yield* query(ctx, {
		op: 'call',
		procedure: { schema: 'sys', name: 'sp_executesql' },
		arguments: {
			stmt: values.account ? requireReadAccount + '\n' + statement : statement,
			params:
				'@ids xml,@branch nvarchar(10),@after nvarchar(512)' +
				(values.account ? ',@read_account nvarchar(73)' : ''),
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
const invoiceLineProjection: NativeProjection = {
	sql: `
SELECT ${padded('line.FDetailID')} AS __key,${textId('line.FInterID')} AS fid,
 ${textId('line.FDetailID')} AS detail_id,${textId('line.FEntryID')} AS entry_id,
 ${textId('line.FSourceTranType')} AS source_type,${textId('line.FSourceInterId')} AS source_fid,
 ${textId('line.FSourceEntryID')} AS source_entry,${textId('line.FItemID')} AS item_id,unit.FName AS unit,
 CONVERT(varchar(100),line.FQty) AS quantity,CONVERT(varchar(100),line.FAmount) AS net_amount,
 CONVERT(varchar(100),line.FAllAmount) AS gross_amount
FROM dbo.ICSaleEntry line LEFT JOIN dbo.t_Item unit ON unit.FItemID=line.FUnitID AND unit.FItemClassID=7
WHERE line.FInterID IN ${ids}`
};
const documentIds = (kind: 'delivery' | 'invoice') => `
SELECT DISTINCT line.FInterID AS fid
FROM dbo.${kind === 'delivery' ? 'ICStockBillEntry' : 'ICSaleEntry'} line
WHERE line.FSourceTranType=${kind === 'delivery' ? 81 : 21} AND line.FSourceInterId IN ${ids}
${
	kind === 'delivery'
		? `UNION
SELECT red.FInterID AS fid
FROM dbo.ICStockBillEntry red
JOIN dbo.ICStockBillEntry original ON original.FInterID=red.FSourceInterId
 AND original.FEntryID=red.FSourceEntryID
WHERE red.FSourceTranType=21 AND original.FSourceTranType=81 AND original.FSourceInterId IN ${ids}`
		: ''
}`;
const documentHeaderProjection = (kind: 'delivery' | 'invoice'): NativeProjection => ({
	sql: `/* kingdee-document-headers */
SELECT ${padded('candidate.fid')} AS __key,${textId('candidate.fid')} AS fid,
 ${textId('head.FInterID')} AS header_id,head.FBillNo AS reference,
 ${textId('head.FTranType')} AS type,CONVERT(varchar(10),head.FDate,23) AS date,
 CONVERT(varchar(10),head.FCheckDate,23) AS checked_on,head.FCancellation AS cancelled,head.FROB AS rob
 ${kind === 'invoice' ? ',cur.FNumber AS currency,CONVERT(varchar(10),head.FSettleDate,23) AS due_on' : ''}
FROM (${documentIds(kind)}) candidate
 LEFT JOIN dbo.${kind === 'delivery' ? 'ICStockBill' : 'ICSale'} head ON head.FInterID=candidate.fid
 ${kind === 'invoice' ? 'LEFT JOIN dbo.t_Currency cur ON cur.FCurrencyID=head.FCurrencyID' : ''}`
});

export type SealedSalesOwner = {
	readonly order: Id<'orders'>;
	readonly agreement: Pick<Agreement, 'version' | 'seal_hash'> &
		Partial<Pick<Agreement, 'kingdee' | 'lifecycle' | 'ordered_on'>> & {
			readonly snapshot: Pick<Agreement['snapshot'], 'currency' | 'lines' | 'tax_inclusive'> &
				Partial<Pick<Agreement['snapshot'], 'party_code' | 'payment_terms'>>;
		};
};
/** The initial FUUID is the only identity we can infer without an observed amendment. */
export const sourceContractVersion = (agreement: {
	readonly version: number;
	readonly kingdee?: { readonly source_version: string } | null;
}) => agreement.kingdee?.source_version ?? (agreement.version === 1 ? '000' : null);
/** Pending new lines follow the writer's ordered allocation; accepted versions use captured bindings. */
export function sourceContractLine<
	L extends { readonly id: string; readonly source_entry_id?: string | null }
>(
	version: {
		readonly version: number;
		readonly lifecycle?: string | null;
		readonly write_target?: object | null;
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
	if (
		version.version > 1 &&
		(version.lifecycle === 'pending' || (version.write_target && !version.kingdee))
	) {
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
		const values: string[] = [];
		if (owner.agreement.version === 1)
			values.push(yield* sourceOrderUuid(owner.order, owner.agreement.seal_hash));
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
			if (!owners.some((owner) => sourceContractVersion(owner.agreement) === liveVersion))
				return invalid(
					'FVersionNo',
					'Import the new Kingdee contract version before attributing its documents'
				);
			const claimed = new Set<string>();
			for (const owner of owners) {
				const { agreement } = owner;
				const version = sourceContractVersion(agreement);
				if (version === null) continue;
				if (claimed.has(version))
					return invalid('FVersionNo', 'Multiple agreement seals claim the same Kingdee version');
				claimed.add(version);
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
							const effective = div(
								BigDecimal.multiply(
									dec(line.unit_price),
									BigDecimal.subtract(dec(100), dec(line.discount_pct))
								),
								100,
								12
							);
							if (
								exactId(entry, 'item_id') !== line.product_code ||
								text(entry, 'unit') !== line.unit ||
								!BigDecimal.equals(r.decimal('quantity'), dec(line.quantity)) ||
								!BigDecimal.equals(
									r.decimal(
										agreement.snapshot.tax_inclusive ? 'unit_price_inclusive' : 'unit_price'
									),
									effective
								) ||
								!BigDecimal.equals(r.decimal('tax_rate'), dec(line.tax_rate)) ||
								!BigDecimal.equals(r.decimal('net_amount'), dec(line.net)) ||
								!BigDecimal.equals(r.decimal('tax_amount'), dec(line.tax)) ||
								!BigDecimal.equals(r.decimal('gross_amount'), dec(line.total))
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
								quantity: dec(line.quantity),
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
	const { orders } = yield* ctx.query({
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
	retained: readonly { readonly kind: string; readonly fid: string; readonly seal: string }[] = [],
	costAccount?: string,
	review?: DocumentReview
) {
	const lineProjection =
		kind === 'delivery' ? deliveryLineProjection(costAccount !== undefined) : invoiceLineProjection;
	const sourceType = kind === 'delivery' ? 81 : 21;
	const sources =
		kind === 'delivery'
			? orders.flatMap((order) => [order.fid, order.liveFid])
			: deliveries.map((delivery) => delivery.fid);
	const headers = yield* selectByIds(ctx, documentHeaderProjection(kind), sources);
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
			retained.filter((pin) => pin.kind === kind).map((pin) => [pin.fid, pin.seal])
		);
		const byOrderFid = new Map<string, OwnedSales[]>();
		for (const order of orders)
			for (const fid of new Set([order.fid, order.liveFid])) {
				const list = byOrderFid.get(fid) ?? [];
				list.push(order);
				byOrderFid.set(fid, list);
			}
		const related = new Map<string, Set<Id<'orders'>>>();
		const pinOrders = new Map(orders.map((order) => [order.seal, order.order]));
		const issue = (fid: string, column: string, affected: ReadonlySet<Id<'orders'>>) => {
			if (!review || !affected.size) return false;
			for (const order of affected) review.held.add(order);
			review.issues.push({ document: `${kind} ${fid}`, column });
			return true;
		};
		for (const fid of pending) {
			const pinned = pins.get(fid);
			const owner = pinOrders.get(pinned ?? '');
			if (pinned && !owner)
				return invalid('contractVersion', 'A retained document has no owned agreement');
			if (owner) issue(fid, 'FCheckDate', new Set([owner]));
		}
		const issued = headers.filter((header) => !pending.has(exactId(header, 'fid')));
		// Delivery reversals can refer to an original delivery regardless of their physical ID order.
		issued.sort((a, b) => Number(b['rob']) - Number(a['rob']));
		for (const header of issued) {
			const fid = exactId(header, 'fid');
			const rows = rowsByFid.get(fid) ?? [];
			const pinned = pins.get(fid);
			const affected = new Set<Id<'orders'>>();
			const priorOrder = pinOrders.get(pinned ?? '');
			if (priorOrder) affected.add(priorOrder);
			if (review) {
				for (const entry of rows) {
					const sourceType = String(entry['source_type']);
					const sourceFid = String(entry['source_fid']);
					if (kind === 'delivery' && sourceType === '81')
						for (const order of byOrderFid.get(sourceFid) ?? []) affected.add(order.order);
					if (sourceType === '21') {
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
				if (kind === 'delivery' ? type !== '21' : type !== '80' && !(red && type === '86'))
					return invalid(
						'FTranType',
						'This source document type has no verified transaction mapping'
					);
				if (!rows.length) return invalid('FInterID', 'Owned source document has no lines');
				let owner: OwnedSales | undefined;
				const lines = rows.map((entry): SalesLine => {
					const type = exactId(entry, 'source_type');
					const linkedReturn = kind === 'delivery' && red && type === '21';
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
									(!pinned || candidate.seal === pinned) &&
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
							'contractVersion',
							'This source document has no unique contract-version lineage; retain the existing evidence and reconcile its version explicitly'
						);
					const order = candidates[0];
					if (pinned && order?.seal !== pinned)
						return invalid(
							'contractVersion',
							'A retained physical document cannot move to another contract version'
						);
					const sourceLines = direct ? order?.lines : parent?.lines;
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
						BigDecimal.isZero(quantity) ||
						(!red && BigDecimal.isNegative(quantity)) ||
						(linkedReturn &&
							(!BigDecimal.isPositive(source.quantity) ||
								BigDecimal.isGreaterThan(BigDecimal.abs(quantity), source.quantity))) ||
						!BigDecimal.equals(round(quantity, 3), quantity)
					)
						return invalid(
							'ICStockBillEntry',
							'Source line item, unit or quantity is inconsistent with its original sealed line'
						);
					if (
						kind === 'invoice' &&
						!red &&
						(BigDecimal.isNegative(r.decimal('net_amount')) ||
							BigDecimal.isNegative(r.decimal('gross_amount')))
					)
						return invalid(
							'ICSaleEntry',
							'A blue invoice line has a negative amount requiring an explicit reversal mapping'
						);
					const costAmount = r.decimal('cost_amount', null);
					const signed = (value: D) => (red ? BigDecimal.negate(BigDecimal.abs(value)) : value);
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
					return invalid('FCurrencyID', 'Invoice currency differs from the original sealed order');
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
					total: kind === 'invoice' ? sum(lines.flatMap((line) => line.grossAmount ?? [])) : null
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

export const observation = Effect.fnUntraced(function* (
	ctx: DatabaseContext & { readonly configuration: { readonly branchNo: string } },
	cursor: Json | null
) {
	const [current] = yield* nativeSql(
		ctx,
		`SELECT database_guid,recovery_fork_guid,
CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at
FROM sys.database_recovery_status WHERE database_id=DB_ID()`
	);
	const observed = yield* checked(() => ({
		identity: {
			database: text(current ?? {}, 'database_guid'),
			fork: text(current ?? {}, 'recovery_fork_guid')
		},
		observedAt: Instant(text(current ?? {}, 'observed_at'))
	}));
	const scope = `${yield* sha256Hex(JSON.stringify(observed.identity))}:${yield* sha256Hex(ctx.configuration.branchNo)}`;
	yield* verifyOwnedCursor(cursor, scope);
	return { observedAt: observed.observedAt, scope };
});
export const ownershipSource = Effect.fnUntraced(function* (
	scope: string,
	ownership: readonly string[]
) {
	return `${scope}:${yield* sha256Hex(JSON.stringify(ownership))}`;
});
/** Read only records whose existing FUUID belongs to one local sealed order; never adopt ERP history by bill number. */
export const readSalesGraph = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext,
	costAccount?: string
) {
	const decoded = yield* observation(ctx, cursor);
	const owned = yield* graphOrders(instance, ctx);
	const { ext_sales_orders: parents, transactions: retained } = yield* ctx.query({
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
	const review: DocumentReview = { held: new Set(), issues: [] };
	const delivery = yield* readSalesDocuments(
		orders,
		ctx,
		'delivery',
		[],
		pins,
		costAccount,
		review
	);
	const invoice = yield* readSalesDocuments(
		orders,
		ctx,
		'invoice',
		delivery.documents,
		pins,
		undefined,
		review
	);
	return {
		...review,
		deliveries: delivery.documents.filter((doc) => !review.held.has(doc.owner.order)),
		invoices: invoice.documents.filter((doc) => !review.held.has(doc.owner.order)),
		observedAt: decoded.observedAt,
		source: yield* ownershipSource(decoded.scope, owned.ownership)
	} satisfies SalesGraph;
});
const Cursor = Schema.Struct({
	protocol: Schema.Literal('kingdee-owned-v1'),
	source: Schema.String,
	after: Schema.String.check(Schema.isPattern(/^(?:[\x21-\x7e]{1,512})?$/)),
	finish: Schema.Boolean,
	fingerprint: Schema.optionalKey(Schema.String)
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
/** Page an already collected owned listing. Callers explicitly void missing records; no native hard-delete reconciliation. */
export const snapshotPage = Effect.fnUntraced(function* <R extends object>(
	rows: readonly (R & { readonly $id: string })[],
	cursor: Json | null,
	source: string,
	reuseCompleted?: boolean
): Effect.fn.Return<SourcePage<R>, SourceRowInvalid> {
	const previous = yield* verifyOwnedCursor(cursor, source);
	// A newly approved local agreement starts a new authoritative listing, never finishes the previous scope.
	const current = previous?.source === source && !previous.finish ? previous : null;
	const sorted = yield* checked(() => {
		const result = [...rows].sort((a, b) => (a.$id < b.$id ? -1 : a.$id > b.$id ? 1 : 0));
		if (result.some((row, index) => index > 0 && row.$id === result[index - 1]?.$id))
			invalid('$id', 'Mapped Kingdee identities are not unique');
		return result;
	});
	const fingerprint =
		reuseCompleted === undefined
			? undefined
			: yield* hash(sorted.map((row) => ({ ...row, source_updated_at: undefined }))).pipe(
					Effect.mapError(
						(cause) => new SourceRowInvalid({ column: '$cursor', reason: cause.message })
					)
				);
	if (
		reuseCompleted &&
		fingerprint !== undefined &&
		previous?.source === source &&
		previous.finish &&
		previous.fingerprint === fingerprint
	)
		return { rows: [], cursor: previous, more: false };
	// A page can see a newer source image than the previous page. Only an intact sweep can be reused.
	const completeFingerprint =
		current === null || current.fingerprint === fingerprint ? fingerprint : undefined;
	const pending = sorted.filter((row) => row.$id > (current?.after ?? ''));
	const page = pending.slice(0, 999);
	const more = pending.length > page.length;
	return {
		rows: page,
		more,
		cursor: {
			protocol: 'kingdee-owned-v1',
			source,
			after: more ? (page.at(-1)?.$id ?? '') : '',
			finish: !more,
			...(completeFingerprint === undefined ? {} : { fingerprint: completeFingerprint })
		}
	};
});
export const readSalesOrders = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const observed = yield* observation(ctx, cursor);
	const owned = yield* graphOrders(instance, ctx);
	const source = yield* ownershipSource(observed.scope, owned.ownership);
	const { ext_sales_orders: existing } = yield* ctx.query({
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
export const readTransactions = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const graph = yield* readSalesGraph(instance, cursor, ctx);
	const { ext_sales_orders: parents, transactions: existing } = yield* ctx.query({
		ext_sales_orders: {
			where: { source: { eq: instance } },
			fields: ['external_id', 'status', 'order', 'agreement_hash']
		},
		transactions: { where: { source: { eq: instance } }, fields: ['erp_id', 'order'] }
	});
	const documents = [
		...graph.deliveries.map((document) => ({ kind: 'delivery' as const, document })),
		...graph.invoices.map((document) => ({ kind: 'invoice' as const, document }))
	];
	for (const { kind, document } of documents) {
		const parent = parents.rows.find((row) => row.external_id === document.owner.externalId);
		if (
			!parent ||
			parent.status === 'draft' ||
			parent.order !== document.owner.order ||
			parent.agreement_hash !== document.owner.seal ||
			(parent.status === 'void' &&
				(document.status !== 'void' ||
					!existing.rows.some(
						(row) => row.erp_id === `${kind}:${document.fid}:${document.owner.seal}`
					)))
		) {
			graph.held.add(document.owner.order);
			graph.issues.push({ document: `${kind} ${document.fid}`, column: 'SO counterpart' });
		}
	}
	const rows = yield* checked(() =>
		documents
			.filter(({ document }) => !graph.held.has(document.owner.order))
			.map(({ kind, document }) => {
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
						quantity: D;
						lot_number: string | null;
						net_amount: D | null;
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
						quantity: previous ? BigDecimal.sum(previous.quantity, line.quantity) : line.quantity,
						lot_number: line.lotNumber,
						net_amount: previous
							? previous.net_amount === null || line.netAmount === null
								? null
								: BigDecimal.sum(previous.net_amount, line.netAmount)
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
					total: document.total === null ? null : decimalText(document.total),
					items: [...items.values()].map((item) => ({
						...item,
						quantity: decimalText(item.quantity),
						net_amount: item.net_amount === null ? null : decimalText(item.net_amount)
					})),
					documents: [],
					source_updated_at: graph.observedAt
				};
			})
	);
	const present = new Set(rows.map((row) => row.erp_id));
	const missing = existing.rows
		.filter((row) => !present.has(row.erp_id) && !graph.held.has(row.order))
		.map((row) => ({ $id: row.erp_id, erp_id: row.erp_id, status: 'void' as const }));
	const retained = new Set(existing.rows.map((row) => row.erp_id));
	return reviewedPage(
		yield* snapshotPage(
			[...rows, ...missing],
			cursor,
			graph.source,
			rows.every((row) => retained.has(row.erp_id))
		),
		graph
	);
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
