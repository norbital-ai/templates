import { BigDecimal, Effect, Schema } from 'effect';
import type { InstanceId, SyncCtx, Json, Row } from '@norbital-ai/bolt';
import { sha256Hex, numeric } from '../../lib/commercial.js';
import { safeDueDate } from '../../lib/payables.js';
import {
	kingdeeReceivablesAccount,
	kingdeeSettlementRules,
	type SettlementRules
} from './configuration.js';
import { termDueOn } from './order-batch.js';
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

// The history starts the day after the earliest report cutoff.
const from = '20250101';
const excluded = `c.FID NOT IN (SELECT n.value('.', 'int') FROM @ids.nodes('/ids/id') AS exclusions(n))`;
const requested = `(SELECT n.value('.', 'int') FROM @ids.nodes('/ids/id') AS requested(n))`;
const arCheck = `k.FRP=1 AND k.FCheckDate>=CONVERT(datetime,'${from}',112)`;
/** An open item the report keeps: open, or settled since the history starts. */
const kept = `(c.FRemainAmount<>0 OR EXISTS (SELECT 1 FROM dbo.t_RP_NewCheckInfo k WHERE k.FContactID=c.FID AND ${arCheck}))`;
const validDate = (expr: string) =>
	`CASE WHEN ${expr}>=CONVERT(datetime,'19000101',112) AND ${expr}<CONVERT(datetime,'30000101',112) THEN ${expr} END`;
const plans = `(
 SELECT FInterID, MIN(CASE WHEN FRemainAmount<>0 OR FRemainAmountFor<>0 THEN ${validDate('FDate')} END) AS open_due,
  MAX(${validDate('FDate')}) AS last_due
 FROM dbo.t_RP_Plan_Ar WHERE FRP=1 GROUP BY FInterID
)`;
const dueOn = `CASE WHEN c.FType=3 THEN COALESCE(p.open_due,p.last_due,${validDate('c.FRPDate')}) END`;
const within = (column: string) =>
	`${column}>=CONVERT(binary(8),@from,1) AND ${column}<CONVERT(binary(8),@to,1)`;
/** Open items fall in 64 buckets by id: a bucket whose sums disagree with what was published is read again. */
const BUCKETS = 64;
/** Large ledgers (>5,000 open/settled contacts) shard the 64 buckets across 8 rows to stay inside atomic bounds. */
const SHARDS = 8;
const BUCKETS_PER_SHARD = BUCKETS / SHARDS;
const SHARD_THRESHOLD = 5000;
const shardOf = (bucket: number) => Math.floor(bucket / BUCKETS_PER_SHARD);
const shardBuckets = (shard: number) =>
	Array.from({ length: BUCKETS_PER_SHARD }, (_, i) => shard * BUCKETS_PER_SHARD + i);
const shardId = (shard: number) => (shard === 0 ? 'receivables' : `receivables:${shard}`);
/**
 * The account's position in one request: its ceiling, the guards, and per bucket the count, id and due-date sums and
 * remaining balance of the kept open items and the count, date sum and amount of their dated settlements. Nothing
 * here needs a rowversion, so a due plan edited or an open item deleted shows as a bucket that no longer agrees.
 */
