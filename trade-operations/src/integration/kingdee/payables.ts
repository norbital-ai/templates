import { BigDecimal, Effect, Schema } from 'effect';
import type { InstanceId, SyncCtx, Json, Row } from '@norbital-ai/bolt';
import { sha256Hex } from '../../lib/commercial.js';
import { safeDueDate } from '../../lib/payables.js';
import { currencyDigits, fixedDecimal } from '../../lib/purchase-listing.js';
import {
	kingdeePayablesAccount,
	kingdeeSettlementRules,
	type SettlementRules
} from './configuration.js';
import { settlementDate } from './order-batch.js';
import {
	checked,
	exactId,
	nullableText,
	readNativeRows,
	selectByIds,
	sourceDate,
	text,
	type NativeProjection
} from './order-source.js';
import {
	columns,
	currency,
	Instant,
	PlainDate,
	SourceRowInvalid,
	SourceUnavailable,
	type DatabaseContext,
	type SqlRow
} from './polling.js';

// The AP history starts the day after the earliest report cutoff.
const from = '20250101';
const excluded = `c.FID NOT IN (SELECT n.value('.', 'int') FROM @ids.nodes('/ids/id') AS exclusions(n))`;
const requested = `(SELECT n.value('.', 'int') FROM @ids.nodes('/ids/id') AS requested(n))`;
const apCheck = `k.FRP=0 AND k.FCheckDate>=CONVERT(datetime,'${from}',112)`;
/** An open payable or payment item kept for as-at roll-back: open now, or settled since the window starts. */
const kept = `(c.FRemainAmount<>0 OR EXISTS (SELECT 1 FROM dbo.t_RP_NewCheckInfo k WHERE k.FContactID=c.FID AND ${apCheck}))`;
const validDate = (expr: string) =>
	`CASE WHEN ${expr}>=CONVERT(datetime,'19000101',112) AND ${expr}<CONVERT(datetime,'30000101',112) THEN ${expr} END`;
const plans = `(
 SELECT FInterID,
  MIN(CASE WHEN FRemainAmount<>0 OR FRemainAmountFor<>0 THEN ${validDate('FDate')} END) AS open_due,
  MAX(${validDate('FDate')}) AS last_due
 FROM dbo.t_RP_Plan_Ap WHERE FRP=0 GROUP BY FInterID
)`;
// FType 4 with a real invoice uses its payment plan alone (NULL falls back to invoice date + PO terms);
// FType 2 (expense invoice) and FType 4 with FInvoiceID=0 use the ledger's FRPDate without joining FInterID=0 plan rows.
const dueOn = `CASE WHEN c.FType=4 AND c.FInvoiceID>0 THEN COALESCE(p.open_due,p.last_due) WHEN c.FType IN (2,4) THEN ${validDate('c.FRPDate')} END`;
const within = (column: string) =>
	`${column}>=CONVERT(binary(8),@from,1) AND ${column}<CONVERT(binary(8),@to,1)`;
/** Open AP items fall in 64 buckets by contact id: any bucket whose sums disagree with what was published is re-read. */
const BUCKETS = 64;
const SHARDS = 8;
const BUCKETS_PER_SHARD = BUCKETS / SHARDS;
const SHARD_THRESHOLD = 5000;
const shardOf = (bucket: number) => Math.floor(bucket / BUCKETS_PER_SHARD);
const shardBuckets = (shard: number) =>
	Array.from({ length: BUCKETS_PER_SHARD }, (_, i) => shard * BUCKETS_PER_SHARD + i);
const shardId = (shard: number) => (shard === 0 ? 'payables' : `payables:${shard}`);

/**
 * The AP ledger's position in one request: rowversion ceiling, guards, 64-bucket open-item and settlement
 * sums, plus GL 2202.03 accrued-not-invoiced period-end balances (periods 1–12 from 2024-12 onward).
 */
