import { expect, it as test } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { DatabaseRequest, type Json } from '@norbital-ai/bolt/engine';
import { fixtureId } from './test-runtime.js';
import { sourceOrderUuid } from '../src/integration/kingdee/submission.js';
import {
	readOwnedSales,
	readNativeRows,
	readSalesDocuments,
	snapshotPage,
	type SealedSalesOwner
} from '../src/integration/kingdee/order-source.js';
import type { SqlRow } from '../src/integration/kingdee/polling.js';

const key = (value: number) => String(value).padStart(20, '0');
const local: SealedSalesOwner = {
	order: fixtureId('orders', '11111111-1111-4111-8111-111111111111'),
	agreement: {
		version: 1,
		seal_hash: 'a'.repeat(64),
		snapshot: {
			currency: 'CNY',
			tax_inclusive: false,
			lines: [
				{
					id: 'line-owned',
					product: 'product-owned',
					product_code: '5861',
					product_name: 'Resin',
					unit: 'kg',
					quantity: '900',
					unit_price: '2',
					discount_pct: '0',
					tax_rate: '0',
					net: '1800',
					tax: '0',
					total: '1800',
					floor_net: '',
					commission_factor: '',
					commission_basis_unit: ''
				}
			]
		}
	}
};
const header = Effect.fnUntraced(function* (changes: SqlRow = {}) {
	return {
		__key: key(34135),
		fid: '34135',
		branch: '0',
		uuid: yield* sourceOrderUuid(local.order, local.agreement.seal_hash),
		reference: 'SO-OWNED',
		currency: 'RMB',
		version: '000',
		cancelled: false,
		archive: 0,
		checker: '12',
		checked_on: '2026-10-01',
		...changes
	};
});
const line: SqlRow = {
	__key: key(51001),
	fid: '34135',
	detail_id: '51001',
	entry_id: '1',
	item_id: '5861',
	unit: 'kg',
	quantity: '900.0000000000',
	unit_price: '2.0000000000',
	unit_price_inclusive: '2.0000000000'
};