const checkpoint: NativeProjection = {
	sql: `/* kingdee-ar-checkpoint */
SELECT 'ar' AS __key,
 CONVERT(varchar(18),MIN_ACTIVE_ROWVERSION(),1) AS upper,
 (SELECT COUNT_BIG(*) FROM dbo.t_RP_Contact c
  WHERE c.FRP=1 AND c.FRemainAmount<>0 AND (c.FType NOT IN (3,5) OR c.FType IS NULL) AND ${excluded}) AS unclassified,
 (SELECT COUNT_BIG(*) FROM dbo.t_RP_NewCheckInfo WHERE FRP=1 AND FCheckDate IS NULL) AS undated,
 (SELECT b.bucket,COUNT_BIG(*) AS n,SUM(CAST(b.FID AS bigint)) AS ids,
   SUM(CAST(b.FID AS bigint)*COALESCE(DATEDIFF(day,'20000101',b.due_on),0)) AS due,
   CONVERT(varchar(100),SUM(b.FRemainAmount)) AS remaining
  FROM (SELECT c.FID,c.FID%${BUCKETS} AS bucket,c.FRemainAmount,${dueOn} AS due_on FROM dbo.t_RP_Contact c
   LEFT JOIN dbo.ICSale s ON c.FType=3 AND s.FInterID=c.FInvoiceID LEFT JOIN ${plans} p ON p.FInterID=s.FInterID
   WHERE c.FRP=1 AND c.FType IN (3,5) AND ${excluded} AND ${kept}) b
  GROUP BY b.bucket ORDER BY b.bucket FOR JSON PATH) AS contacts,
 (SELECT g.bucket,COUNT_BIG(*) AS n,SUM(CAST(g.FContactID AS bigint)*DATEDIFF(day,'20000101',g.[on])) AS days,
   CONVERT(varchar(100),SUM(g.amount)) AS amount
  FROM (SELECT k.FContactID,k.FContactID%${BUCKETS} AS bucket,CONVERT(date,k.FCheckDate) AS [on],SUM(k.FCheckAmount) AS amount
   FROM dbo.t_RP_NewCheckInfo k JOIN dbo.t_RP_Contact c ON c.FID=k.FContactID
   WHERE ${arCheck} AND c.FRP=1 AND c.FType IN (3,5) AND ${excluded} AND ${kept}
   GROUP BY k.FContactID,CONVERT(date,k.FCheckDate) HAVING SUM(k.FCheckAmount)<>0) g
  GROUP BY g.bucket ORDER BY g.bucket FOR JSON PATH) AS settlements,
 (SELECT system_type_id FROM sys.columns WHERE object_id=OBJECT_ID('dbo.t_RP_Contact') AND name='FModifyTime') AS marker_type,
 CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at`
};
/** The open items one of whose own rows moved in `[from, to)`: the item, its invoice, its customer or a delivery it bills. */
const moved: NativeProjection = {
	sql: `/* kingdee-ar-moved */
SELECT RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),moved.FID),20) AS __key,moved.FID AS contact_id FROM (
 SELECT c.FID FROM dbo.t_RP_Contact c WHERE c.FRP=1 AND c.FType IN (3,5) AND ${within('c.FModifyTime')}
 UNION SELECT c.FID FROM dbo.t_RP_Contact c JOIN dbo.ICSale s ON s.FInterID=c.FInvoiceID
  WHERE c.FRP=1 AND c.FType=3 AND ${within('s.FOperDate')}
 UNION SELECT c.FID FROM dbo.t_RP_Contact c JOIN dbo.t_Organization o ON o.FItemID=c.FCustomer
  WHERE c.FRP=1 AND c.FType IN (3,5) AND ${within('o.FModifyTime')}
 UNION SELECT c.FID FROM dbo.ICStockBill k
  JOIN dbo.ICSaleEntry e ON e.FSourceInterID=k.FInterID AND e.FSourceTranType=21
  JOIN dbo.t_RP_Contact c ON c.FInvoiceID=e.FInterID AND c.FRP=1 AND c.FType=3
  WHERE k.FTranType=21 AND ${within('k.FOperDate')}
) moved`
};
/** Open items as the report keeps them, selected by `where`; `kept` says whether each still belongs in it. */
const entriesOf = (name: string, where: string): NativeProjection => ({
	sql: `/* kingdee-ar-entries ${name} */
SELECT RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),c.FID),20) AS __key,
 c.FID AS contact_id,c.FType AS contact_type,c.FCustomer AS customer_id,o.FName AS customer,
 CASE WHEN c.FType=3 THEN COALESCE(s.FBillNo,c.FNumber) ELSE c.FNumber END AS reference,
 CONVERT(varchar(10),CASE WHEN c.FType=3 THEN COALESCE(s.FDate,c.FDate) ELSE c.FDate END,23) AS business_on,
 CONVERT(varchar(10),${dueOn},23) AS due_on,
 CASE WHEN c.FType=3 THEN st.FName END AS settlement,CASE WHEN c.FType=3 THEN st.FNumber END AS settlement_code,
 CONVERT(varchar(10),CASE WHEN c.FType=3 THEN d.delivered_on END,23) AS delivered_on,
 CONVERT(varchar(100),c.FRemainAmount) AS remaining,
 CONVERT(bit,CASE WHEN ${kept} THEN 1 ELSE 0 END) AS kept,
 (SELECT CONVERT(varchar(10),k.FCheckDate,23) AS [on],
   CONVERT(varchar(100),SUM(k.FCheckAmount)) AS amount
  FROM dbo.t_RP_NewCheckInfo k WHERE k.FContactID=c.FID AND ${arCheck}
  GROUP BY CONVERT(varchar(10),k.FCheckDate,23)
  HAVING SUM(k.FCheckAmount)<>0 ORDER BY [on] FOR JSON PATH) AS settlements
FROM dbo.t_RP_Contact c
LEFT JOIN dbo.ICSale s ON c.FType=3 AND s.FInterID=c.FInvoiceID
LEFT JOIN dbo.t_Organization o ON o.FItemID=c.FCustomer
LEFT JOIN dbo.t_Settle st ON st.FItemID=s.FSettleID
-- the invoice's first delivery: a grouped table, which SalesBridge measured far faster than OUTER APPLY on KIS
LEFT JOIN (
 SELECT e.FInterID, MIN(k.FDate) AS delivered_on FROM dbo.ICSaleEntry e
 JOIN dbo.ICStockBill k ON k.FInterID=e.FSourceInterID AND k.FTranType=21
 WHERE e.FSourceTranType=21 GROUP BY e.FInterID
) d ON d.FInterID=s.FInterID
LEFT JOIN ${plans} p ON p.FInterID=s.FInterID
WHERE c.FRP=1 AND c.FType IN (3,5) AND ${where}`
});
/** The whole kept ledger, with its exclusions in `@ids`. */
const entries = entriesOf('all', `${excluded} AND ${kept}`);
/** Open items by id in `@ids`, kept or not: one that left the report is removed. */
const entriesById = entriesOf('by id', `c.FID IN ${requested}`);
/** The kept open items of the buckets in `@ids`. */
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
			'receivablesExcludedContacts',
			'Use at most 100 verified positive integer AR contact IDs'
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
const plainDecimal = (value: string) =>
	BigDecimal.format(BigDecimal.normalize(BigDecimal.fromStringUnsafe(value)));
