import { BigDecimal, Duration, Effect, Schema } from 'effect';
import type { InstanceId, SyncCtx } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/bolt/engine';
import { sha256Hex } from '../../lib/commercial.js';
import { kingdeeReceivablesAccount } from './configuration.js';
import {
	checked,
	exactId,
	nullableText,
	readNativeRows,
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
const arCheck = `k.FRP=1 AND k.FCheckDate>=CONVERT(datetime,'${from}',112)`;
const checkpoint: NativeProjection = {
	sql: `/* kingdee-ar-checkpoint */
SELECT 'ar' AS __key,
 CONVERT(varchar(18),CONVERT(binary(8),MAX(c.FModifyTime)),1) AS marker,
 COUNT_BIG(*) AS documents,
 CONVERT(varchar(100),COALESCE(SUM(c.FRemainAmount),0)) AS remaining,
 (SELECT COUNT_BIG(*) FROM dbo.t_RP_Contact c
  WHERE c.FRP=1 AND c.FRemainAmount<>0 AND (c.FType NOT IN (3,5) OR c.FType IS NULL) AND ${excluded}) AS unclassified,
 (SELECT COUNT_BIG(*) FROM dbo.t_RP_NewCheckInfo WHERE FRP=1 AND FCheckDate IS NULL) AS undated,
 CONVERT(varchar(64),HASHBYTES('SHA2_256',(
  SELECT k.FInterID,k.FContactID,CONVERT(varchar(10),k.FCheckDate,23) AS checked_on,k.FCheckAmount
  FROM dbo.t_RP_NewCheckInfo k WHERE ${arCheck} ORDER BY k.FInterID FOR JSON PATH
 )),2) AS settlements,
 CONVERT(varchar(64),HASHBYTES('SHA2_256',(
  SELECT p.FInterID,MIN(CASE WHEN p.FRemainAmount<>0 OR p.FRemainAmountFor<>0 THEN p.FDate END) AS open_due,
   MAX(p.FDate) AS last_due
  FROM dbo.t_RP_Plan_Ar p WHERE p.FRP=1 GROUP BY p.FInterID ORDER BY p.FInterID FOR JSON PATH
 )),2) AS due_dates,
 (SELECT system_type_id FROM sys.columns WHERE object_id=OBJECT_ID('dbo.t_RP_Contact') AND name='FModifyTime') AS marker_type,
 CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at
FROM dbo.t_RP_Contact c WHERE c.FRP=1`
};
const entries: NativeProjection = {
	sql: `/* kingdee-ar-entries */
SELECT RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),c.FID),20) AS __key,
 c.FID AS contact_id,c.FType AS contact_type,c.FCustomer AS customer_id,o.FName AS customer,
 CASE WHEN c.FType=3 THEN COALESCE(s.FBillNo,c.FNumber) ELSE c.FNumber END AS reference,
 CONVERT(varchar(10),CASE WHEN c.FType=3 THEN COALESCE(s.FDate,c.FDate) ELSE c.FDate END,23) AS business_on,
 CONVERT(varchar(10),CASE WHEN c.FType=3 THEN COALESCE(p.open_due,p.last_due,c.FRPDate) END,23) AS due_on,
 CONVERT(varchar(100),c.FRemainAmount) AS remaining,
 (SELECT CONVERT(varchar(10),k.FCheckDate,23) AS [on],
   CONVERT(varchar(100),SUM(k.FCheckAmount)) AS amount
  FROM dbo.t_RP_NewCheckInfo k WHERE k.FContactID=c.FID AND ${arCheck}
  GROUP BY CONVERT(varchar(10),k.FCheckDate,23)
  HAVING SUM(k.FCheckAmount)<>0 ORDER BY [on] FOR JSON PATH) AS settlements
FROM dbo.t_RP_Contact c
LEFT JOIN dbo.ICSale s ON c.FType=3 AND s.FInterID=c.FInvoiceID
LEFT JOIN dbo.t_Organization o ON o.FItemID=c.FCustomer
LEFT JOIN (
 SELECT FInterID, MIN(CASE WHEN FRemainAmount<>0 OR FRemainAmountFor<>0 THEN FDate END) AS open_due,
  MAX(FDate) AS last_due
 FROM dbo.t_RP_Plan_Ar WHERE FRP=1 GROUP BY FInterID
) p ON p.FInterID=s.FInterID
WHERE c.FRP=1 AND c.FType IN (3,5) AND ${excluded}
 AND (c.FRemainAmount<>0 OR EXISTS (
  SELECT 1 FROM dbo.t_RP_NewCheckInfo k WHERE k.FContactID=c.FID AND ${arCheck}
 ))`
};
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
const sourceCheckpoint = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	account: string,
	ids: string
) {
	const [row] = yield* readNativeRows(ctx, checkpoint, { account, ids });
	if (!row || row.marker_type !== 189)
		return yield* invalid('FModifyTime', 'AR contact requires a native rowversion marker');
	return yield* checked(() => {
		const { observed_at: _, ...stamp } = row;
		return {
			fingerprint: JSON.stringify(stamp),
			observed_at: columns(row).instant('observed_at'),
			unclassified: exactId(row, 'unclassified'),
			undated: exactId(row, 'undated')
		};
	});
});
const exclusionsXml = (ids: readonly string[]) =>
	`<ids>${ids.map((id) => `<id>${id}</id>`).join('')}</ids>`;