const checkpoint: NativeProjection = {
	sql: `/* kingdee-ap-checkpoint */
SELECT 'ap' AS __key,
 CONVERT(varchar(18),MIN_ACTIVE_ROWVERSION(),1) AS upper,
 (SELECT COUNT_BIG(*) FROM dbo.t_RP_Contact c
  WHERE c.FRP=0 AND c.FRemainAmount<>0 AND (c.FType NOT IN (2,4,6) OR c.FType IS NULL) AND ${excluded}) AS unclassified,
 (SELECT COUNT_BIG(*) FROM dbo.t_RP_NewCheckInfo WHERE FRP=0 AND FCheckDate IS NULL) AS undated,
 (SELECT b.bucket,COUNT_BIG(*) AS n,SUM(CAST(b.FID AS bigint)) AS ids,
   SUM(CAST(b.FID AS bigint)*COALESCE(DATEDIFF(day,'20000101',b.due_on),0)) AS due,
   CONVERT(varchar(100),SUM(b.FRemainAmount)) AS remaining
  FROM (SELECT c.FID,c.FID%${BUCKETS} AS bucket,c.FRemainAmount,${dueOn} AS due_on FROM dbo.t_RP_Contact c
   LEFT JOIN ${plans} p ON c.FType=4 AND c.FInvoiceID>0 AND p.FInterID=c.FInvoiceID
   WHERE c.FRP=0 AND c.FType IN (2,4,6) AND ${excluded} AND ${kept}) b
  GROUP BY b.bucket ORDER BY b.bucket FOR JSON PATH) AS contacts,
 (SELECT g.bucket,COUNT_BIG(*) AS n,SUM(CAST(g.FContactID AS bigint)*DATEDIFF(day,'20000101',g.[on])) AS days,
   CONVERT(varchar(100),SUM(g.amount)) AS amount
  FROM (SELECT k.FContactID,k.FContactID%${BUCKETS} AS bucket,CONVERT(date,k.FCheckDate) AS [on],SUM(k.FCheckAmount) AS amount
   FROM dbo.t_RP_NewCheckInfo k JOIN dbo.t_RP_Contact c ON c.FID=k.FContactID
   WHERE ${apCheck} AND c.FRP=0 AND c.FType IN (2,4,6) AND ${excluded} AND ${kept}
   GROUP BY k.FContactID,CONVERT(date,k.FCheckDate) HAVING SUM(k.FCheckAmount)<>0) g
  GROUP BY g.bucket ORDER BY g.bucket FOR JSON PATH) AS settlements,
 (SELECT b.FYear AS y,b.FPeriod AS p,CONVERT(varchar(100),-SUM(b.FEndBalance)) AS amount
  FROM dbo.t_Balance b
  JOIN dbo.t_Account a ON a.FAccountID=b.FAccountID AND a.FNumber='2202.03'
  WHERE b.FCurrencyID=0 AND b.FDetailID=0 AND b.FPeriod BETWEEN 1 AND 12
   AND b.FYear*100+b.FPeriod>=202412
  GROUP BY b.FYear,b.FPeriod ORDER BY b.FYear,b.FPeriod FOR JSON PATH) AS accruals,
 (SELECT system_type_id FROM sys.columns WHERE object_id=OBJECT_ID('dbo.t_RP_Contact') AND name='FModifyTime') AS marker_type,
 CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at`
};