const epochDays = (date: string | null | undefined) =>
	date ? (Date.parse(`${date}T00:00:00Z`) - Date.parse('2000-01-01T00:00:00Z')) / 86_400_000 : 0;
/** An open item as the report holds it. */
type Entry = Row<'source_receivables'>['entries'][number];
/** Each bucket's sums, as the checkpoint computes them in SQL, for the entries the report holds. */
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
	ids: string
) {
	const [row] = yield* readNativeRows(ctx, checkpoint, { account, ids });
	if (!row || row.marker_type !== 189)
		return yield* invalid('FModifyTime', 'AR contact requires a native rowversion marker');
	return yield* checked(() => {
		const r = columns(row);
		const contacts = Schema.decodeUnknownSync(Schema.fromJsonString(Contacts))(
			r.text('contacts', '[]')
		);
		const settled = Schema.decodeUnknownSync(Schema.fromJsonString(Settled))(
			r.text('settlements', '[]')
		);
		const upper = r.text('upper').toLowerCase();
		if (!/^0x[0-9a-f]{16}$/.test(upper))
			throw invalid('upper', 'The rowversion ceiling is unavailable');
		return {
			upper,
			observed_at: r.instant('observed_at'),
			unclassified: exactId(row, 'unclassified'),
			undated: exactId(row, 'undated'),
			total: contacts.reduce((sum, c) => sum + c.n, 0),
			digests: Array.from({ length: BUCKETS }, (_, bucket) => {
				const c = contacts.find((sum) => sum.bucket === bucket);
				const k = settled.find((sum) => sum.bucket === bucket);
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
export const testReceivables = Effect.fnUntraced(function* (ctx: DatabaseContext, account: string) {
	yield* sourceCheckpoint(ctx, account, '<ids/>');
	// SQL Server validates table and column permissions without transferring accounting rows.
	yield* readNativeRows(ctx, { sql: entries.sql + ' AND 1=0' }, { account, ids: '<ids/>' });
});
function mapEntry(row: SqlRow, rules: typeof SettlementRules.Type) {
	const business_on = sourceDate(row, 'business_on');
	const contact_id = exactId(row, 'contact_id');
	const customer_id = exactId(row, 'customer_id');
	const reference = clean(text(row, 'reference'));
	if (!business_on || contact_id === '0' || customer_id === '0' || !reference)
		throw invalid('t_RP_Contact', 'Receivables require a dated reference and a verified customer');
	const r = columns(row);
	const kind = exactId(row, 'contact_type') === '3' ? ('invoice' as const) : ('receipt' as const);
	// KIS names "no settlement method" `*`
	const settlement =
		[clean(nullableText(row, 'settlement') ?? '')].find((name) => name && name !== '*') ?? null;
	const code = kind === 'invoice' ? nullableText(row, 'settlement_code') : null;
	const rule = code ? rules[code] : undefined;
	const kingdee_due_on = safeDueDate(sourceDate(row, 'due_on'));
	const delivered_on = sourceDate(row, 'delivered_on');
	const remainingAmount = r.decimal('remaining');
	const remaining = new Intl.NumberFormat('en', {
		useGrouping: false,
		minimumFractionDigits: remainingAmount.scale,
		maximumFractionDigits: remainingAmount.scale
	}).format(numeric(BigDecimal.format(remainingAmount)));
	return {
		contact_id,
		customer_id,
		customer: clean(nullableText(row, 'customer') ?? ''),
		reference,
		kind,
		business_on,
		// the due date the order's terms set, else Kingdee's own, which a customer without terms dates on issue
		due_on: rule ? termDueOn(rule, settlement, business_on, delivered_on) : kingdee_due_on,
		kingdee_due_on,
		settlement,
		delivered_on,
		remaining,
		settlements: Schema.decodeUnknownSync(settlementsSchema)(r.text('settlements', '[]')).map(
			(check) => {
				const amount = BigDecimal.fromStringUnsafe(check.amount);
				const scale = Math.max(0, amount.scale);
				return {
					on: PlainDate(check.on),
					amount: new Intl.NumberFormat('en', {
						useGrouping: false,
						minimumFractionDigits: scale,
						maximumFractionDigits: scale
					}).format(numeric(BigDecimal.format(amount)))
				};
			}
		)
	};
}
const Cursor = Schema.Struct({
	protocol: Schema.Literal('kingdee-ar-v2'),
	account: Schema.String,
	scope: Schema.String,
	// the ceiling every published entry has been read to, and each bucket's sums as published
	bookmark: Schema.String,
	buckets: Schema.Array(Schema.String),
	observed_at: Schema.String,
	sharded: Schema.optionalKey(Schema.Boolean),
	next_shard: Schema.optionalKey(Schema.Int)
});
// a ledger published whole before reads became incremental: read in full once more
const Whole = Schema.Struct({ protocol: Schema.Literal('kingdee-ar-v1'), account: Schema.String });
/** A changed hour reads at most this many moved open items by id; past it the ledger is read whole. */
const MOVED = 5000;

/**
 * Keeps the ledger's open items current a changed item at a time. The first read, or one after the account's scope
 * changed, lists the kept ledger whole and proves it consistent. After it each run asks one checkpoint; when nothing
 * moved it reads and writes nothing. Items whose own rows moved since the bookmark are read by id and merged, and a
 * bucket whose sums no longer agree (a due plan edited, an item deleted: nothing a rowversion shows) is read again.
 */
export const readReceivables = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: SyncCtx<'kingdee'>,
	unchanged: boolean
) {
	if (!ctx.configuration.receivablesAccount?.trim()) return { rows: [], cursor, more: false };
	const account = kingdeeReceivablesAccount(ctx.configuration);
	if (account === null)
		return yield* new SourceUnavailable({
			reason: 'Receivables aging requires a verified account identity'
		});
	// one ledger per account set: what the last read proved stands while nothing changed here
	if (!unchanged) {
		const { sys_integration: ledgers } = yield* ctx.query({
			sys_integration: { where: { integration: { eq: 'kingdee' } }, fields: ['configuration'] }
		});
		if (
			ledgers.rows.some(
				(row) => row.id !== instance && kingdeeReceivablesAccount(row.configuration) === account
			)
		)
			return yield* new SourceUnavailable({
				reason: 'Enable account-wide receivables on one ledger per account set'
			});
	}
	const prior =
		cursor === null
			? null
			: yield* Schema.decodeUnknownEffect(Schema.Union([Cursor, Whole]))(cursor).pipe(
					Effect.mapError(() => invalid('$cursor', 'The receivables checkpoint is invalid'))
				);
	if (prior && prior.account !== account)
		return yield* invalid(
			'$cursor',
			'The verified receivables account changed. Review its retained snapshot before resetting.'
		);
	const excludedContacts = yield* checked(() =>
		exclusions(ctx.configuration.receivablesExcludedContacts)
	);
	const ids = exclusionsXml(excludedContacts);
	const denomination = yield* checked(() => currency(ctx.configuration.baseCurrency));
	// the term rules date what is due: a change to them reads the ledger whole
	const rules = kingdeeSettlementRules(ctx.configuration);
	const scope = yield* sha256Hex(JSON.stringify([account, denomination, excludedContacts, rules]));
	const before = yield* sourceCheckpoint(ctx, account, ids);
	if (before.unclassified !== '0' || before.undated !== '0')
		return yield* invalid(
			't_RP_Contact',
			'Unclassified balances or undated settlements require review before publishing receivables'
		);
	const publish = (position: readonly Entry[]) =>
		Effect.gen(function* () {
			const sorted = [...position].sort((a, b) => Number(a.contact_id) - Number(b.contact_id));
			if (new TextEncoder().encode(JSON.stringify(sorted)).byteLength > 5 * 1024 * 1024)
				return yield* invalid(
					't_RP_Contact',
					'The receivables snapshot exceeds its atomic publish bound'
				);
			return {
				rows: [
					{
						$id: 'receivables',
						shard: 0,
						currency: denomination,
						observed_at: Instant(before.observed_at),
						entries: sorted
					}
				],
				cursor: {
					protocol: 'kingdee-ar-v2' as const,
					account,
					scope,
					bookmark: before.upper,
					buckets: digestsOf(sorted),
					observed_at: before.observed_at
				},
				more: false
			};
		});
	const publishShard = (shard: number, rows: readonly SqlRow[], priorBuckets: readonly string[]) =>
		Effect.gen(function* () {
			const idsForShard = shardBuckets(shard);
			const position = (yield* checked(() => rows.map((row) => mapEntry(row, rules)))).filter(
				(entry) => !excludedContacts.includes(entry.contact_id)
			);
			const sorted = [...position].sort((a, b) => Number(a.contact_id) - Number(b.contact_id));
			if (new TextEncoder().encode(JSON.stringify(sorted)).byteLength > 5 * 1024 * 1024)
				return yield* invalid(
					't_RP_Contact',
					'The receivables snapshot shard exceeds its atomic publish bound'
				);
			const shardDigests = digestsOf(sorted);
			for (const b of idsForShard)
				if (shardDigests[b] !== before.digests[b])
					return yield* invalid(
						't_RP_Contact',
						'The receivables listing does not add up to its checkpoint. The previous snapshot is retained.'
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
						entries: sorted
					}
				],
				cursor: {
					protocol: 'kingdee-ar-v2' as const,
					account,
					scope,
					bookmark: before.upper,
					buckets: mergedBuckets,
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
		const after = yield* sourceCheckpoint(ctx, account, ids);
		if (after.digests.some((digest, bucket) => digest !== before.digests[bucket]))
			return yield* invalid(
				'FModifyTime',
				'The receivables ledger changed during this read. The previous snapshot is retained.'
			);
		const position = yield* checked(() => rows.map((row) => mapEntry(row, rules)));
		// the published sums must be the checkpoint's, or every later hour would read the ledger again
		if (digestsOf(position).some((digest, bucket) => digest !== after.digests[bucket]))
			return yield* invalid(
				't_RP_Contact',
				'The receivables listing does not add up to its checkpoint. The previous snapshot is retained.'
			);
		return yield* publish(position);
	});
	if (prior === null || prior.protocol !== 'kingdee-ar-v2' || prior.scope !== scope)
		return yield* whole;
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
	const changed = (yield* readNativeRows(ctx, moved, {
		account,
		from: prior.bookmark,
		to: before.upper
	}))
		.map((row) => exactId(row, 'contact_id'))
		.filter((id) => !excludedContacts.includes(id));
	if (changed.length > MOVED) return yield* whole;
	// an unchanged ledger is neither read nor written: the tenant database is not woken for it
	if (
		changed.length === 0 &&
		before.digests.every((digest, bucket) => digest === prior.buckets[bucket])
	)
		return { rows: [], cursor, more: false };
	if (prior.sharded || before.total > SHARD_THRESHOLD) {
		const dirtyShards = new Set<number>();
		for (const id of changed) dirtyShards.add(shardOf(Number(id) % BUCKETS));
		for (let b = 0; b < BUCKETS; b++)
			if (before.digests[b] !== prior.buckets[b]) dirtyShards.add(shardOf(b));
		const nextDirty = [...dirtyShards].sort((a, b) => a - b)[0];
		if (nextDirty === undefined)
			return {
				rows: [],
				cursor: { ...prior, bookmark: before.upper, observed_at: before.observed_at },
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
		const remainingDirty = [...dirtyShards].filter((s) => s > nextDirty);
		return {
			rows: res.rows,
			cursor: {
				...res.cursor,
				...(remainingDirty.length ? { next_shard: undefined } : {})
			},
			more: remainingDirty.length > 0
		};
	}
	const { source_receivables: local } = yield* ctx.query({
		source_receivables: { where: { source: { eq: instance } }, fields: ['entries'], limit: 1 }
	});
	const held = new Map((local.rows[0]?.entries ?? []).map((entry) => [entry.contact_id, entry]));
	const merge = (rows: readonly SqlRow[]) =>
		checked(() => {
			for (const row of rows) {
				const entry = mapEntry(row, rules);
				if (excludedContacts.includes(entry.contact_id)) continue;
				if (columns(row).bool('kept')) held.set(entry.contact_id, entry);
				else held.delete(entry.contact_id);
			}
		});
	// a moved item that no longer exists, or no longer counts, leaves the report
	for (const id of changed) held.delete(id);
	yield* merge(yield* selectByIds(ctx, entriesById, changed, '', account));
	const disagreeing = digestsOf([...held.values()]).flatMap((digest, bucket) =>
		digest === before.digests[bucket] ? [] : [String(bucket)]
	);
	if (disagreeing.length) {
		for (const id of held.keys())
			if (disagreeing.includes(String(Number(id) % BUCKETS))) held.delete(id);
		yield* merge(yield* selectByIds(ctx, entriesByBucket, disagreeing, '', account));
	}
	return yield* publish([...held.values()]);
});
