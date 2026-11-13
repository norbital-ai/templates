import { expect, it as test } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { DatabaseRequest, type Json } from '@norbital-ai/bolt/engine';
import { fixtureId, sameDecimal } from './test-runtime.js';
import { sourceOrderUuid } from '../src/integration/kingdee/submission.js';
import {
	pairLines,
	readOwnedSales,
	readNativeRows,
	readSalesDocuments,
	snapshotPage
} from '../src/integration/kingdee/order-source.js';
import type { SqlRow } from '../src/integration/kingdee/polling.js';

const key = (value: number) => String(value).padStart(20, '0');
const order = fixtureId('orders', '11111111-1111-4111-8111-111111111111');
const ownedLine = {
	id: 'line-owned',
	source_entry_id: null,
	product_code: '5861',
	product_name: 'Resin'
};
const owned = Effect.fnUntraced(function* (lines = [ownedLine]) {
	return [{ order, uuid: yield* sourceOrderUuid(order, 'key'), currency: 'CNY', lines }];
});
const header = Effect.fnUntraced(function* (changes: SqlRow = {}) {
	return {
		__key: key(34135),
		fid: '34135',
		branch: '0',
		uuid: yield* sourceOrderUuid(order, 'key'),
		reference: 'SO-OWNED',
		currency: 'RMB',
		version: '000',
		cancelled: false,
		archive: 0,
		closed: 0,
		checker: '12',
		checked_on: '2026-10-01',
		customer_id: '110',
		ordered_on: '2026-10-01',
		settlement: 'NET30',
		exchange_rate: '1.0000000000',
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
	unit_price_inclusive: '2.0000000000',
	tax_rate: '0',
	net_amount: '1800',
	tax_amount: '0',
	gross_amount: '1800'
};

test.effect(
	'SO entries pair with bound lines first, then unbound lines in the order the writer sent them',
	() =>
		Effect.gen(function* () {
			const entry = (number: string, item = '5861') => ({
				entry: number,
				detail: number,
				item,
				unit: 'kg',
				quantity: '1',
				exclusive: '1',
				inclusive: '1',
				tax_rate: '0',
				net: '1',
				tax: '0',
				total: '1'
			});
			const lines = [
				{ id: 'b-added-second', source_entry_id: null, product_code: '5861' },
				{ id: 'z-bound', source_entry_id: '3', product_code: '5861' },
				{ id: 'a-added-first', source_entry_id: null, product_code: '5861' }
			];
			const pairs = pairLines(lines, [entry('3'), entry('8'), entry('9')]);
			expect(pairs.get('3')?.id).toBe('z-bound');
			expect(pairs.get('8')?.id).toBe('a-added-first');
			expect(pairs.get('9')?.id).toBe('b-added-second');
			expect(pairLines(lines, [entry('3'), entry('8', '9999')]).get('8')).toBeUndefined();
		})
);

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
				rows: (statement.includes('kingdee-document-headers')
					? [...new Set(records[table]?.map((row) => Number(row.fid)))].map((fid) => {
							const head = records[table.replace(/Entry$/, '')]?.find(
								(row) => row.fid === String(fid)
							);
							return { ...head, __key: key(fid), fid: String(fid), header_id: head?.fid ?? null };
						})
					: (records[table] ?? [])
				)
					.filter((row) => typeof row.__key === 'string' && row.__key > after)
					.slice(0, 1000)
			};
		})
	};
}
test.effect('owned ERP order uses the order FUUID and captured integer IDs for child reads', () =>
	Effect.gen(function* () {
		const ownHeader = yield* header();
		const ctx = fixture({ SEOrder: [ownHeader], SEOrderEntry: [line] });
		const result = yield* readOwnedSales(yield* owned(), ctx);
		expect(result[0]).toMatchObject({ fid: '34135', order, currency: 'CNY', status: 'issued' });
		expect(result[0]?.lines[0]?.localLine.id).toBe('line-owned');
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
	'NULL approval columns mean unapproved without accepting malformed checker identities',
	() =>
		Effect.gen(function* () {
			const unapproved = fixture({
				SEOrder: [yield* header({ checker: null, checked_on: null })],
				SEOrderEntry: [line]
			});
			expect((yield* readOwnedSales(yield* owned(), unapproved))[0]?.status).toBe('draft');
			for (const checker of ['-1', '1.5', 'not-an-id']) {
				const invalid = fixture({
					SEOrder: [yield* header({ checker, checked_on: null })],
					SEOrderEntry: [line]
				});
				expect(yield* Effect.flip(readOwnedSales(yield* owned(), invalid))).toMatchObject({
					_tag: 'SourceRowInvalid',
					column: 'checker'
				});
			}
			const inconsistent = fixture({
				SEOrder: [yield* header({ checker: null, checked_on: '2026-10-01' })],
				SEOrderEntry: [line]
			});
			expect(yield* Effect.flip(readOwnedSales(yield* owned(), inconsistent))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'checker'
			});
		})
);
test.effect('an archive flag alone cannot prove either a live source order or a genuine void', () =>
	Effect.gen(function* () {
		const ctx = fixture({
			SEOrder: [yield* header({ cancelled: true, archive: 1 })],
			SEOrderEntry: [line]
		});
		expect(yield* Effect.flip(readOwnedSales(yield* owned(), ctx))).toMatchObject({
			_tag: 'SourceRowInvalid',
			column: 'FChangeMark'
		});
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
			expect(yield* Effect.flip(readOwnedSales(yield* owned(), foreign))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'FUUID'
			});
			const imprecise = fixture({
				SEOrder: [yield* header()],
				SEOrderEntry: [{ ...line, unit_price: 2 }]
			});
			expect(yield* Effect.flip(readOwnedSales(yield* owned(), imprecise))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'unit_price'
			});
			const duplicatePosition = fixture({
				SEOrder: [yield* header()],
				SEOrderEntry: [line, { ...line, __key: key(51002), detail_id: '51002' }]
			});
			const twoLines = yield* owned([ownedLine, { ...ownedLine, id: 'line-second' }]);
			expect(yield* Effect.flip(readOwnedSales(twoLines, duplicatePosition))).toMatchObject({
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
			const sales = yield* readOwnedSales(
				yield* owned(),
				fixture({ SEOrder: [yield* header()], SEOrderEntry: [line] })
			);
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
			const { documents: deliveries } = yield* readSalesDocuments(sales, ctx, 'delivery');
			expect(ctx.calls).toHaveLength(2);
			const missing = fixture({ ICStockBillEntry: [deliveryLine], ICStockBill: [] });
			expect(yield* Effect.flip(readSalesDocuments(sales, missing, 'delivery'))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'FInterID'
			});
			expect(missing.calls).toHaveLength(1);
			const unaudited = fixture({
				ICStockBillEntry: [deliveryLine],
				ICStockBill: [{ ...deliveryHeader, checked_on: null }]
			});
			expect(yield* readSalesDocuments(sales, unaudited, 'delivery')).toEqual({
				documents: [],
				pendingIds: ['64599']
			});
			expect(unaudited.calls).toHaveLength(1);
			expect(deliveries[0]?.lines[0]).toMatchObject({
				localLine: { id: 'line-owned' },
				upstream: { fid: '34135', entryId: '1' },
				lotNumber: 'LOT-1'
			});
			const ambiguous = fixture({
				ICStockBillEntry: [{ ...deliveryLine, source_entry: '2' }],
				ICStockBill: [deliveryHeader]
			});
			expect(yield* Effect.flip(readSalesDocuments(sales, ambiguous, 'delivery'))).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'FSourceInterId'
			});
			const red = fixture({
				ICStockBillEntry: [deliveryLine],
				ICStockBill: [{ ...deliveryHeader, rob: -1 }]
			});
			const { documents: redDocuments } = yield* readSalesDocuments(sales, red, 'delivery');
			expect(sameDecimal(redDocuments[0]?.lines[0]?.quantity, '-100')).toBe(true);
			const returnFid = '64600';
			const returned = fixture({
				ICStockBillEntry: [
					deliveryLine,
					{
						...deliveryLine,
						__key: `${key(64600)}:${key(1)}`,
						fid: returnFid,
						source_type: '21',
						source_fid: '64599',
						quantity: '-25'
					}
				],
				ICStockBill: [
					deliveryHeader,
					{
						...deliveryHeader,
						__key: key(64600),
						fid: returnFid,
						reference: 'RETURN1',
						rob: -1
					}
				]
			});
			const { documents: withReturn } = yield* readSalesDocuments(sales, returned, 'delivery');
			const returnDoc = withReturn.find((doc) => doc.fid === returnFid);
			expect(returnDoc?.owner.order).toBe(deliveries[0]?.owner.order);
			expect(sameDecimal(returnDoc?.lines[0]?.quantity, '-25')).toBe(true);
			expect(returnDoc?.lines[0]?.localLine.id).toBe('line-owned');

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
				sales,
				invoiced,
				'invoice',
				deliveries
			);
			expect(sameDecimal(invoices[0]?.total, '226')).toBe(true);
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
				yield* Effect.flip(readSalesDocuments(sales, foreignCurrency, 'invoice', deliveries))
			).toMatchObject({ _tag: 'SourceRowInvalid', column: 'FCurrencyID' });
		})
);
test.effect(
	'owned paging finishes with the last data page and pins the account across completed polls',
	() =>
		Effect.gen(function* () {
			const rows = [{ $id: 'sales:0:1:key', external_id: 'sales:0:1:key' }];
			const first = yield* snapshotPage(rows, null, 'account-a:branch-a:scope-a');
			expect(first).toMatchObject({ more: false, rows });
			const next = yield* snapshotPage(rows, first.cursor, 'account-a:branch-a:scope-a');
			expect(next).toEqual(first);
			expect(first.snapshot).toBeUndefined();
			const changed = yield* snapshotPage(rows, first.cursor, 'account-a:branch-a:scope-b');
			expect(changed).toMatchObject({ more: false, rows });
			for (const wrong of ['account-b:branch-a:scope-a', 'account-a:branch-b:scope-a'])
				expect(yield* Effect.flip(snapshotPage(rows, first.cursor, wrong))).toMatchObject({
					_tag: 'SourceRowInvalid',
					column: '$cursor'
				});
			const empty = yield* snapshotPage<Readonly<Record<string, Json>>>([], null, 'empty');
			expect(empty).toMatchObject({ more: false });
			const many = Array.from({ length: 1001 }, (_, i) => ({ $id: key(i) }));
			const page = yield* snapshotPage(many, null, 'account-a:scope-a');
			expect(page).toMatchObject({ more: true, rows: many.slice(0, 999) });
			const end = yield* snapshotPage(many, page.cursor, 'account-a:scope-a');
			expect(end).toMatchObject({ more: false, rows: many.slice(999) });
		})
);

