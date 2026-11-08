import { Effect, Schema } from 'effect';
import type { InstanceId, SyncCtx } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/bolt/engine';
import { Decimal, currency } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { kingdeeStockLotCostAccount } from './configuration.js';
import { readChangedSnapshot, snapshotFingerprint, snapshotStatement } from './changed-snapshot.js';
import { checked } from './order-source.js';
import { SourceRowInvalid, SourceUnavailable, type DatabaseContext } from './polling.js';

const price = `CONVERT(decimal(28,10),e.FAmount)/NULLIF(CONVERT(decimal(28,10),e.FQty),0)`;
const lotCosts = snapshotStatement(`/* kingdee-stock-lot-costs */
 SELECT TOP (10001) CONVERT(varchar(20),e.FItemID) AS product_code, e.FBatchNo AS lot_number,
  u.FName AS unit, CONVERT(varchar(10),MIN(h.FDate),23) AS received_on,
  CONVERT(varchar(100),SUM(e.FQty)) AS received_qty, CONVERT(varchar(100),SUM(e.FAmount)) AS received_amount
 FROM dbo.ICStockBillEntry e
 JOIN dbo.ICStockBill h ON h.FInterID=e.FInterID
 JOIN dbo.t_ICItem d ON d.FItemID=e.FItemID AND d.FDeleted=0
 JOIN dbo.t_Item u ON u.FItemID=d.FUnitID AND u.FItemClassID=7
 WHERE @probe=0 AND h.FTranType=1 AND h.FCancellation=0 AND h.FCheckDate>'19010101'
  AND NULLIF(LTRIM(RTRIM(e.FBatchNo)),N'') IS NOT NULL
  AND EXISTS (SELECT 1 FROM dbo.ICInventory i WHERE i.FItemID=e.FItemID AND i.FBatchNo=e.FBatchNo AND i.FQty>0)
 GROUP BY e.FItemID,e.FBatchNo,u.FName
 HAVING MIN(CASE WHEN h.FROB=1 AND h.FDate>'19010101' AND e.FQty>0 AND e.FAmount>0 THEN 1 ELSE 0 END)=1
  AND MIN(${price})=MAX(${price})
 ORDER BY e.FItemID,e.FBatchNo,u.FName
 FOR JSON PATH`);

const cursorSchema = Schema.Struct({
	protocol: Schema.Literal('kingdee-purchase-lots-v1'),
	account: Schema.String,
	currency: Schema.String,
	fingerprint: snapshotFingerprint
});
const exact = Schema.String.check(Schema.isPattern(/^\d+(\.\d+)?$/));
const payloadSchema = Schema.fromJsonString(
	Schema.Array(
		Schema.Struct({
			product_code: Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
			lot_number: Schema.String,
			unit: Schema.String,
			received_on: Schema.String,
			received_qty: exact,
			received_amount: exact
		})
	)
);
const invalid = (column: string, reason: string) => new SourceRowInvalid({ column, reason });

export const testStockLotCosts = (ctx: DatabaseContext, account: string) =>
	readChangedSnapshot(ctx, lotCosts, account, '', true);

export const readStockLotCosts = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: SyncCtx<'kingdee'>
) {
	if (!ctx.configuration.stockLotCostAccount?.trim()) return { rows: [], cursor, more: false };
	const account = kingdeeStockLotCostAccount(ctx.configuration);
	if (account === null)
		return yield* new SourceUnavailable({
			reason: 'Purchase lot costs require a verified account identity'
		});
	const denomination = yield* checked(() => currency(ctx.configuration.baseCurrency));
	const prior =
		cursor === null ? null : yield* checked(() => Schema.decodeUnknownSync(cursorSchema)(cursor));
	if (prior && (prior.account !== account || prior.currency !== denomination))
		return yield* invalid(
			'$cursor',
			'The verified purchase lot account or currency changed. Review its snapshot before resetting.'
		);
	const { sys_integration: ledgers } = yield* ctx.db.query({
		sys_integration: { where: { integration: { eq: 'kingdee' } }, fields: ['configuration'] }
	});
	if (
		ledgers.rows.some(
			(row) => row.id !== instance && kingdeeStockLotCostAccount(row.configuration) === account
		)
	)
		return yield* new SourceUnavailable({
			reason: 'Enable purchase lot costs on one ledger per account set'
		});
	const current = yield* readChangedSnapshot(ctx, lotCosts, account, prior?.fingerprint ?? '');
	const checkpoint = {
		protocol: 'kingdee-purchase-lots-v1' as const,
		account,
		currency: denomination,
		fingerprint: current.fingerprint
	};
	const header = { $id: 'purchase-lots', observed_at: current.observed_at };
	const payload = current.entries;
	if (payload === null) return { rows: [header], cursor: checkpoint, more: false };
	const entries = yield* checked(() => {
		const rows = Schema.decodeUnknownSync(payloadSchema)(payload);
		if (rows.length > 10000)
			throw invalid('ICStockBillEntry', 'The purchase lot snapshot exceeds its row bound');
		const seen = new Set<string>();
		return rows.map((row) => {
			const lot_number = row.lot_number.trim();
			const unit = row.unit.trim();
			const key = JSON.stringify([row.product_code, lot_number]);
			const received = Decimal.of(row.received_qty);
			const amount = Decimal.of(row.received_amount);
			if (!lot_number || !unit || received.lte(0) || amount.lte(0) || seen.has(key))
				throw invalid(
					'ICStockBillEntry',
					'The purchase lot has an invalid quantity, cost or identity'
				);
			seen.add(key);
			return {
				product_code: row.product_code,
				lot_number,
				unit,
				received_on: PlainDate(row.received_on),
				received_qty: received.toString(),
				unit_cost: amount.div(received, 10).toString()
			};
		});
	});
	return {
		rows: [{ ...header, currency: denomination, entries }],
		cursor: checkpoint,
		more: false
	};
});
