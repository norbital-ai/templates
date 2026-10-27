import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { isMasked } from '@norbital-ai/bolt';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { committed, workspace } from './kit.js';
import { fixtureId } from './test-runtime.js';
import { direct } from './synced-kit.js';
import { kingdeeFixture } from './kingdee-fixture.js';
import type { SqlRow } from '../src/integration/kingdee/polling.js';
import { confirmationOf } from './reads.js';

const padded = (id: string) => id.padStart(20, '0');
const instance = fixtureId('sys_integration', 'kingdee');
const ownedSale = Effect.fnUntraced(function* (mirrorApproval = true) {
	const source = kingdeeFixture();
	const clock = { at: '2026-10-26T00:00:00.000Z' };
	const t = yield* workspace({
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
	const as = t.as(t.admin);
	for (const model of ['parties', 'products', 'warehouses'] as const) yield* t.pull(model);
	const party = (yield* as.query({
		parties: {
			where: { source: { eq: instance }, external_code: { eq: '101' } }
		}
	})).parties.rows[0];
	const product = (yield* as.query({
		products: {
			where: { source: { eq: instance }, external_code: { eq: '301' } }
		}
	})).products.rows[0];
	if (!party || !product) throw new Error('Physical Kingdee masters must synchronize first');
	const order = committed(
		'orders',
		yield* as.act('orders.create', [
			{
				title: 'Owned document synchronization',
				direction: 'sales',
				party: party.id,
				currency: 'CNY',
				payment_terms: 'PROBE-NET30',
				ordered_on: PlainDate('2026-10-26')
			}
		])
	);
	const line = committed(
		'order_lines',
		yield* as.act('order_lines.create', [
			{
				order,
				product: product.id,
				quantity: Decimal.of(10),
				unit_price: Decimal.of(2),
				discount_pct: Decimal.of(0),
				tax_rate: Decimal.of(13)
			}
		])
	);
	const draft = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders
		.rows[0];
	if (!draft) throw new Error('Native draft missing');
	yield* as.act('sys_integration.update', [
		{
			target: instance,
			set: { configuration: source.configuration(draft.owner) }
		}
	]);
	const check = yield* confirmationOf(as, {
		order,
		as_of: Instant(t.clock.now())
	});
	committed(
		'orders',
		yield* as.act('orders.update', [
			{
				target: order,
				set: { status: 'confirmed', check_hash: check.check_hash }
			}
		])
	);
	yield* t.deliver();
	const submission = [...source.submissions.values()][0];
	if (!submission) throw new Error('The native outbox must create a source sales order');
	if (!mirrorApproval) yield* t.pull('ext_sales_orders');
	source.tables.SEOrder = (source.tables.SEOrder ?? []).map((header) => ({
		...header,
		checker: '701',
		checked_on: '2026-10-26'
	}));
	if (mirrorApproval) yield* t.pull('ext_sales_orders');
	const sealed = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders
		.rows[0];
	if (!sealed?.seal_hash || !sealed.sealed_contract) throw new Error('Sealed agreement missing');
	return { t, as, source, order, line, fid: submission.remote, sealed, clock };
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
	'documents wait for the local SO approval mirror and resume after the source clock advances',
	() =>
		Effect.gen(function* () {
			const { t, as, source, order, fid, sealed, clock } = yield* ownedSale(false);
			addDelivery(source, '22001', fid);
			addInvoice(source, '32001', ['22001']);
			yield* t.pull('transactions');
			expect(
				(yield* as.query({ transactions: { where: { order: { eq: order } } } })).transactions.rows
			).toEqual([]);
			expect(
				(yield* as.query({ sys_integration: { where: { id: { eq: instance } }, limit: 1 } }))
					.sys_integration.rows[0]
			).toMatchObject({
				status: { health: { state: 'attention', code: 'parentPending' } }
			});
			clock.at = '2026-10-26T00:01:00.000Z';
			yield* t.pull('ext_sales_orders');
			yield* t.pull('transactions');
			expect(
				(yield* as.query({ transactions: { where: { order: { eq: order } } } })).transactions.rows
			).toMatchObject([
				expect.objectContaining({ status: 'issued', seal_hash: sealed.seal_hash }),
				expect.objectContaining({ status: 'issued', seal_hash: sealed.seal_hash })
			]);
			expect(
				(yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders.rows[0]
			).toMatchObject({
				status: 'confirmed',
				seal_hash: sealed.seal_hash,
				sealed_snapshot: sealed.sealed_snapshot
			});
		})
);

it.live(
	'issued delivery and merged invoice synchronize read-only evidence without changing the sealed SO',
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const { t, as, source, order, line, fid, sealed } = yield* ownedSale();
				addDelivery(source, '20001', fid);
				addDelivery(source, '20002', fid);
				addInvoice(source, '30001', ['20001', '20002']);
				yield* t.pull('transactions');
				yield* t.pull('source_sales_lines');
				const documents = (yield* as.query({
					transactions: {
						where: { order: { eq: order } }
					}
				})).transactions.rows;
				expect(documents).toHaveLength(3);
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
				expect(invoice.documents).toEqual([]);
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
				const facts = (yield* as.query({
					source_sales_lines: {
						where: { order: { eq: order } }
					}
				})).source_sales_lines.rows;
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
				const ids = documents.map((row) => row.id).sort();
				yield* t.pull('transactions');
				expect(
					(yield* as.query({ transactions: { where: { order: { eq: order } } } })).transactions.rows
						.map((row) => row.id)
						.sort()
				).toEqual(ids);
				expect(
					yield* direct(t, as.authority, {
						model: 'transactions',
						verb: 'update',
						input: [{ target: invoice.id, set: { reference: 'tampered' } }]
					})
				).toMatchObject({ kind: 'refused' });
				expect(
					(yield* as.query({ transactions: { where: { id: { eq: invoice.id } }, limit: 1 } }))
						.transactions.rows[0]
				).toMatchObject({
					reference: 'INV-30001'
				});
				const unchanged = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } }))
					.orders.rows[0];
				expect(unchanged).toMatchObject({
					seal_hash: sealed.seal_hash,
					sealed_contract: sealed.sealed_contract,
					sealed_snapshot: sealed.sealed_snapshot,
					contract_version: sealed.contract_version
				});
			})
		),
	{ timeout: 30000 }
);