test.effect(
	'reuses a complete transaction cursor and repairs corrections behind an interrupted page',
	() =>
		Effect.gen(function* () {
			const scope = 'account-a:branch-a:scope-a';
			const rows = Array.from({ length: 1001 }, (_, index) => ({
				$id: key(index),
				status: 'issued',
				source_updated_at: 'first observation'
			}));
			const first = yield* snapshotPage(rows, null, scope, false);
			const corrected = rows.map((row, index) => ({
				...row,
				status: index === 0 ? 'void' : row.status,
				source_updated_at: 'second observation'
			}));
			const resumed = yield* snapshotPage(corrected, first.cursor, scope, false);
			expect(resumed).toMatchObject({ rows: corrected.slice(999), more: false });
			const repair = yield* snapshotPage(corrected, resumed.cursor, scope, true);
			expect(repair).toMatchObject({ rows: corrected.slice(0, 999), more: true });
			const complete = yield* snapshotPage(corrected, repair.cursor, scope, true);
			const observed = corrected.map((row) => ({ ...row, source_updated_at: 'third observation' }));
			expect(yield* snapshotPage(observed, complete.cursor, scope, true)).toEqual({
				rows: [],
				cursor: complete.cursor,
				more: false
			});
			expect(yield* snapshotPage(observed, complete.cursor, scope, false)).toMatchObject({
				rows: observed.slice(0, 999),
				more: true
			});
		})
);
