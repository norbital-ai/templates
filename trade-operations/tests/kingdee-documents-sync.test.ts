import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { isMasked } from '@norbital-ai/bolt';
import { workspace } from './kit.js';
import { fixtureId } from './test-runtime.js';
import { kingdeeFixture, kingdeeSale } from './kingdee-fixture.js';
import type { SqlRow } from '../src/integration/kingdee/polling.js';

const padded = (id: string) => id.padStart(20, '0');
const instance = fixtureId('sys_integration', 'kingdee');
const source = kingdeeFixture();
const clock = { at: '2026-10-26T00:00:00.000Z' };
const acquire = () =>
	workspace({
	source: (operation) =>
		source.request(operation).pipe(
			Effect.map((answer) => ({
				rows: answer.rows.map((row) =>
					'observed_at' in row ? { ...row, observed_at: clock.at } : row
				)
			}))
		),
		now: '2026-10-26T00:00:00Z'
	});
/** A sealed sale the writer submitted, its source mirror pulled before the SO approval. */
const ownedSale = Effect.fnUntraced(function* () {
	const t = yield* acquire();
	const as = t.as(t.admin);
	const { order, line } = yield* kingdeeSale(t, source);
	yield* t.deliver();
	const submission = [...source.submissions.values()].at(-1);
	if (!submission) throw new Error('The native outbox must create a source sales order');
	yield* t.pull('ext_sales_orders');
	replaceHeader(source, 'SEOrder', submission.remote, { checker: '701', checked_on: '2026-10-26' });
	const sealed = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders
		.rows[0];
	if (!sealed?.seal_hash || !sealed.sealed_contract) throw new Error('Sealed agreement missing');
	return { t, as, order, line, fid: submission.remote, sealed };
});
function addDelivery(
	source: ReturnType<typeof kingdeeFixture>,
	fid: string,
	orderId: string,
	checked = '2026-10-26'
): void {
	(source.tables.ICStockBill ??= []).push({
		__key: padded(fid),
		fid,
		reference: `DO-${fid}`,
		type: '21',
		date: '2026-10-26',
		checked_on: checked || null,
		cancelled: false,
		rob: 1
	});
	(source.tables.ICStockBillEntry ??= []).push({
		__key: `${padded(fid)}:${padded('1')}`,
		fid,
		entry_id: '1',
		source_type: '81',
		source_fid: orderId,
		source_entry: '1',
		item_id: '301',
		unit: 'kg',
		quantity: '5',
		lot: 'LOT-A'
	});
}
function addInvoice(
	source: ReturnType<typeof kingdeeFixture>,
	fid: string,
	deliveries: readonly string[],
	checked = '2026-10-26'
): void {
	(source.tables.ICSale ??= []).push({
		__key: padded(fid),
		fid,
		reference: `INV-${fid}`,
		type: '80',
		date: '2026-10-26',
		checked_on: checked || null,
		cancelled: false,
		rob: 1,
		currency: 'CNY',
		due_on: '2026-11-25'
	});
	for (const [index, delivery] of deliveries.entries()) {
		const detail = String(Number(fid) * 100 + index + 1);
		(source.tables.ICSaleEntry ??= []).push({
			__key: padded(detail),
			fid,
			detail_id: detail,
			entry_id: String(index + 1),
			source_type: '21',
			source_fid: delivery,
			source_entry: '1',
			item_id: '301',
			unit: 'kg',
			quantity: '5',
			net_amount: '10.00',
			gross_amount: '11.30'
		});
	}
}
function replaceHeader(
	source: ReturnType<typeof kingdeeFixture>,
	table: string,
	fid: string,
	set: SqlRow
) {
	source.tables[table] = (source.tables[table] ?? []).map((row) =>
		row.fid === fid ? { ...row, ...set } : row
	);
}

it.live(
	'issued documents wait for the SO approval mirror, then synchronize read-only evidence without changing the sealed SO',
	() =>
		Effect.gen(function* () {
			const { t, as, order, line, fid, sealed } = yield* ownedSale();
			addDelivery(source, '20001', fid);
			addDelivery(source, '20002', fid);
			addDelivery(source, '20003', fid, '');
			addInvoice(source, '30001', ['20001', '20002']);
			yield* t.pull('transactions');
			expect(
				(yield* as.query({ transactions: { where: { order: { eq: order } } } })).transactions.rows
			).toEqual([]);
			expect(
				(yield* as.query({ sys_integration: { where: { id: { eq: instance } }, limit: 1 } }))
					.sys_integration.rows[0]
			).toMatchObject({ status: { health: { state: 'attention', code: 'parentPending' } } });
			clock.at = new Date(Date.parse(clock.at) + 60_000).toISOString();
			yield* t.pull('ext_sales_orders');
			yield* t.pull('transactions');
			yield* t.pull('source_sales_lines');
			const documents = (yield* as.query({ transactions: { where: { order: { eq: order } } } }))
				.transactions.rows;
			// the unapproved delivery waits
			expect(documents.map((row) => row.reference).sort()).toEqual([
				'DO-20001',
				'DO-20002',
				'INV-30001'
			]);
			const listed = documents.find((row) => row.kind === 'invoice');
			if (!listed) throw new Error('Owned invoice missing');
			const invoice = (yield* as.query({
				transactions: { where: { id: { eq: listed.id } }, limit: 1 }
			})).transactions.rows[0];
			if (!invoice) throw new Error('Owned invoice detail missing');
			expect(invoice).toMatchObject({
				status: 'issued',
				currency: 'CNY',
				seal_hash: sealed.seal_hash,
				due_on: '2026-11-25'
			});
			expect(invoice.total != null && !isMasked(invoice.total) && invoice.total.eq('22.60')).toBe(
				true
			);
			if (!invoice.items || isMasked(invoice.items))
				throw new Error('Visible invoice items required');
			expect(invoice.items).toHaveLength(1);
			const item = invoice.items[0];
			if (!item) throw new Error('Grouped invoice item required');
			expect(item).toMatchObject({ order_line_id: line, unit: 'kg', lot_number: 'LOT-A' });
			expect(item.quantity.eq(10)).toBe(true);
			expect(item.net_amount?.eq(20)).toBe(true);
			const facts = (yield* as.query({ source_sales_lines: { where: { order: { eq: order } } } }))
				.source_sales_lines.rows;
			expect(facts).toHaveLength(2);
			expect(
				facts.every(
					(row) =>
						row.order_line === line &&
						row.seal_hash === sealed.seal_hash &&
						row.quantity.eq(5) &&
						row.net_amount != null &&
						!isMasked(row.net_amount) &&
						row.net_amount.eq(10) &&
						row.tax_amount != null &&
						!isMasked(row.tax_amount) &&
						row.tax_amount.eq('1.30')
				)
			).toBe(true);
			expect(
				(yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders.rows[0]
			).toMatchObject({
				status: 'confirmed',
				seal_hash: sealed.seal_hash,
				sealed_contract: sealed.sealed_contract,
				contract_version: sealed.contract_version
			});
		})
);