it.live(
	'new pending documents wait for approval; unauditing retained evidence fails without voiding it',
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const { t, as, source, order, fid } = yield* ownedSale();
				addDelivery(source, '21001', fid);
				addDelivery(source, '21002', fid, '');
				addInvoice(source, '31001', ['21001'], '');
				yield* t.pull('transactions');
				let documents = (yield* as.query({
					transactions: {
						where: { order: { eq: order } }
					}
				})).transactions.rows;
				expect(documents.map((row) => row.reference)).toEqual(['DO-21001']);
				replaceHeader(source, 'ICStockBill', '21002', { checked_on: '2026-10-26' });
				replaceHeader(source, 'ICSale', '31001', { checked_on: '2026-10-26' });
				yield* t.pull('transactions');
				documents = (yield* as.query({
					transactions: {
						where: { order: { eq: order } }
					}
				})).transactions.rows;
				expect(documents).toHaveLength(3);
				const invoice = documents.find((row) => row.kind === 'invoice');
				if (!invoice) throw new Error('Approved invoice missing');
				replaceHeader(source, 'ICSale', '31001', { checked_on: null });
				expect(yield* Effect.result(t.pull('transactions'))).toMatchObject({ _tag: 'Failure' });
				expect(
					(yield* as.query({ transactions: { where: { id: { eq: invoice.id } }, limit: 1 } }))
						.transactions.rows[0]
				).toMatchObject({
					status: 'issued'
				});
				replaceHeader(source, 'ICSale', '31001', { checked_on: '2026-10-26', cancelled: true });
				yield* t.pull('transactions');
				expect(
					(yield* as.query({ transactions: { where: { id: { eq: invoice.id } }, limit: 1 } }))
						.transactions.rows[0]
				).toMatchObject({
					status: 'void'
				});
			})
		),
	{ timeout: 30000 }
);
