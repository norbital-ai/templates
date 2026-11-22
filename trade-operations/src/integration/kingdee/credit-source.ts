import { BigDecimal, Effect, Schema } from 'effect';
import type { InstanceId, SyncCtx, Json } from '@norbital-ai/bolt';
import {
	kingdeeCreditAccount,
	kingdeeCreditPolicy,
	kingdeeCreditPolicyOf,
	kingdeeOrgCreditPolicy,
	type KingdeeCreditPolicy
} from './configuration.js';
import { readChangedSnapshot, snapshotStatement } from './changed-snapshot.js';
import { checked } from './order-source.js';
import { SourceRowInvalid, SourceUnavailable, type DatabaseContext } from './polling.js';

// KIS sales-out credit: the catalogue chooses signed terms, never an installation-specific view.
const creditSnapshot = snapshotStatement(`/* kingdee-native-credit */
 SELECT JSON_QUERY(COALESCE((SELECT TOP (2) LTRIM(RTRIM(CONVERT(varchar(1000),FMainAmtCustom))) AS mask,
  LTRIM(RTRIM(CONVERT(varchar(1000),FRangeCustom))) AS control_range, FCreditControl AS control
  FROM dbo.ICCreditOption WHERE FGroupID=2 FOR JSON PATH, INCLUDE_NULL_VALUES),'[]')) AS options,
 JSON_QUERY(COALESCE((SELECT TOP (65) FBitMask AS bit, LTRIM(RTRIM(FCaption)) AS caption, LTRIM(RTRIM(FOperator)) AS operator
  FROM dbo.ICCreditField WHERE FPreFixPara='0' ORDER BY FBitMask,FCaption
  FOR JSON PATH, INCLUDE_NULL_VALUES),'[]')) AS fields,
 JSON_QUERY(COALESCE((SELECT TOP (1001) CONVERT(varchar(20),c.FItemID) AS customer_id,
  CONVERT(bit,CASE WHEN o.FItemID IS NOT NULL THEN 1 ELSE 0 END) AS known_customer,
  CASE WHEN u.FDeleted=0 AND u.FNumber IN ('CNY','RMB') THEN 'CNY' END AS currency,
  CONVERT(varchar(100),c.FAmount) AS credit_limit, ISNULL(c.FCreditDays,0) AS credit_days,
  CONVERT(varchar(100),i.invoiced) AS invoices_audited,
  CONVERT(varchar(100),i.paid) AS invoices_paid,
  CONVERT(varchar(100),r.refunds) AS refunds_unsettled,
  CONVERT(varchar(100),r.receipts) AS receipts_unsettled,
  CONVERT(varchar(100),r.advances) AS advances_unsettled,
  CONVERT(varchar(100),d.issued) AS stock_out_audited,
  CONVERT(varchar(100),d.hooked) AS stock_out_hooked,
  i.oldest_days, i.invalid_terms
 FROM dbo.ICCreditObject c
 LEFT JOIN dbo.t_Organization o ON o.FItemID=c.FItemID
 LEFT JOIN dbo.t_Currency u ON u.FCurrencyID=c.FCurrencyID
 OUTER APPLY(SELECT COALESCE(SUM(a.FAmount),0) AS invoiced,
  COALESCE(SUM(a.FAmount-a.FRemainAmount),0) AS paid,
  MAX(CASE WHEN a.FRemainAmount>0 THEN DATEDIFF(day,COALESCE(s.FSettleDate,s.FDate),GETDATE()) END) AS oldest_days,
  COALESCE(SUM(CASE WHEN a.FRemainAmount>0 AND
   (COALESCE(s.FSettleDate,s.FDate) IS NULL OR COALESCE(s.FSettleDate,s.FDate)<='19010101') THEN 1 ELSE 0 END),0) AS invalid_terms
  FROM dbo.t_RP_Contact a JOIN dbo.ICSale s ON s.FInterID=a.FInvoiceID
   AND s.FStatus<>0 AND s.FCancellation=0
  WHERE a.FRP=1 AND a.FType=3 AND a.FCustomer=c.FItemID) i
 OUTER APPLY(SELECT COALESCE(-SUM(CASE WHEN a.FPre=-1 THEN a.FRemainAmount ELSE 0 END),0) AS refunds,
  COALESCE(SUM(CASE WHEN a.FPre=0 THEN a.FRemainAmount ELSE 0 END),0) AS receipts,
  COALESCE(SUM(CASE WHEN a.FPre=1 THEN a.FRemainAmount ELSE 0 END),0) AS advances
  FROM dbo.t_RP_Contact a JOIN dbo.t_RP_NewReceiveBill b ON b.FBillID=a.FBillID AND b.FStatus<>0
  WHERE a.FRP=1 AND a.FType=5 AND a.FCustomer=c.FItemID) r
 OUTER APPLY(SELECT COALESCE(SUM(e.FConsignAmount),0) AS issued,
  COALESCE(SUM(CASE WHEN b.FHookStatus=2 THEN e.FConsignAmount ELSE 0 END),0) AS hooked
  FROM dbo.ICStockBill b JOIN dbo.ICStockBillEntry e ON e.FInterID=b.FInterID
  WHERE b.FTranType=21 AND b.FStatus<>0 AND b.FCancellation=0 AND b.FSupplyID=c.FItemID) d
 ORDER BY c.FItemID FOR JSON PATH, INCLUDE_NULL_VALUES),'[]')) AS customers
 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER`);