export const testReceivables = Effect.fnUntraced(function* (ctx: DatabaseContext, account: string) {
	yield* sourceCheckpoint(ctx, account, '<ids/>');
	// SQL Server validates table and column permissions without transferring accounting rows.
	yield* readNativeRows(ctx, { sql: entries.sql + ' AND 1=0' }, { account });
});
function mapEntry(row: SqlRow) {
	const business_on = sourceDate(row, 'business_on');
	const contact_id = exactId(row, 'contact_id');
	const customer_id = exactId(row, 'customer_id');
	const reference = clean(text(row, 'reference'));
	if (!business_on || contact_id === '0' || customer_id === '0' || !reference)
		throw invalid('t_RP_Contact', 'Receivables require a dated reference and a verified customer');
	const r = columns(row);
	const kind = exactId(row, 'contact_type') === '3' ? ('invoice' as const) : ('receipt' as const);
	const remainingAmount = r.decimal('remaining');
	const remaining = new Intl.NumberFormat('en', {
		useGrouping: false,
		minimumFractionDigits: remainingAmount.scale,
		maximumFractionDigits: remainingAmount.scale
	}).format(BigDecimal.format(remainingAmount) as Intl.StringNumericLiteral);
	return {
		contact_id,
		customer_id,
		customer: clean(nullableText(row, 'customer') ?? ''),
		reference,
		kind,
		business_on,
		due_on: sourceDate(row, 'due_on'),
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
					}).format(BigDecimal.format(amount) as Intl.StringNumericLiteral)
				};
			}
		)
	};
}
const Cursor = Schema.Struct({
	protocol: Schema.Literal('kingdee-ar-v1'),
	account: Schema.String,
	scope: Schema.String,
	fingerprint: Schema.String,
	observed_at: Schema.String
});

/** Publish a complete ledger position in one native write after proving the source did not move. */
export const readReceivables = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: SyncCtx<'kingdee'>
) {
	if (!ctx.configuration.receivablesAccount?.trim()) return { rows: [], cursor, more: false };
	const account = kingdeeReceivablesAccount(ctx.configuration);
	if (account === null)
		return yield* new SourceUnavailable({
			reason: 'Receivables aging requires a verified account identity'
		});
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
	const prior =
		cursor === null
			? null
			: yield* Schema.decodeUnknownEffect(Cursor)(cursor).pipe(
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
	const scope = yield* sha256Hex(JSON.stringify([account, denomination, excludedContacts]));
	const before = yield* sourceCheckpoint(ctx, account, ids);
	if (before.unclassified !== '0' || before.undated !== '0')
		return yield* invalid(
			't_RP_Contact',
			'Unclassified balances or undated settlements require review before publishing receivables'
		);
	if (
		prior?.scope === scope &&
		prior.fingerprint === before.fingerprint &&
		Date.parse(before.observed_at) - Date.parse(prior.observed_at) <
			Duration.toMillis(Duration.minutes(ctx.configuration.fullSnapshotMinutes))
	)
		return { rows: [], cursor, more: false };
	const rows = yield* readNativeRows(ctx, entries, { account, ids });
	const after = yield* sourceCheckpoint(ctx, account, ids);
	if (before.fingerprint !== after.fingerprint)
		return yield* invalid(
			'FModifyTime',
			'The receivables ledger changed during this read. The previous snapshot is retained.'
		);
	const position = yield* checked(() => rows.map(mapEntry));
	if (new TextEncoder().encode(JSON.stringify(position)).byteLength > 5 * 1024 * 1024)
		return yield* invalid(
			't_RP_Contact',
			'The receivables snapshot exceeds its atomic publish bound'
		);
	return {
		rows: [
			{
				$id: 'receivables',
				currency: denomination,
				observed_at: Instant(after.observed_at),
				entries: position
			}
		],
		cursor: {
			protocol: 'kingdee-ar-v1',
			account,
			scope,
			fingerprint: after.fingerprint,
			observed_at: after.observed_at
		},
		more: false
	};
});