/** AP contact rows whose own record, invoice, supplier, receipt or PO moved in `[from, to)`. */
const moved: NativeProjection = {
	sql: `/* kingdee-ap-moved */
SELECT RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),moved.FID),20) AS __key,moved.FID AS contact_id FROM (
 SELECT c.FID FROM dbo.t_RP_Contact c WHERE c.FRP=0 AND c.FType IN (2,4,6) AND ${within('c.FModifyTime')}
 UNION SELECT c.FID FROM dbo.t_RP_Contact c JOIN dbo.ICPurchase v ON v.FInterID=c.FInvoiceID
  WHERE c.FRP=0 AND c.FType=4 AND c.FInvoiceID>0 AND ${within('v.FOperDate')}
 UNION SELECT c.FID FROM dbo.t_RP_Contact c JOIN dbo.t_Supplier sp ON sp.FItemID=c.FCustomer
  WHERE c.FRP=0 AND c.FType IN (2,4,6) AND ${within('sp.FModifyTime')}
 UNION SELECT c.FID FROM dbo.ICStockBill ph
  JOIN dbo.ICPurchaseEntry ve ON ve.FSourceInterID=ph.FInterID AND ve.FSourceTranType=1
  JOIN dbo.t_RP_Contact c ON c.FInvoiceID=ve.FInterID AND c.FRP=0 AND c.FType=4 AND c.FInvoiceID>0
  WHERE ph.FTranType=1 AND ${within('ph.FOperDate')}
 UNION SELECT c.FID FROM dbo.POOrder po
  JOIN dbo.ICStockBillEntry oe ON oe.FSourceInterID=po.FInterID AND oe.FSourceTranType=71
  JOIN dbo.ICPurchaseEntry ve ON ve.FSourceInterID=oe.FInterID AND ve.FSourceEntryID=oe.FEntryID AND ve.FSourceTranType=1
  JOIN dbo.t_RP_Contact c ON c.FInvoiceID=ve.FInterID AND c.FRP=0 AND c.FType=4 AND c.FInvoiceID>0
  WHERE ${within('po.FOperDate')}
) moved`
};

const entriesOf = (name: string, where: string): NativeProjection => ({
	sql: `/* kingdee-ap-entries ${name} */
SELECT RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),c.FID),20) AS __key,
 c.FID AS contact_id,c.FType AS contact_type,c.FCustomer AS supplier_id,sp.FName AS supplier,
 CASE WHEN c.FType=4 THEN COALESCE(v.FBillNo,c.FNumber)
  WHEN c.FType=2 THEN COALESCE(x.FBillNo,c.FNumber)
  ELSE c.FNumber END AS reference,
 CONVERT(varchar(10),CASE WHEN c.FType=4 THEN COALESCE(v.FDate,c.FDate)
  WHEN c.FType=2 THEN COALESCE(x.FDate,c.FDate)
  ELSE c.FDate END,23) AS business_on,
 CONVERT(varchar(10),${dueOn},23) AS due_on,
 CASE WHEN c.FType=4 AND c.FInvoiceID>0 THEN st.FName END AS settlement,
 CASE WHEN c.FType=4 AND c.FInvoiceID>0 THEN st.FNumber END AS settlement_code,
 CONVERT(varchar(10),CASE WHEN c.FType=4 AND c.FInvoiceID>0 THEN d.received_on END,23) AS received_on,
 CONVERT(varchar(100),c.FRemainAmount) AS remaining,
 CONVERT(bit,CASE WHEN ${kept} THEN 1 ELSE 0 END) AS kept,
 (SELECT CONVERT(varchar(10),k.FCheckDate,23) AS [on],
   CONVERT(varchar(100),SUM(k.FCheckAmount)) AS amount
  FROM dbo.t_RP_NewCheckInfo k WHERE k.FContactID=c.FID AND ${apCheck}
  GROUP BY CONVERT(varchar(10),k.FCheckDate,23)
  HAVING SUM(k.FCheckAmount)<>0 ORDER BY [on] FOR JSON PATH) AS settlements
FROM dbo.t_RP_Contact c
LEFT JOIN dbo.ICPurchase v ON c.FType=4 AND c.FInvoiceID>0 AND v.FInterID=c.FInvoiceID
LEFT JOIN dbo.ICExpenses x ON c.FType=2 AND c.FRPBillID>0 AND x.FInterID=c.FRPBillID
LEFT JOIN dbo.t_Supplier sp ON sp.FItemID=c.FCustomer
LEFT JOIN (
 SELECT ve.FInterID, MIN(ph.FDate) AS received_on FROM dbo.ICPurchaseEntry ve
 JOIN dbo.ICStockBill ph ON ph.FInterID=ve.FSourceInterID AND ph.FTranType=1
 WHERE ve.FSourceTranType=1 GROUP BY ve.FInterID
) d ON c.FType=4 AND c.FInvoiceID>0 AND d.FInterID=c.FInvoiceID
LEFT JOIN (
 SELECT ve.FInterID, MIN(CASE WHEN po.FSettleID<>0 THEN po.FSettleID END) AS settle_id
 FROM dbo.ICPurchaseEntry ve
 JOIN dbo.ICStockBillEntry oe ON ve.FSourceTranType=1 AND oe.FInterID=ve.FSourceInterID
  AND oe.FEntryID=ve.FSourceEntryID AND oe.FSourceTranType=71
 JOIN dbo.POOrder po ON po.FInterID=oe.FSourceInterID
 GROUP BY ve.FInterID
) pt ON c.FType=4 AND c.FInvoiceID>0 AND pt.FInterID=c.FInvoiceID
LEFT JOIN dbo.t_Settle st ON st.FItemID=pt.settle_id
LEFT JOIN ${plans} p ON c.FType=4 AND c.FInvoiceID>0 AND p.FInterID=c.FInvoiceID
WHERE c.FRP=0 AND c.FType IN (2,4,6) AND ${where}`
});