// KIS customer-master credit (`t_Organization.FIsCreditMgr` + `FCreditLimit`) with AR + unhooked sales-out exposure.
const orgCreditSnapshot = snapshotStatement(`/* kingdee-org-credit */
 SELECT JSON_QUERY(COALESCE((SELECT TOP (2001) CONVERT(varchar(20),o.FItemID) AS customer_id,
  'CNY' AS currency,
  LTRIM(RTRIM(o.FCreditLimit)) AS credit_limit,
  CONVERT(varchar(100),i.invoiced) AS invoices_audited,
  CONVERT(varchar(100),i.paid) AS invoices_paid,
  CONVERT(varchar(100),r.refunds) AS refunds_unsettled,
  CONVERT(varchar(100),r.receipts) AS receipts_unsettled,
  CONVERT(varchar(100),r.advances) AS advances_unsettled,
  CONVERT(varchar(100),d.issued) AS stock_out_audited,
  CONVERT(varchar(100),d.hooked) AS stock_out_hooked
 FROM dbo.t_Organization o
 OUTER APPLY(SELECT COALESCE(SUM(a.FAmount),0) AS invoiced,
  COALESCE(SUM(a.FAmount-a.FRemainAmount),0) AS paid
  FROM dbo.t_RP_Contact a JOIN dbo.ICSale s ON s.FInterID=a.FInvoiceID
   AND s.FStatus<>0 AND s.FCancellation=0
  WHERE a.FRP=1 AND a.FType=3 AND a.FCustomer=o.FItemID) i
 OUTER APPLY(SELECT COALESCE(-SUM(CASE WHEN a.FPre=-1 THEN a.FRemainAmount ELSE 0 END),0) AS refunds,
  COALESCE(SUM(CASE WHEN a.FPre=0 THEN a.FRemainAmount ELSE 0 END),0) AS receipts,
  COALESCE(SUM(CASE WHEN a.FPre=1 THEN a.FRemainAmount ELSE 0 END),0) AS advances
  FROM dbo.t_RP_Contact a JOIN dbo.t_RP_NewReceiveBill b ON b.FBillID=a.FBillID AND b.FStatus<>0
  WHERE a.FRP=1 AND a.FType=5 AND a.FCustomer=o.FItemID) r
 OUTER APPLY(SELECT COALESCE(SUM(e.FConsignAmount),0) AS issued,
  COALESCE(SUM(CASE WHEN b.FHookStatus=2 THEN e.FConsignAmount ELSE 0 END),0) AS hooked
  FROM dbo.ICStockBill b JOIN dbo.ICStockBillEntry e ON e.FInterID=b.FInterID
  WHERE b.FTranType=21 AND b.FStatus<>0 AND b.FCancellation=0 AND b.FSupplyID=o.FItemID) d
 WHERE o.FIsCreditMgr<>0 AND o.FDeleted=0
  AND LTRIM(RTRIM(ISNULL(o.FCreditLimit,'')))<>''
  AND LTRIM(RTRIM(o.FCreditLimit)) NOT LIKE '%[^0-9.]%'
 ORDER BY o.FItemID FOR JSON PATH, INCLUDE_NULL_VALUES),'[]')) AS customers
 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER`);