/** Script the already-existing database call boundary; no fabricated normalized ERP tables. */
function fixture(records: Readonly<Record<string, readonly SqlRow[]>>) {
	const calls: DatabaseRequest[] = [];
	return {
		calls,
		configuration: { branchNo: '0' },
		request: Effect.fnUntraced(function* (input: unknown) {
			const request = Schema.decodeUnknownSync(DatabaseRequest)(input);
			calls.push(request);
			if (
				request.op !== 'call' ||
				request.procedure.schema !== 'sys' ||
				request.procedure.name !== 'sp_executesql'
			)
				throw new Error('Expected the existing parameterized SQL call');
			const statement = request.arguments.stmt;
			if (typeof statement !== 'string') throw new Error('Static source SQL required');
			const table = Object.keys(records).find((name) => statement.includes(`FROM dbo.${name} `));
			if (!table) throw new Error('Unexpected physical source table');
			const after = request.arguments.after;
			if (typeof after !== 'string') throw new Error('Bound source key required');
			return {
				rows: (records[table] ?? [])
					.filter((row) => typeof row.__key === 'string' && row.__key > after)
					.slice(0, 1000)
			};
		})
	};
}
test.effect(
	'owned ERP order uses a local sealed FUUID and captured integer IDs for child reads',
	() =>
		Effect.gen(function* () {
			const ownHeader = yield* header();
			const ctx = fixture({ SEOrder: [ownHeader], SEOrderEntry: [line] });
			const result = yield* readOwnedSales([local], ctx);
			expect(result.orders[0]).toMatchObject({
				fid: '34135',
				externalId: `sales:0:34135:${local.agreement.seal_hash}`,
				order: local.order,
				seal: local.agreement.seal_hash,
				currency: 'CNY',
				status: 'issued'
			});
			expect(result.orders[0]?.lines[0]?.localLine.id).toBe('line-owned');
			const [headCall, lineCall] = ctx.calls;
			expect(headCall).toMatchObject({
				op: 'call',
				arguments: {
					branch: '0',
					ids: `<ids><id>${String(ownHeader.uuid).toLowerCase()}</id></ids>`
				}
			});
			expect(lineCall).toMatchObject({
				op: 'call',
				arguments: { ids: '<ids><id>34135</id></ids>' }
			});
			if (lineCall?.op !== 'call') throw new Error('Line call missing');
			expect(lineCall.arguments.stmt).toContain('line.FInterID IN');
			expect(lineCall.arguments.stmt).not.toContain('FOperDate');
			expect(lineCall.arguments.stmt).toContain('CONVERT(varchar(100),line.FQty)');
		})
);
test.effect(
	'source version or line changes cannot be accepted against a different sealed agreement',
	() =>
		Effect.gen(function* () {
			const changedVersion = fixture({
				SEOrder: [yield* header({ version: '001' })],
				SEOrderEntry: [line]
			});
			expect(yield* Effect.flip(readOwnedSales([local], changedVersion))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'FVersionNo'
			});
			const changedLine = fixture({
				SEOrder: [yield* header()],
				SEOrderEntry: [{ ...line, quantity: '901.0000000000' }]
			});
			expect(yield* Effect.flip(readOwnedSales([local], changedLine))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'SEOrderEntry'
			});
			const empty = fixture({ SEOrder: [yield* header()], SEOrderEntry: [] });
			expect(yield* Effect.flip(readOwnedSales([local], empty))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'SEOrderEntry'
			});
		})
);
test.effect(
	'an amendment archive cancellation flag is not blindly interpreted as a void agreement',
	() =>
		Effect.gen(function* () {
			const ctx = fixture({
				SEOrder: [yield* header({ cancelled: true, archive: 1 })],
				SEOrderEntry: [line]
			});
			expect((yield* readOwnedSales([local], ctx)).orders[0]?.status).toBe('issued');
		})
);
test.effect(
	'unknown UUIDs, duplicate ordinal positions and numeric money fail before acknowledging data',
	() =>
		Effect.gen(function* () {
			const foreign = fixture({
				SEOrder: [yield* header({ uuid: '00000000-0000-4000-8000-000000000000' })],
				SEOrderEntry: [line]
			});
			expect(yield* Effect.flip(readOwnedSales([local], foreign))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'FUUID'
			});
			const imprecise = fixture({
				SEOrder: [yield* header()],
				SEOrderEntry: [{ ...line, unit_price: 2 }]
			});
			expect(yield* Effect.flip(readOwnedSales([local], imprecise))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'unit_price'
			});
			const original = local.agreement.snapshot.lines[0];
			if (!original) throw new Error('Sealed line required');
			const twoLines = {
				...local,
				agreement: {
					...local.agreement,
					snapshot: {
						...local.agreement.snapshot,
						lines: [original, { ...original, id: 'line-second' }]
					}
				}
			};
			const duplicatePosition = fixture({
				SEOrder: [yield* header()],
				SEOrderEntry: [line, { ...line, __key: key(51002), detail_id: '51002' }]
			});
			expect(yield* Effect.flip(readOwnedSales([twoLines], duplicatePosition))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'FEntryID'
			});
		})
);
test.effect('native child listings key-page beyond one request and retain the lookahead', () =>
	Effect.gen(function* () {
		const records = Array.from({ length: 1001 }, (_, i) => ({
			__key: key(i + 1),
			fid: String(i + 1)
		}));
		const ctx = fixture({ SEOrderEntry: records });
		const result = yield* readNativeRows(ctx, {
			sql: 'SELECT FDetailID AS __key FROM dbo.SEOrderEntry line'
		});
		expect(result).toHaveLength(1001);
		expect(ctx.calls).toHaveLength(2);
		expect(ctx.calls[1]).toMatchObject({ op: 'call', arguments: { after: key(999) } });
	})
);
test.effect(
	'delivery lineage follows the owned source order ordinal and refuses missing source lines',
	() =>
		Effect.gen(function* () {
			const owned = (yield* readOwnedSales(
				[local],
				fixture({ SEOrder: [yield* header()], SEOrderEntry: [line] })
			)).orders;
			const deliveryHeader: SqlRow = {
				__key: key(64599),
				fid: '64599',
				reference: 'XOUT1',
				type: '21',
				date: '2026-10-02',
				checked_on: '2026-10-02',
				cancelled: false,
				rob: 1
			};
			const deliveryLine: SqlRow = {
				__key: `${key(64599)}:${key(1)}`,
				fid: '64599',
				entry_id: '1',
				source_type: '81',
				source_fid: '34135',
				source_entry: '1',
				item_id: '5861',
				unit: 'kg',
				quantity: '100.0000000000',
				lot: 'LOT-1'
			};
			const ctx = fixture({ ICStockBillEntry: [deliveryLine], ICStockBill: [deliveryHeader] });
			const { documents: deliveries } = yield* readSalesDocuments(owned, ctx, 'delivery');
			expect(deliveries[0]?.lines[0]).toMatchObject({
				localLine: { id: 'line-owned' },
				upstream: { fid: '34135', entryId: '1' },
				lotNumber: 'LOT-1'
			});
			const ambiguous = fixture({
				ICStockBillEntry: [{ ...deliveryLine, source_entry: '2' }],
				ICStockBill: [deliveryHeader]
			});
			expect(yield* Effect.flip(readSalesDocuments(owned, ambiguous, 'delivery'))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'FSourceEntryID'
			});
			const red = fixture({
				ICStockBillEntry: [deliveryLine],
				ICStockBill: [{ ...deliveryHeader, rob: -1 }]
			});
			expect(yield* Effect.flip(readSalesDocuments(owned, red, 'delivery'))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'FROB'
			});
			const invoiceHeader: SqlRow = {
				__key: key(2001),
				fid: '2001',
				reference: 'INV-1',
				type: '80',
				date: '2026-10-03',
				checked_on: '2026-10-03',
				cancelled: false,
				rob: 1,
				currency: 'RMB',
				due_on: '2026-11-03'
			};
			const invoiceLine: SqlRow = {
				__key: key(7001),
				fid: '2001',
				detail_id: '7001',
				entry_id: '1',
				source_type: '21',
				source_fid: '64599',
				source_entry: '1',
				item_id: '5861',
				unit: 'kg',
				quantity: '100',
				net_amount: '200.0000',
				gross_amount: '226.0000'
			};
			const invoiced = fixture({ ICSaleEntry: [invoiceLine], ICSale: [invoiceHeader] });
			const { documents: invoices } = yield* readSalesDocuments(
				owned,
				invoiced,
				'invoice',
				deliveries
			);
			expect(invoices[0]?.total?.eq('226')).toBe(true);
			expect(invoices[0]?.lines[0]).toMatchObject({
				localLine: { id: 'line-owned' },
				upstream: { fid: '64599', entryId: '1' },
				lotNumber: 'LOT-1'
			});
			expect(
				invoiced.calls.some(
					(call) =>
						call.op === 'call' &&
						typeof call.arguments.stmt === 'string' &&
						call.arguments.stmt.includes('line.FAllAmount')
				)
			).toBe(true);
			const foreignCurrency = fixture({
				ICSaleEntry: [invoiceLine],
				ICSale: [{ ...invoiceHeader, currency: 'USD' }]
			});
			expect(
				yield* Effect.flip(readSalesDocuments(owned, foreignCurrency, 'invoice', deliveries))
			).toMatchObject({ _tag: 'SourceRowInvalid', column: 'FCurrencyID' });
		})
);
test.effect(
	'owned paging ends explicitly and never requests native hard-delete reconciliation',
	() =>
		Effect.gen(function* () {
			const rows = [{ $id: 'sales:0:1:seal', external_id: 'sales:0:1:seal' }];
			const first = yield* snapshotPage(rows, null, 'source-a');
			expect(first).toMatchObject({ more: true });
			const end = yield* snapshotPage(rows, first.cursor, 'source-a');
			expect(end).toMatchObject({ more: false, rows: [] });
			expect(first.snapshot).toBeUndefined();
			expect(end.snapshot).toBeUndefined();
			const changed = yield* snapshotPage(rows, first.cursor, 'source-b');
			expect(changed).toMatchObject({ more: true, rows });
			const empty = yield* snapshotPage<Readonly<Record<string, Json>>>([], null, 'empty');
			expect(empty).toMatchObject({ more: true });
		})
);