const entries = entriesOf('all', `${excluded} AND ${kept}`);
const entriesById = entriesOf('by id', `c.FID IN ${requested}`);
const entriesByBucket = entriesOf('by bucket', `${kept} AND c.FID%${BUCKETS} IN ${requested}`);

const invalid = (column: string, reason: string) => new SourceRowInvalid({ column, reason });
const settlementsSchema = Schema.fromJsonString(
	Schema.Array(Schema.Struct({ on: Schema.String, amount: Schema.String }))
);
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const exclusions = (value: string | null | undefined) => {
	const ids = value?.trim() ? [...new Set(value.split(',').map((part) => part.trim()))].sort() : [];
	if (ids.length > 100 || ids.some((id) => !/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2147483647))
		throw invalid(
			'payablesExcludedContacts',
			'Use at most 100 verified positive integer AP contact IDs'
		);
	return ids;
};
const Contacts = Schema.Array(
	Schema.Struct({
		bucket: Schema.Number,
		n: Schema.Number,
		ids: Schema.Number,
		due: Schema.Number,
		remaining: Schema.String
	})
);
const Settled = Schema.Array(
	Schema.Struct({
		bucket: Schema.Number,
		n: Schema.Number,
		days: Schema.Number,
		amount: Schema.String
	})
);
const AccrualsRaw = Schema.Array(
	Schema.Struct({
		y: Schema.Int,
		p: Schema.Int,
		amount: Schema.String
	})
);
const plainDecimal = (value: string) =>
	BigDecimal.format(BigDecimal.normalize(BigDecimal.fromStringUnsafe(value)));
const epochDays = (date: string | null | undefined) =>
	date ? (Date.parse(`${date}T00:00:00Z`) - Date.parse('2000-01-01T00:00:00Z')) / 86_400_000 : 0;

type Entry = Row<'source_payables'>['entries'][number];
type Accrual = NonNullable<Row<'source_payables'>['accruals']>[number];

function formatDecimal(amount: BigDecimal.BigDecimal, minScale = Math.max(0, amount.scale)) {
	return fixedDecimal(amount, minScale);
}

function digestsOf(entries: readonly Entry[]) {
	const sums = Array.from({ length: BUCKETS }, () => ({
		n: 0,
		ids: 0,
		due: 0,
		remaining: BigDecimal.fromBigInt(0n),
		sn: 0,
		days: 0,
		amount: BigDecimal.fromBigInt(0n)
	}));
	for (const entry of entries) {
		const id = Number(entry.contact_id);
		const bucket = sums[id % BUCKETS];
		if (bucket === undefined) continue;
		bucket.n++;
		bucket.ids += id;
		bucket.due += id * epochDays(entry.kingdee_due_on ?? null);
		bucket.remaining = BigDecimal.sum(
			bucket.remaining,
			BigDecimal.fromStringUnsafe(entry.remaining)
		);
		for (const check of entry.settlements) {
			bucket.sn++;
			bucket.days += id * epochDays(check.on);
			bucket.amount = BigDecimal.sum(bucket.amount, BigDecimal.fromStringUnsafe(check.amount));
		}
	}
	return sums.map((sum) =>
		[sum.n, sum.ids, sum.due, plainDecimal(BigDecimal.format(sum.remaining)), sum.sn, sum.days]
			.concat(plainDecimal(BigDecimal.format(sum.amount)))
			.join('|')
	);
}