const precise = Schema.String.check(Schema.isPattern(/^-?\d+(\.\d+)?$/));
const integer = Schema.Number.check(Schema.isInt());
const payload = Schema.fromJsonString(
	Schema.Struct({
		options: Schema.Array(
			Schema.Struct({ mask: Schema.String, control_range: Schema.String, control: integer })
		),
		fields: Schema.Array(
			Schema.Struct({ bit: integer, caption: Schema.String, operator: Schema.String })
		),
		customers: Schema.Array(
			Schema.Struct({
				customer_id: Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
				known_customer: Schema.Literal(true),
				currency: Schema.Literal('CNY'),
				credit_limit: precise,
				credit_days: integer,
				invoices_audited: precise,
				invoices_paid: precise,
				refunds_unsettled: precise,
				receipts_unsettled: precise,
				advances_unsettled: precise,
				stock_out_audited: precise,
				stock_out_hooked: precise,
				oldest_days: Schema.NullOr(integer),
				invalid_terms: integer
			})
		)
	})
);
// A snapshot keeps its account pin and the fingerprint of the payload it last applied: an unchanged one is not sent.
const checkpoint = Schema.Struct({
	account: Schema.String,
	fingerprint: Schema.optionalKey(Schema.String)
});
const invalid = (column: string, reason: string) => new SourceRowInvalid({ column, reason });
const items = {
	当前单据金额: { column: null, sign: 1 },
	已审核发票金额: { column: 'invoices_audited', sign: 1 },
	已审核的已收款发票金额: { column: 'invoices_paid', sign: -1 },
	已审核未核销的应收退款单金额: { column: 'refunds_unsettled', sign: 1 },
	已审核未核销的收款单金额: { column: 'receipts_unsettled', sign: -1 },
	已审核未核销的预收单金额: { column: 'advances_unsettled', sign: -1 },
	已审核的销售出库单金额: { column: 'stock_out_audited', sign: 1 },
	已钩稽的销售出库单金额: { column: 'stock_out_hooked', sign: -1 }
} as const;
const catalogue = new Map(Object.entries(items));

