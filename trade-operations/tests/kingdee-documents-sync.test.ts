import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { salesDetail, salesReadDuring } from '../src/lib/reports.js';
import { workspace } from './kit.js';
import { fixtureId, sameDecimal } from './test-runtime.js';
import { kingdeeFixture, kingdeeSale } from './kingdee-fixture.js';
import type { SqlRow } from '../src/integration/kingdee/polling.js';

const padded = (id: string) => id.padStart(20, '0');
const instance = fixtureId('sys_integration', 'kingdee');
const acquire = (source: ReturnType<typeof kingdeeFixture>, clock: { at: string }) =>
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
	const source = kingdeeFixture();
	const clock = { at: '2026-10-26T00:00:00.000Z' };
	const t = yield* acquire(source, clock);
	const as = yield* t.as(t.admin);
	const { order, line } = yield* kingdeeSale(t, source);
	yield* t.deliver();
	const submission = [...source.submissions.values()].at(-1);
	if (!submission) throw new Error('The native outbox must create a source sales order');
	yield* t.pull('ext_sales_orders');
	replaceHeader(source, 'SEOrder', submission.remote, { checker: '701', checked_on: '2026-10-26' });
	const sealed = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders
		.rows[0];
	if (!sealed?.seal_hash || !sealed.sealed_contract) throw new Error('Sealed agreement missing');
	return { t, as, order, line, fid: submission.remote, sealed, source, clock };
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
			const { t, as, order, line, fid, sealed, source, clock } = yield* ownedSale();
			addDelivery(source, '20001', fid);
			addDelivery(source, '20002', fid);
			addDelivery(source, '20003', fid, '');
			addInvoice(source, '30001', ['20001', '20002']);
			replaceHeader(source, 'ICSale', '30001', { date: '2026-11-02', checked_on: '2026-11-03' });
			yield* t.pull('transactions');
			expect(
				(yield* as.query({ transactions: { where: { order: { eq: order } } } })).transactions.rows
			).toEqual([]);
			expect(
				(yield* as.query({ sys_integration: { where: { id: { eq: instance } }, limit: 1 } }))
					.sys_integration.rows[0]
			).toMatchObject({ status: { health: { state: 'attention', code: 'documentReview' } } });
			clock.at = '2026-11-03T00:00:00.000Z';
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
			expect(sameDecimal(invoice.total, '22.60')).toBe(true);
			if (!invoice.items) throw new Error('Visible invoice items required');
			expect(invoice.items).toHaveLength(1);
			const item = invoice.items[0];
			if (!item) throw new Error('Grouped invoice item required');
			expect(item).toMatchObject({ order_line_id: line, unit: 'kg', lot_number: 'LOT-A' });
			expect(sameDecimal(item.quantity, '10')).toBe(true);
			expect(sameDecimal(item.net_amount, '20')).toBe(true);
			const facts = (yield* as.query({ source_sales_lines: { where: { order: { eq: order } } } }))
				.source_sales_lines.rows;
			expect(facts).toHaveLength(4);
			const october = { from: '2026-10-01', to: '2026-10-31' };
			const november = { from: '2026-11-01', to: '2026-11-30' };
			const octoberInvoices = yield* as.query(salesReadDuring({ ...october, basis: 'invoice' }));
			expect(salesDetail(octoberInvoices, { basis: 'invoice' })).toEqual([]);
			const delivered = salesDetail(
				yield* as.query(salesReadDuring({ ...october, basis: 'delivery' })),
				{ basis: 'delivery' }
			);
			const invoiced = salesDetail(
				yield* as.query(salesReadDuring({ ...november, basis: 'invoice' })),
				{ basis: 'invoice' }
			);
			expect(delivered).toHaveLength(2);
			expect(invoiced).toHaveLength(2);
			expect(
				invoiced.every(
					(row) => row.business_on === '2026-11-02' && sameDecimal(row.source_net, '10')
				)
			).toBe(true);
			expect(
				delivered.every(
					(row) => row.business_on === '2026-10-26' && sameDecimal(row.source_net, '10')
				)
			).toBe(true);
			expect(
				facts.every(
					(row) =>
						row.order_line === line &&
						row.seal_hash === sealed.seal_hash &&
						sameDecimal(row.quantity, '5') &&
						sameDecimal(row.net_amount, '10') === true &&
						sameDecimal(row.tax_amount, '1.30') === true
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

it.live('holds premature and malformed settlements with the prior receipt, then reconciles', () =>
	Effect.gen(function* () {
		const { t, as, order, fid, source } = yield* ownedSale();
		yield* t.pull('ext_sales_orders');
		addDelivery(source, '22001', fid);
		addInvoice(source, '32001', ['22001']);
		const settle = (amount: string) => {
			source.tables.t_rp_CheckEntry = [
				{
					__key: padded('1'),
					fid: '32001',
					detail_id: '1',
					check_id: '40001',
					type: '3',
					source_type: '5',
					invoice_id: '32001',
					invoice_entry: '1',
					receipt_id: '41001',
					header_id: '40001',
					header_direction: '1',
					header_type: '3',
					contact_id: '42001',
					settled_on: '2026-10-27',
					amount,
					contact_direction: '1',
					contact_type: '3',
					contact_invoice: '32001',
					receipt_reference: 'RC-41001',
					receipt_direction: '1',
					receipt_currency: 'RMB'
				}
			];
		};
		const payments = () =>
			as
				.query({ source_payments: { where: { order: { eq: order } } } })
				.pipe(Effect.map((answer) => answer.source_payments.rows));
		const health = () =>
			as
				.query({ sys_integration: { where: { id: { eq: instance } }, limit: 1 } })
				.pipe(Effect.map((answer) => answer.sys_integration.rows[0]?.status));
		settle('5.20');
		// receipts polled before their invoice arrived locally
		yield* t.pull('source_payments');
		expect(yield* payments()).toEqual([]);
		expect(yield* health()).toMatchObject({
			health: { state: 'attention', code: 'documentReview' }
		});
		yield* t.pull('transactions');
		yield* t.pull('source_payments');
		const [receipt] = yield* payments();
		expect(receipt).toMatchObject({ kind: 'receipt', settled_on: '2026-10-27', active: true });
		expect(sameDecimal(receipt?.amount, '5.20')).toBe(true);
		const retained = yield* payments();
		settle('5.205');
		yield* t.pull('source_payments');
		expect(yield* payments()).toEqual(retained);
		expect(yield* health()).toMatchObject({
			health: { state: 'attention', code: 'documentReview' }
		});
		settle('5.21');
		yield* t.pull('source_payments');
		const corrected = yield* payments();
		expect(corrected).toHaveLength(1);
		expect(corrected[0]?.id).toBe(receipt?.id);
		expect(sameDecimal(corrected[0]?.amount, '5.21')).toBe(true);
		expect(yield* health()).not.toMatchObject({ health: { state: 'attention' } });
	})
);

it.live('holds a mixed invoice and its prior evidence while an unrelated order advances', () =>
	Effect.gen(function* () {
		const { t, as, order, fid, source } = yield* ownedSale();
		const other = yield* kingdeeSale(t, source);
		yield* t.deliver();
		const remote = [...source.submissions.values()].at(-1)?.remote;
		if (!remote || remote === fid) throw new Error('Second native sale required');
		replaceHeader(source, 'SEOrder', remote, { checker: '701', checked_on: '2026-10-26' });
		addDelivery(source, '21001', fid);
		addInvoice(source, '31001', ['21001']);
		yield* t.pull('ext_sales_orders');
		const pull = () =>
			Effect.gen(function* () {
				yield* t.pull('transactions');
				yield* t.pull('source_sales_lines');
				yield* t.pull('source_payments');
			});
		yield* pull();
		const read = (owner: typeof order) =>
			as.query({
				transactions: { where: { order: { eq: owner } } },
				source_sales_lines: { where: { order: { eq: owner } } }
			});
		const retained = yield* read(order);
		expect(retained.transactions.rows).toHaveLength(2);
		const first = source.tables.ICSaleEntry?.find((row) => row.fid === '31001');
		if (!first) throw new Error('First invoice line missing');
		(source.tables.ICSaleEntry ??= []).push({
			...first,
			__key: padded('3100102'),
			detail_id: '3100102',
			entry_id: '2',
			source_type: '0',
			source_fid: '0'
		});
		addDelivery(source, '21002', remote);
		addInvoice(source, '31002', ['21002']);
		yield* pull();
		expect(yield* read(order)).toEqual(retained);
		const healthy = yield* read(other.order);
		expect(healthy.transactions.rows.map((row) => row.reference).sort()).toEqual([
			'DO-21002',
			'INV-31002'
		]);
		expect(healthy.source_sales_lines.rows).toHaveLength(2);
		const health = yield* as.query({
			sys_integration: { where: { id: { eq: instance } }, limit: 1 }
		});
		expect(health.sys_integration.rows[0]).toMatchObject({
			status: { health: { state: 'attention', code: 'documentReview' } }
		});
		source.tables.ICSaleEntry = (source.tables.ICSaleEntry ?? []).filter(
			(row) => row.detail_id !== '3100102'
		);
		yield* pull();
		expect(yield* read(order)).toEqual(retained);
		expect(yield* read(other.order)).toEqual(healthy);
	})
);