const sourceCheckpoint = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	account: string,
	ids: string,
	currencyCode: string
) {
	const [row] = yield* readNativeRows(ctx, checkpoint, { account, ids });
	if (!row || row.marker_type !== 189)
		return yield* invalid('FModifyTime', 'AP contact requires a native rowversion marker');
	const digits = currencyDigits(currencyCode);
	return yield* checked(() => {
		const r = columns(row);
		const contacts = Schema.decodeUnknownSync(Schema.fromJsonString(Contacts))(
			r.text('contacts', '[]')
		);
		const settled = Schema.decodeUnknownSync(Schema.fromJsonString(Settled))(
			r.text('settlements', '[]')
		);
		const contactsByBucket = new Map(contacts.map((sum) => [sum.bucket, sum]));
		const settledByBucket = new Map(settled.map((sum) => [sum.bucket, sum]));
		const accruals: Accrual[] = Schema.decodeUnknownSync(Schema.fromJsonString(AccrualsRaw))(
			r.text('accruals', '[]')
		).map((item) => {
			if (item.p < 1 || item.p > 12 || item.y < 1900 || item.y > 2999)
				throw invalid('t_Balance', 'Expected a valid accounting year and period (1–12)');
			const amount = BigDecimal.fromStringUnsafe(item.amount);
			return {
				period: `${String(item.y)}-${String(item.p).padStart(2, '0')}`,
				amount: fixedDecimal(amount, digits)
			};
		});
		const upper = r.text('upper').toLowerCase();
		if (!/^0x[0-9a-f]{16}$/.test(upper))
			throw invalid('upper', 'The rowversion ceiling is unavailable');
		return {
			upper,
			observed_at: r.instant('observed_at'),
			unclassified: exactId(row, 'unclassified'),
			undated: exactId(row, 'undated'),
			total: contacts.reduce((sum, c) => sum + c.n, 0),
			accruals,
			accrualsDigest: accruals.map((a) => `${a.period}:${plainDecimal(a.amount)}`).join('|'),
			digests: Array.from({ length: BUCKETS }, (_, bucket) => {
				const c = contactsByBucket.get(bucket);
				const k = settledByBucket.get(bucket);
				return [
					c?.n ?? 0,
					c?.ids ?? 0,
					c?.due ?? 0,
					plainDecimal(c?.remaining ?? '0'),
					k?.n ?? 0,
					k?.days ?? 0,
					plainDecimal(k?.amount ?? '0')
				].join('|');
			})
		};
	});
});

const exclusionsXml = (ids: readonly string[]) =>
	`<ids>${ids.map((id) => `<id>${id}</id>`).join('')}</ids>`;

export const testPayables = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	account: string,
	baseCurrency = 'CNY'
) {
	yield* sourceCheckpoint(ctx, account, '<ids/>', baseCurrency);
	yield* readNativeRows(ctx, { sql: entries.sql + ' AND 1=0' }, { account, ids: '<ids/>' });
});