const observe = Effect.fnUntraced(function* (ctx: DatabaseContext, account: string, prior = '') {
	const current = yield* readChangedSnapshot(
		{ request: (op) => ctx.request({ ...op, transaction: 'serializable' }) },
		creditSnapshot,
		account,
		prior
	);
	if (current.entries === null)
		return { rows: null, fingerprint: current.fingerprint, observedAt: current.observed_at };
	const entries = current.entries;
	const rows = yield* checked(() => {
		const page = Schema.decodeUnknownSync(payload)(entries);
		const option = page.options[0];
		if (
			page.options.length !== 1 ||
			!option ||
			option.control !== 2 ||
			!['1', '2', '3'].includes(option.control_range)
		)
			throw invalid(
				'ICCreditOption',
				'Expected one blocking sales-out credit option with a known amount/term range'
			);
		const mask = Number(option.mask);
		if (
			!/^\d+$/.test(option.mask) ||
			!Number.isSafeInteger(mask) ||
			mask < 0 ||
			mask >= 2 ** 31 ||
			page.fields.length > 64
		)
			throw invalid('ICCreditOption.FMainAmtCustom', 'Invalid or oversized native credit formula');
		const plan: (typeof items)[keyof typeof items][] = [];
		for (let bit = 1; bit <= mask; bit *= 2) {
			if (!(mask & bit)) continue;
			const fields = page.fields.filter((f) => f.bit === bit),
				field = fields[0],
				item = field && catalogue.get(field.caption);
			if (fields.length !== 1 || !field || !item)
				throw invalid(
					'ICCreditField',
					'Every selected credit bit requires one known catalogue item'
				);
			if (plan.includes(item) || field.operator !== (item.sign === 1 ? '+' : '-'))
				throw invalid('ICCreditField', 'Duplicate credit item or an unsupported native operator');
			plan.push(item);
		}
		if (page.customers.length > 1000)
			throw invalid('ICCreditObject', 'Credit exceeds its customer bound');
		const seen = new Set<string>();
		return page.customers.map((row) => {
			const limit = BigDecimal.fromStringUnsafe(row.credit_limit);
			if (
				seen.has(row.customer_id) ||
				BigDecimal.isNegative(limit) ||
				row.credit_days < 0 ||
				((Number(option.control_range) & 2) !== 0 && row.invalid_terms !== 0)
			)
				throw invalid(
					'ICCreditObject',
					'Credit requires a unique CNY limit, nonnegative credit days and valid invoice dates'
				);
			seen.add(row.customer_id);
			let used = BigDecimal.fromStringUnsafe('0');
			for (const item of plan) {
				// A customer snapshot has no proposed DO: current-document credit is added only at audit.
				if (item.column === null) continue;
				const amount = BigDecimal.fromStringUnsafe(row[item.column]);
				used = item.sign === 1 ? BigDecimal.sum(used, amount) : BigDecimal.subtract(used, amount);
			}
			return {
				customer_id: row.customer_id,
				currency: row.currency,
				credit_limit: row.credit_limit,
				credit_used: BigDecimal.format(used),
				credit_hold:
					((Number(option.control_range) & 1) !== 0 && BigDecimal.isGreaterThan(used, limit)) ||
					((Number(option.control_range) & 2) !== 0 &&
						row.oldest_days !== null &&
						row.oldest_days > row.credit_days)
			};
		});
	});
	return { rows, fingerprint: current.fingerprint, observedAt: current.observed_at };
});
const orgPayload = Schema.fromJsonString(
	Schema.Struct({
		customers: Schema.Array(
			Schema.Struct({
				customer_id: Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
				currency: Schema.Literal('CNY'),
				credit_limit: precise,
				invoices_audited: precise,
				invoices_paid: precise,
				refunds_unsettled: precise,
				receipts_unsettled: precise,
				advances_unsettled: precise,
				stock_out_audited: precise,
				stock_out_hooked: precise
			})
		)
	})
);
const observeOrg = Effect.fnUntraced(function* (ctx: DatabaseContext, account: string, prior = '') {
	const current = yield* readChangedSnapshot(
		{ request: (op) => ctx.request({ ...op, transaction: 'serializable' }) },
		orgCreditSnapshot,
		account,
		prior
	);
	if (current.entries === null)
		return { rows: null, fingerprint: current.fingerprint, observedAt: current.observed_at };
	const entries = current.entries;
	const rows = yield* checked(() => {
		const page = Schema.decodeUnknownSync(orgPayload)(entries);
		if (page.customers.length > 2000)
			throw invalid('t_Organization', 'Credit exceeds its customer bound');
		const seen = new Set<string>();
		return page.customers.map((row) => {
			const limit = BigDecimal.fromStringUnsafe(row.credit_limit);
			if (seen.has(row.customer_id) || BigDecimal.isNegative(limit))
				throw invalid('t_Organization', 'Credit requires a unique nonnegative CNY limit');
			seen.add(row.customer_id);
			const used = BigDecimal.sumAll([
				BigDecimal.fromStringUnsafe(row.invoices_audited),
				BigDecimal.negate(BigDecimal.fromStringUnsafe(row.invoices_paid)),
				BigDecimal.fromStringUnsafe(row.refunds_unsettled),
				BigDecimal.negate(BigDecimal.fromStringUnsafe(row.receipts_unsettled)),
				BigDecimal.negate(BigDecimal.fromStringUnsafe(row.advances_unsettled)),
				BigDecimal.fromStringUnsafe(row.stock_out_audited),
				BigDecimal.negate(BigDecimal.fromStringUnsafe(row.stock_out_hooked))
			]);
			return {
				customer_id: row.customer_id,
				currency: row.currency,
				credit_limit: row.credit_limit,
				credit_used: BigDecimal.format(used),
				credit_hold: BigDecimal.isGreaterThan(used, limit)
			};
		});
	});
	return { rows, fingerprint: current.fingerprint, observedAt: current.observed_at };
});
export const testCreditSource = (
	ctx: DatabaseContext,
	account: string,
	policy: KingdeeCreditPolicy = kingdeeCreditPolicy
) => (policy === kingdeeOrgCreditPolicy ? observeOrg(ctx, account) : observe(ctx, account));

