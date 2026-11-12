import { Effect, Schema } from 'effect';
import type { InstanceId, SyncCtx } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/bolt/engine';
import { Decimal } from '@norbital-ai/std/decimal';
import { kingdeeAgreement } from '../../lib/agreements.js';
import { sha256Hex } from '../../lib/commercial.js';
import { kingdeeStockAvailabilityAccount } from './configuration.js';
import { checked } from './order-source.js';
import { SourceRowInvalid, SourceUnavailable, type DatabaseContext } from './polling.js';
import { readChangedSnapshot, snapshotFingerprint, snapshotStatement } from './changed-snapshot.js';

const stockCommitments = snapshotStatement(`/* kingdee-stock-commitments */
 SELECT TOP (10001) o.FBrNo AS branch, CONVERT(varchar(20),o.FInterID) AS fid,
  CONVERT(varchar(20),e.FItemID) AS item, u.FName AS unit,
  CONVERT(varchar(100),CONVERT(decimal(38,3),SUM(e.FQty-ISNULL(e.FStockQty,0)))) AS quantity
 FROM dbo.SEOrder o
 JOIN dbo.SEOrderEntry e ON e.FBrNO=o.FBrNo AND e.FInterID=o.FInterID
 LEFT JOIN dbo.t_ICItem d ON d.FItemID=e.FItemID
 LEFT JOIN dbo.t_Item u ON u.FItemID=d.FUnitID AND u.FItemClassID=7
 WHERE @probe=0 AND o.FCancellation=0 AND o.FStatus IN (0,1,2)
  AND ISNULL(o.FClosed,0)=0 AND ISNULL(o.FChangeMark,0)=0 AND ISNULL(e.FMrpClosed,0)=0
  AND e.FQty-ISNULL(e.FStockQty,0)>0
 GROUP BY o.FBrNo,o.FInterID,e.FItemID,u.FName
 ORDER BY o.FBrNo,o.FInterID,e.FItemID,u.FName
 FOR JSON PATH`);

const cursorSchema = Schema.Struct({
	protocol: Schema.Literal('kingdee-open-stock-v1'),
	account: Schema.String,
	warehouseDigest: Schema.String,
	fingerprint: snapshotFingerprint
});
const entriesSchema = Schema.fromJsonString(
	Schema.Array(
		Schema.Struct({
			branch: Schema.String,
			fid: Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
			item: Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
			unit: Schema.optionalKey(Schema.String),
			quantity: Schema.String.check(Schema.isPattern(/^\d+\.\d{3}$/))
		})
	)
);
const invalid = (column: string, reason: string) => new SourceRowInvalid({ column, reason });

export const testStockCommitments = (ctx: DatabaseContext, account: string) =>
	readChangedSnapshot(ctx, stockCommitments, account, '', true);

export const readStockCommitments = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: SyncCtx<'kingdee'>
) {
	if (!ctx.configuration.stockAvailabilityAccount?.trim()) return { rows: [], cursor, more: false };
	const account = kingdeeStockAvailabilityAccount(ctx.configuration);
	if (account === null)
		return yield* new SourceUnavailable({
			reason: 'Stock availability requires a verified account identity'
		});
	const prior =
		cursor === null ? null : yield* checked(() => Schema.decodeUnknownSync(cursorSchema)(cursor));
	if (prior && prior.account !== account)
		return yield* invalid(
			'$cursor',
			'The verified stock account changed. Review its snapshot before resetting.'
		);
	const { sys_integration: ledgers, orders } = yield* ctx.query({
		sys_integration: { where: { integration: { eq: 'kingdee' } }, fields: ['configuration'] },
		orders: {
			where: { ledger: { eq: instance }, direction: { eq: 'sales' } },
			fields: ['contract_versions']
		}
	});
	if (
		ledgers.rows.some(
			(ledger) =>
				ledger.id !== instance && kingdeeStockAvailabilityAccount(ledger.configuration) === account
		)
	)
		return yield* new SourceUnavailable({
			reason: 'Enable stock availability on one ledger per account set'
		});
	const warehouses = new Map<string, string | null>();
	for (const order of orders.rows) {
		const version = kingdeeAgreement(order.contract_versions ?? []);
		if (!version?.kingdee) continue;
		const key = JSON.stringify([version.kingdee.branch, version.kingdee.live_source_id]);
		warehouses.set(key, warehouses.has(key) ? null : version.snapshot.warehouse || null);
	}
	const warehouseDigest = yield* sha256Hex(JSON.stringify([...warehouses].sort()));
	const current = yield* readChangedSnapshot(
		ctx,
		stockCommitments,
		account,
		prior?.warehouseDigest === warehouseDigest ? prior.fingerprint : ''
	);
	const checkpoint = {
		protocol: 'kingdee-open-stock-v1' as const,
		account,
		warehouseDigest,
		fingerprint: current.fingerprint
	};
	const header = { $id: 'open-stock', observed_at: current.observed_at };
	if (current.entries === null) return { rows: [header], cursor: checkpoint, more: false };
	const payload = current.entries;
	const entries = yield* checked(() => {
		const rows = Schema.decodeUnknownSync(entriesSchema)(payload);
		if (rows.length > 10000)
			throw invalid('SEOrderEntry', 'The open order snapshot exceeds its row bound');
		const totals = new Map<
			string,
			{ product_code: string; warehouse: string | null; unit: string | null; quantity: Decimal }
		>();
		for (const row of rows) {
			const quantity = Decimal.of(row.quantity);
			if (quantity.eq(0)) continue;
			const warehouse = warehouses.get(JSON.stringify([row.branch, row.fid])) ?? null;
			const unit = row.unit?.trim() || null;
			const key = JSON.stringify([row.item, warehouse, unit]);
			const previous = totals.get(key);
			if (previous) previous.quantity = previous.quantity.plus(quantity);
			else totals.set(key, { product_code: row.item, warehouse, unit, quantity });
		}
		return [...totals.values()].map((entry) => ({ ...entry, quantity: entry.quantity.toString() }));
	});
	return { rows: [{ ...header, entries }], cursor: checkpoint, more: false };
});