export function mapPayableEntry(row: SqlRow, rules: typeof SettlementRules.Type): Entry {
	const business_on = sourceDate(row, 'business_on');
	const contact_id = exactId(row, 'contact_id');
	const supplier_id = exactId(row, 'supplier_id');
	const reference = clean(text(row, 'reference'));
	if (!business_on || contact_id === '0' || supplier_id === '0' || !reference)
		throw invalid('t_RP_Contact', 'Payables require a dated reference and a verified supplier');
	const r = columns(row);
	const type = exactId(row, 'contact_type');
	const kind =
		type === '4'
			? ('invoice' as const)
			: type === '2'
				? ('expense' as const)
				: type === '6'
					? ('payment' as const)
					: (() => {
							throw invalid('FType', 'Unsupported AP ledger entry type');
						})();
	const settlement =
		[clean(nullableText(row, 'settlement') ?? '')].find((name) => name && name !== '*') ?? null;
	const code = kind === 'invoice' ? nullableText(row, 'settlement_code') : null;
	const rule = code ? rules[code] : undefined;
	const kingdee_due_on = kind === 'payment' ? null : safeDueDate(sourceDate(row, 'due_on'));
	const received_on = sourceDate(row, 'received_on');
	const remainingAmount = r.decimal('remaining');
	// AP payment plans take precedence when present and valid; absent/out-of-range dates fall back to invoice date + PO terms.
	const due_on =
		kind === 'payment'
			? null
			: (kingdee_due_on ??
				(kind === 'invoice' && rule
					? settlementDate(business_on, rule.creditDays, rule.fromMonthEnd)
					: null));
	return {
		contact_id,
		supplier_id,
		supplier: clean(nullableText(row, 'supplier') ?? ''),
		reference,
		kind,
		business_on,
		due_on,
		kingdee_due_on,
		settlement,
		received_on,
		remaining: formatDecimal(remainingAmount),
		settlements: Schema.decodeUnknownSync(settlementsSchema)(r.text('settlements', '[]')).map(
			(check) => {
				const amount = BigDecimal.fromStringUnsafe(check.amount);
				return {
					on: PlainDate(check.on),
					amount: formatDecimal(amount)
				};
			}
		)
	};
}

const Cursor = Schema.Struct({
	protocol: Schema.Literal('kingdee-ap-v1'),
	account: Schema.String,
	scope: Schema.String,
	bookmark: Schema.String,
	buckets: Schema.Array(Schema.String),
	accruals_digest: Schema.String,
	observed_at: Schema.String,
	sharded: Schema.optionalKey(Schema.Boolean),
	next_shard: Schema.optionalKey(Schema.Int),
	pending_shards: Schema.optionalKey(Schema.Array(Schema.Int))
});
const MOVED = 5000;