export const readCreditSource = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: SyncCtx<'kingdee'>,
	/** Nothing was written here since the last read: with the payload unchanged too, there is nothing to check. */
	unchanged: boolean
) {
	const account = kingdeeCreditAccount(ctx.configuration);
	const policy = kingdeeCreditPolicyOf(ctx.configuration.creditPolicy);
	if (policy === null || account === null || ctx.configuration.baseCurrency !== 'CNY')
		return yield* new SourceUnavailable({
			reason: 'Credit requires a supported KIS credit policy, CNY and a verified account identity'
		});
	const prior =
		cursor === null ? null : yield* checked(() => Schema.decodeUnknownSync(checkpoint)(cursor));
	if (prior && prior.account !== account)
		return yield* invalid(
			'$cursor',
			'The credit account changed. Review the retained snapshot before resetting.'
		);
	// an unchanged payload comes back without its entries; its rows stand as committed (freshness is the feed's health)
	const current =
		policy === kingdeeOrgCreditPolicy
			? yield* observeOrg(ctx, account, prior?.fingerprint)
			: yield* observe(ctx, account, prior?.fingerprint);
	if (current.rows === null && unchanged) return { rows: [], cursor, more: false };
	const native = current.rows;
	const customerIds = native ? native.map((row) => row.customer_id) : [];
	const { sys_integration: ledgers, credit_snapshots: existing } = yield* ctx.query({
		sys_integration: { where: { integration: { eq: 'kingdee' } }, fields: ['configuration'] },
		credit_snapshots: {
			where: { source: { eq: instance } },
			fields: ['external_code', 'party', 'currency'],
			limit: 2000
		}
	});
	const partyRows: { id: string; external_code: string; kind: string; currency: string }[] = [];
	for (let i = 0; i < customerIds.length; i += 500) {
		const { parties } = yield* ctx.query({
			parties: {
				where: {
					source: { eq: instance },
					active: { eq: true },
					external_code: { in: customerIds.slice(i, i + 500) }
				},
				fields: ['external_code', 'kind', 'currency'],
				limit: 1000
			}
		});
		partyRows.push(...parties.rows);
	}
	if (
		ledgers.rows.some(
			(row) => row.id !== instance && kingdeeCreditAccount(row.configuration) === account
		)
	)
		return yield* new SourceUnavailable({
			reason: 'Enable account-wide credit on one ledger per account set'
		});
	const cursorAfter = { account, fingerprint: current.fingerprint };
	if (native === null) return { rows: [], cursor: cursorAfter, more: false };
	const rows = yield* checked(() =>
		native.map((row) => {
			const party = partyRows.filter(
				(p) => p.external_code === row.customer_id && p.kind !== 'supplier' && p.currency === 'CNY'
			);
			if (party.length !== 1 || !party[0])
				throw invalid('customer_id', 'Credit requires one active synchronized CNY customer');
			return {
				$id: row.customer_id,
				external_code: row.customer_id,
				party: party[0].id,
				currency: row.currency,
				credit_limit: row.credit_limit,
				credit_used: row.credit_used,
				credit_hold: row.credit_hold,
				as_of: current.observedAt
			};
		})
	);
	// Removing a native limit must not leave a previously imported limit/hold looking current.
	const removed = existing.rows
		.filter((row) => !native.some((source) => source.customer_id === row.external_code))
		.map((row) => ({
			$id: row.external_code,
			external_code: row.external_code,
			party: row.party,
			currency: row.currency,
			credit_limit: null,
			credit_used: null,
			credit_hold: false,
			as_of: current.observedAt
		}));
	return {
		rows: [...rows, ...removed],
		cursor: cursorAfter,
		more: false
	};
});