export const readPayables = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: SyncCtx<'kingdee'>,
	unchanged: boolean
) {
	if (!ctx.configuration.payablesAccount?.trim()) return { rows: [], cursor, more: false };
	const account = kingdeePayablesAccount(ctx.configuration);
	if (account === null)
		return yield* new SourceUnavailable({
			reason: 'Payables aging requires a verified account identity'
		});
	if (!unchanged) {
		const { sys_integration: ledgers } = yield* ctx.query({
			sys_integration: { where: { integration: { eq: 'kingdee' } }, fields: ['configuration'] }
		});
		if (
			ledgers.rows.some(
				(row) => row.id !== instance && kingdeePayablesAccount(row.configuration) === account
			)
		)
			return yield* new SourceUnavailable({
				reason: 'Enable account-wide payables on one ledger per account set'
			});
	}
	const prior =
		cursor === null
			? null
			: yield* Schema.decodeUnknownEffect(Cursor)(cursor).pipe(
					Effect.mapError(() => invalid('$cursor', 'The payables checkpoint is invalid'))
				);
	if (prior && prior.account !== account)
		return yield* invalid(
			'$cursor',
			'The verified payables account changed. Review its retained snapshot before resetting.'
		);
	const excludedContacts = yield* checked(() =>
		exclusions(ctx.configuration.payablesExcludedContacts)
	);
	const excludedSet = new Set(excludedContacts);
	const ids = exclusionsXml(excludedContacts);
	const denomination = yield* checked(() => currency(ctx.configuration.baseCurrency));
	const rules = kingdeeSettlementRules(ctx.configuration);
	const scope = yield* sha256Hex(JSON.stringify([account, denomination, excludedContacts, rules]));
	const before = yield* sourceCheckpoint(ctx, account, ids, denomination);
	if (before.unclassified !== '0' || before.undated !== '0')
		return yield* invalid(
			't_RP_Contact',
			'Unclassified AP balances or undated settlements require review before publishing payables'
		);

	const publish = (position: readonly Entry[]) =>
		Effect.gen(function* () {
			const sorted = [...position].sort((a, b) => Number(a.contact_id) - Number(b.contact_id));
			if (new TextEncoder().encode(JSON.stringify(sorted)).byteLength > 5 * 1024 * 1024)
				return yield* invalid(
					't_RP_Contact',
					'The payables snapshot exceeds its atomic publish bound'
				);
			return {
				rows: [
					{
						$id: 'payables',
						shard: 0,
						currency: denomination,
						observed_at: Instant(before.observed_at),
						entries: sorted,
						accruals: before.accruals
					}
				],
				cursor: {
					protocol: 'kingdee-ap-v1' as const,
					account,
					scope,
					bookmark: before.upper,
					buckets: digestsOf(sorted),
					accruals_digest: before.accrualsDigest,
					observed_at: before.observed_at
				},
				more: false
			};
		});

	const publishShard = (shard: number, rows: readonly SqlRow[], priorBuckets: readonly string[]) =>
		Effect.gen(function* () {
			const idsForShard = shardBuckets(shard);
			const position = (yield* checked(() =>
				rows.map((row) => mapPayableEntry(row, rules))
			)).filter((entry) => !excludedSet.has(entry.contact_id));
			const sorted = [...position].sort((a, b) => Number(a.contact_id) - Number(b.contact_id));
			if (new TextEncoder().encode(JSON.stringify(sorted)).byteLength > 5 * 1024 * 1024)
				return yield* invalid(
					't_RP_Contact',
					'The payables snapshot shard exceeds its atomic publish bound'
				);
			const shardDigests = digestsOf(sorted);
			for (const b of idsForShard)
				if (shardDigests[b] !== before.digests[b])
					return yield* invalid(
						't_RP_Contact',
						'The payables listing does not add up to its checkpoint. The previous snapshot is retained.'
					);
			const mergedBuckets = [...priorBuckets];
			for (const b of idsForShard) {
				const digest = shardDigests[b];
				if (digest !== undefined) mergedBuckets[b] = digest;
			}
			const nextShard = shard + 1 < SHARDS ? shard + 1 : undefined;
			return {
				rows: [
					{
						$id: shardId(shard),
						shard,
						currency: denomination,
						observed_at: Instant(before.observed_at),
						entries: sorted,
						...(shard === 0 ? { accruals: before.accruals } : {})
					}
				],
				cursor: {
					protocol: 'kingdee-ap-v1' as const,
					account,
					scope,
					bookmark: before.upper,
					buckets: mergedBuckets,
					accruals_digest: before.accrualsDigest,
					observed_at: before.observed_at,
					sharded: true,
					...(nextShard !== undefined ? { next_shard: nextShard } : {})
				},
				more: nextShard !== undefined
			};
		});

	const whole = Effect.gen(function* () {
		if (before.total > SHARD_THRESHOLD) {
			const buckets = shardBuckets(0).map(String);
			const rows = yield* selectByIds(ctx, entriesByBucket, buckets, '', account);
			return yield* publishShard(
				0,
				rows,
				Array.from({ length: BUCKETS }, () => '')
			);
		}
		const rows = yield* readNativeRows(ctx, entries, { account, ids });
		const after = yield* sourceCheckpoint(ctx, account, ids, denomination);
		if (
			after.digests.some((digest, bucket) => digest !== before.digests[bucket]) ||
			after.accrualsDigest !== before.accrualsDigest
		)
			return yield* invalid(
				'FModifyTime',
				'The payables ledger changed during this read. The previous snapshot is retained.'
			);
		const position = yield* checked(() => rows.map((row) => mapPayableEntry(row, rules)));
		if (digestsOf(position).some((digest, bucket) => digest !== after.digests[bucket]))
			return yield* invalid(
				't_RP_Contact',
				'The payables listing does not add up to its checkpoint. The previous snapshot is retained.'
			);
		return yield* publish(position);
	});

	if (prior === null || prior.scope !== scope) return yield* whole;
	if (prior.sharded && prior.next_shard !== undefined) {
		const shard = prior.next_shard;
		const rows = yield* selectByIds(
			ctx,
			entriesByBucket,
			shardBuckets(shard).map(String),
			'',
			account
		);
		return yield* publishShard(shard, rows, prior.buckets);
	}
	if (prior.sharded && prior.pending_shards && prior.pending_shards.length > 0) {
		const [shard, ...rest] = prior.pending_shards;
		if (shard !== undefined) {
			const rows = yield* selectByIds(
				ctx,
				entriesByBucket,
				shardBuckets(shard).map(String),
				'',
				account
			);
			const res = yield* publishShard(shard, rows, prior.buckets);
			const { next_shard: _next, ...cleanCursor } = res.cursor;
			return {
				rows: res.rows,
				cursor: {
					...cleanCursor,
					bookmark: rest.length > 0 ? prior.bookmark : before.upper,
					accruals_digest: shard === 0 ? before.accrualsDigest : prior.accruals_digest,
					...(rest.length > 0 ? { pending_shards: rest } : {})
				},
				more: rest.length > 0
			};
		}
	}
	const changed = (yield* readNativeRows(ctx, moved, {
		account,
		from: prior.bookmark,
		to: before.upper
	}))
		.map((row) => exactId(row, 'contact_id'))
		.filter((id) => !excludedSet.has(id));
	if (changed.length > MOVED) return yield* whole;
	const accrualsMoved = before.accrualsDigest !== prior.accruals_digest;
	if (
		changed.length === 0 &&
		!accrualsMoved &&
		before.digests.every((digest, bucket) => digest === prior.buckets[bucket])
	)
		return { rows: [], cursor, more: false };

	if (prior.sharded || before.total > SHARD_THRESHOLD) {
		const dirtyShards = new Set<number>();
		if (accrualsMoved) dirtyShards.add(0);
		for (const id of changed) dirtyShards.add(shardOf(Number(id) % BUCKETS));
		for (let b = 0; b < BUCKETS; b++)
			if (before.digests[b] !== prior.buckets[b]) dirtyShards.add(shardOf(b));
		const [nextDirty, ...remainingDirty] = [...dirtyShards].sort((a, b) => a - b);
		if (nextDirty === undefined)
			return {
				rows: [],
				cursor: {
					...prior,
					bookmark: before.upper,
					accruals_digest: before.accrualsDigest,
					observed_at: before.observed_at
				},
				more: false
			};
		const rows = yield* selectByIds(
			ctx,
			entriesByBucket,
			shardBuckets(nextDirty).map(String),
			'',
			account
		);
		const res = yield* publishShard(nextDirty, rows, prior.buckets);
		const { next_shard: _next, ...cleanCursor } = res.cursor;
		return {
			rows: res.rows,
			cursor: {
				...cleanCursor,
				bookmark: remainingDirty.length > 0 ? prior.bookmark : before.upper,
				accruals_digest: nextDirty === 0 ? before.accrualsDigest : prior.accruals_digest,
				...(remainingDirty.length > 0 ? { pending_shards: remainingDirty } : {})
			},
			more: remainingDirty.length > 0
		};
	}

	const { source_payables: local } = yield* ctx.query({
		source_payables: { where: { source: { eq: instance } }, fields: ['entries'], limit: 1 }
	});
	const held = new Map((local.rows[0]?.entries ?? []).map((entry) => [entry.contact_id, entry]));
	const merge = (rows: readonly SqlRow[]) =>
		checked(() => {
			for (const row of rows) {
				const entry = mapPayableEntry(row, rules);
				if (excludedSet.has(entry.contact_id)) continue;
				if (columns(row).bool('kept')) held.set(entry.contact_id, entry);
				else held.delete(entry.contact_id);
			}
		});
	for (const id of changed) held.delete(id);
	if (changed.length) yield* merge(yield* selectByIds(ctx, entriesById, changed, '', account));
	const disagreeing = digestsOf([...held.values()]).flatMap((digest, bucket) =>
		digest === before.digests[bucket] ? [] : [String(bucket)]
	);
	if (disagreeing.length) {
		const disagreeingSet = new Set(disagreeing);
		for (const id of held.keys())
			if (disagreeingSet.has(String(Number(id) % BUCKETS))) held.delete(id);
		yield* merge(yield* selectByIds(ctx, entriesByBucket, disagreeing, '', account));
	}
	return yield* publish([...held.values()]);
});
