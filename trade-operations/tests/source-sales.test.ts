import { fixtureId, decimalText } from './test-runtime.js';
import { Schema, Effect, Exit } from 'effect';
import { businessRows } from './business-source.js';
import { expect, it } from '@effect/vitest';
import type { Json } from '@norbital-ai/bolt/engine';
import { committed, confirm, draft, SETTINGS, workspace, type T } from './kit.js';
import { salesDetailOf } from './reads.js';
import {
	purchaseChain,
	purchaseChainRead,
	readSalesReport,
	salesCollection,
	salesCollectionRead,
	salesDetail,
	salesRead,
	salesReadDuring
} from '../src/lib/reports.js';
import { setKingdeeOrder, sourceOrder, sourcePayment, sourceTransaction } from './synced-kit.js';
const stamp = '2026-10-10T00:00:00Z';
const fact = Effect.fnUntraced(function* (
	t: T,
	order: Effect.Success<ReturnType<typeof draft>>,
	external_code: string
) {
	const confirmed = (yield* (yield* t.as(t.admin)).query({
		orders: { where: { id: { eq: order.order } }, limit: 1 }
	})).orders.rows[0];
	expect(confirmed?.status).toBe('confirmed');
	return {
		external_code,
		order_id: order.order,
		order_line_id: order.line,
		kind: 'shipment',
		reference: external_code,
		business_on: '2026-09-15',
		source_updated_at: stamp,
		unit: 'kg',
		quantity: '10',
		currency: 'SGD',
		net_amount: '20',
		tax_amount: '1.80',
		freight: '3',
		active: true
	};
});
const pull = (t: T, rows: Json[]) => businessRows(t, 'source_sales_lines', rows);
it.live(
	'ERP sales report uses signed facts, source month, captured freight, consumed lot cost and owner scope',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = yield* t.as(t.admin),
				sales = t.member(['sales']),
				other = t.member(['sales']);
			const own = yield* draft(t, 'sales', fixtureId('sys_user', sales.id), '2026-08-01');
			const foreign = yield* draft(t, 'sales', fixtureId('sys_user', other.id), '2026-08-01');
			yield* confirm(t, own.order);
			yield* confirm(t, foreign.order);
			const shipment = { ...(yield* fact(t, own, 'SHIP-1')), lot_number: 'L001', unit_cost: '1.2' };
			const returned = {
				...shipment,
				external_code: 'RETURN-1',
				kind: 'return',
				quantity: '-2',
				net_amount: '-4',
				tax_amount: '-0.36',
				freight: '-0.60'
			};
			const foreignFact = {
				...(yield* fact(t, foreign, 'FOREIGN-1')),
				booked_cost: '3.456',
				booked_cost_currency: 'USD'
			};
			const missing = {
				...shipment,
				external_code: 'MISSING-1',
				business_on: '2026-10-01',
				freight: null,
				lot_number: null,
				unit_cost: null
			};
			const bookedShipment = { ...shipment, booked_cost: '11.52', booked_cost_currency: 'SGD' };
			yield* pull(t, [bookedShipment, returned, foreignFact, missing]);
			yield* pull(t, [bookedShipment, returned, foreignFact, missing]);
			const raw = (yield* as.query({ source_sales_lines: {} })).source_sales_lines.rows;
			expect(raw).toHaveLength(4);
			const physicalShipment = raw.find((row) => row.external_code === 'SHIP-1');
			if (!physicalShipment) throw new Error('Expected an owned delivery fact');
			const seller = yield* t.as(sales);
			expect(
				Exit.isFailure(
					yield* Effect.exit(seller.query({ source_sales_lines: { fields: ['booked_cost'] } }))
				)
			).toBe(true);
			const history = yield* seller.history('source_sales_lines', physicalShipment.id);
			expect(history).toHaveLength(1);
			expect(history[0]?.changed).not.toHaveProperty('booked_cost');
			expect(history[0]?.changed).not.toHaveProperty('booked_cost_currency');
			const privileged = salesDetail(yield* as.query(salesRead));
			expect(privileged.find((row) => row.external_code === 'SHIP-1')).toMatchObject({
				cost: decimalText('11.52'),
				cost_currency: 'SGD',
				margin: decimalText('5.48')
			});
			expect(privileged.find((row) => row.external_code === 'FOREIGN-1')).toMatchObject({
				cost: decimalText('3.46'),
				cost_currency: 'USD',
				margin: null
			});
			// a foreign sale meets its cost at its Kingdee rate: 17 SGD booked at 0.75 is 12.75 USD
			const foreignKey = (yield* as.query({
				orders: { where: { id: { eq: foreign.order } }, fields: ['source_order_key'], limit: 1 }
			})).orders.rows[0]?.source_order_key;
			yield* setKingdeeOrder(t, foreignKey ?? '', 'issued', '0.75');
			expect(
				salesDetail(yield* as.query(salesRead)).find((row) => row.external_code === 'FOREIGN-1')
			).toMatchObject({ cost_currency: 'USD', margin: decimalText('9.29'), margin_rate: '72.9' });
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(
							salesDetailOf(seller, {
								from: '2026-09-30',
								to: '2026-09-01'
							})
						)
					).rejects.toThrow('errors.report_range'),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			const detail = yield* salesDetailOf(yield* t.as(sales), {
				from: '2026-09-01',
				to: '2026-09-30'
			});
			expect(detail).toHaveLength(2);
			expect(detail).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						external_code: 'SHIP-1',
						cost: decimalText('12.00'),
						margin: decimalText('5.00')
					}),
					expect.objectContaining({
						order: own.order,
						external_code: 'RETURN-1',
						net: decimalText('-3.40'),
						cost: decimalText('-2.40'),
						margin: decimalText('-1.00')
					})
				])
			);
			// each line's net after the freight treatment its order captured when confirmed
			const salesperson = yield* t.as(sales);
			const shown = () =>
				salesDetailOf(salesperson, {}).pipe(
					Effect.map((rows) =>
						rows.map(({ external_code, freight_treatment, net }) => ({
							external_code,
							freight_treatment,
							net
						}))
					)
				);
			const before = [
				{ external_code: 'MISSING-1', freight_treatment: 'deduct', net: null },
				{ external_code: 'RETURN-1', freight_treatment: 'deduct', net: decimalText('-3.40') },
				{ external_code: 'SHIP-1', freight_treatment: 'deduct', net: decimalText('17.00') }
			];
			expect(yield* shown()).toEqual(before);
			expect(
				yield* salesDetailOf(yield* t.as(sales), { from: '2026-12-01', to: '2026-12-31' })
			).toEqual([]);
			// a later setting does not rewrite the treatment an order captured
			committed(
				'commercial_settings',
				yield* as.act({
					'commercial_settings.update': [
						{
							target: yield* t.at('commercial_settings', SETTINGS),
							set: { freight_treatment: 'include' }
						}
					]
				})
			);
			expect(yield* shown()).toEqual(before);
			yield* pull(t, [{ ...returned, active: false, source_updated_at: '2026-10-10T00:00:01Z' }]);
			expect(yield* shown()).toEqual([before[0], before[2]]);
		})
);
it.live(
	'a paged sales report reads every fact on both bases and refuses rows that move mid-read',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const own = yield* draft(t);
			yield* confirm(t, own.order);
			const base = yield* fact(t, own, 'SHIP-1');
			const facts = ['SHIP-1', 'SHIP-2', 'INV-1', 'INV-2'].map((code) => ({
				...base,
				external_code: code,
				reference: code,
				kind: code.startsWith('INV') ? 'invoice' : 'shipment'
			}));
			yield* pull(t, facts);
			const finance = yield* t.as(t.member(['finance']));
			for (const basis of ['delivery', 'invoice'] as const) {
				const paged = salesReadDuring({ from: null, to: null, basis }, false, 1);
				const first = yield* finance.query(paged);
				expect(first.source_sales_lines.next).not.toBeNull();
				const rows = yield* readSalesReport(finance, paged, first, basis);
				const complete = salesDetail(
					yield* finance.query(salesReadDuring({ from: null, to: null, basis })),
					{ basis }
				);
				expect(rows).toHaveLength(2);
				expect(rows).toEqual(complete);
			}
			const paged = salesReadDuring({ from: null, to: null, basis: 'delivery' }, false, 1);
			const first = yield* finance.query(paged);
			yield* pull(t, [{ ...base, external_code: 'SHIP-3', reference: 'SHIP-3' }]);
			expect(yield* Effect.flip(readSalesReport(finance, paged, first, 'delivery'))).toMatchObject({
				_tag: 'ReportRowsChanged'
			});
		})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}

it.live('sales analysis follows each line to its invoice and how far it is collected', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const billed = yield* draft(t);
		const unbilled = yield* draft(t);
		yield* confirm(t, billed.order);
		yield* confirm(t, unbilled.order);
		const shipped = yield* fact(t, billed, 'DO-7/1');
		yield* pull(t, [
			shipped,
			{ ...shipped, external_code: 'INV-7/1', reference: 'INV-7/1', kind: 'invoice' },
			yield* fact(t, unbilled, 'DO-8/1')
		]);
		const parent = yield* sourceOrder(t, billed.order);
		const invoice = yield* sourceTransaction(t, billed, parent, 'invoice', '10', {
			reference: 'INV-7',
			due_on: '2026-10-15'
		});
		yield* sourcePayment(t, parent, invoice.id, '10');
		const finance = yield* t.as(t.member(['finance']));
		const chain = (basis: 'delivery' | 'invoice') =>
			Effect.gen(function* () {
				const detail = salesDetail(
					yield* finance.query(salesReadDuring({ from: null, to: null, basis })),
					{ basis }
				);
				const orders = [...new Set(detail.flatMap((row) => row.order ?? []))];
				return salesCollection(detail, yield* finance.query(salesCollectionRead(orders)));
			});
		const delivered = yield* chain('delivery');
		expect(delivered.find((row) => row.reference === 'DO-7/1')).toMatchObject({
			invoice_numbers: 'INV-7',
			due_on: '2026-10-15',
			collection: 'partial',
			collected_on: null
		});
		expect(delivered.find((row) => row.reference === 'DO-8/1')).toMatchObject({
			invoice_numbers: '',
			collection: 'uninvoiced'
		});
		yield* sourcePayment(t, parent, invoice.id, '11.80');
		expect((yield* chain('invoice')).find((row) => row.reference === 'INV-7/1')).toMatchObject({
			invoice_numbers: 'INV-7',
			collection: 'paid',
			collected_on: '2026-10-09'
		});
	})
);

it.live(
	'sales analysis follows a sold lot back to its receipts, purchase invoices and supplier payment',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const sold = yield* draft(t);
			yield* confirm(t, sold.order);
			yield* pull(t, [{ ...(yield* fact(t, sold, 'DO-9/1')), lot_number: 'L-9' }]);
			const purchase = (rows: Record<string, Json>[]) =>
				t.syncs.write(
					'source_purchase_lines.sync.receipts',
					rows.map((row) => ({ source: 'kingdee', source_updated_at: stamp, active: true, ...row }))
				);
			const line = {
				product_code: 'RESIN-A',
				lot_number: 'L-9',
				unit: 'kg',
				currency: 'SGD',
				supplier_name: 'Supplier S'
			};
			yield* purchase([
				{
					...line,
					external_code: 'receipt:11:1',
					kind: 'receipt',
					reference: 'WIN-11',
					business_on: '2026-09-01',
					quantity: '10',
					net_amount: '15',
					order_reference: 'POORD-1',
					upstream: 'order:1:1'
				},
				{
					...line,
					external_code: 'receipt:12:1',
					kind: 'receipt',
					reference: 'WIN-12',
					business_on: '2026-09-05',
					quantity: '10',
					net_amount: '25',
					order_reference: 'POORD-1',
					upstream: 'order:1:1'
				}
			]);
			const invoice = (open: string) =>
				purchase([
					{
						...line,
						external_code: 'invoice:21:1',
						kind: 'invoice',
						reference: 'PINV-21',
						business_on: '2026-09-10',
						quantity: '10',
						net_amount: '15',
						upstream: 'receipt:11:1',
						billed_amount: '16.95',
						open_amount: open,
						paid_on: '2026-09-20'
					}
				]);
			const finance = yield* t.as(t.member(['finance']));
			const chain = Effect.gen(function* () {
				const detail = salesDetail(
					yield* finance.query(salesReadDuring({ from: null, to: null, basis: 'delivery' })),
					{ basis: 'delivery' }
				);
				const lots = [...new Set(detail.flatMap((row) => row.lot_number ?? []))];
				const purchased = (yield* finance.query(purchaseChainRead(lots))).source_purchase_lines
					.rows;
				return purchaseChain(detail, purchased).find((row) => row.reference === 'DO-9/1');
			});
			expect(yield* chain).toMatchObject({
				order_reference: 'POORD-1',
				supplier: 'Supplier S',
				purchase_price: '2',
				first_received_on: '2026-09-01',
				purchase_invoices: '',
				supplier_payment: 'uninvoiced'
			});
			yield* invoice('6.95');
			expect(yield* chain).toMatchObject({
				purchase_invoices: 'PINV-21',
				purchase_invoiced_on: '2026-09-10',
				supplier_payment: 'partial',
				supplier_paid_on: null
			});
			yield* invoice('0');
			expect(yield* chain).toMatchObject({
				supplier_payment: 'paid',
				supplier_paid_on: '2026-09-20'
			});
		})
);

it.live(
	'sales analysis exposes customer region, related-party flag, product category and VAT on linked and invoice-only lines',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = yield* t.as(t.admin);
			const finance = yield* t.as(t.member(['finance']));
			const own = yield* draft(t);
			yield* confirm(t, own.order);

			const orderRow = (yield* as.query({
				orders: {
					where: { id: { eq: own.order } },
					fields: ['party'],
					lines: { fields: ['product'] },
					limit: 1
				}
			})).orders.rows[0];
			if (!orderRow || !orderRow.lines[0]) throw new Error('Expected confirmed order and line');
			const partyId = orderRow.party;
			const productId = orderRow.lines[0].product;
			const party = (yield* as.query({
				parties: { where: { id: { eq: partyId } }, limit: 1 }
			})).parties.rows[0];
			const product = (yield* as.query({
				products: { where: { id: { eq: productId } }, limit: 1 }
			})).products.rows[0];
			if (!party || !product) throw new Error('Expected party and product rows');
			yield* t.syncs.write('parties.sync.kingdee', [
				{
					source: 'kingdee',
					external_code: party.external_code,
					name: party.name,
					kind: party.kind,
					currency: party.currency,
					active: party.active,
					region: 'East China',
					source_updated_at: stamp
				}
			]);
			committed(
				'parties',
				yield* finance.act({
					'parties.update': [
						{ target: yield* t.at('parties', partyId), set: { related_party: true } }
					]
				})
			);
			yield* t.syncs.write('products.sync.kingdee', [
				{
					source: 'kingdee',
					external_code: product.external_code,
					name: product.name,
					currency: product.currency,
					active: product.active,
					category: 'Resins',
					source_updated_at: stamp
				}
			]);

			const linked = yield* fact(t, own, 'SHIP-DIM-1');
			const standalone = {
				external_code: 'INV-ONLY-1',
				kind: 'invoice_only',
				reference: 'INV-900/1',
				business_on: '2026-09-20',
				source_updated_at: stamp,
				unit: 'kg',
				quantity: '5',
				currency: 'SGD',
				net_amount: '100',
				tax_amount: '13.00',
				freight: '0',
				active: true,
				source_dimensions: {
					customer: 'Standalone Co',
					customer_id: 'C-101',
					customer_region: 'North China',
					product: 'Compound X',
					product_category: 'Additives',
					employee: 'Alex'
				}
			};
			const standaloneUnmatched = {
				...standalone,
				external_code: 'INV-ONLY-2',
				reference: 'INV-901/1',
				source_dimensions: {
					customer: 'External Co',
					customer_id: 'UNLISTED-999',
					customer_region: 'North China',
					product: 'Compound Y',
					product_category: 'Solvents',
					employee: 'Sam'
				}
			};
			yield* pull(t, [linked]);
			yield* t.syncs.write('source_sales_lines.sync.kingdee', [
				{ source: 'kingdee', ...standalone },
				{ source: 'kingdee', ...standaloneUnmatched }
			]);

			const deliveryRows = salesDetail(
				yield* finance.query(
					salesReadDuring({ from: '2026-09-01', to: '2026-09-30', basis: 'delivery' })
				),
				{ basis: 'delivery' }
			);
			expect(deliveryRows.find((r) => r.external_code === 'SHIP-DIM-1')).toMatchObject({
				party_region: 'East China',
				related_party: true,
				product_category: 'Resins',
				tax: decimalText('1.80')
			});

			const invoiceRows = salesDetail(
				yield* finance.query(
					salesReadDuring({ from: '2026-09-01', to: '2026-09-30', basis: 'invoice' })
				),
				{ basis: 'invoice' }
			);
			expect(invoiceRows.find((r) => r.external_code === 'INV-ONLY-1')).toMatchObject({
				party_region: 'East China',
				related_party: true,
				product_category: 'Additives',
				net: decimalText('100.00'),
				tax: decimalText('13.00')
			});
			expect(invoiceRows.find((r) => r.external_code === 'INV-ONLY-2')).toMatchObject({
				party_region: 'North China',
				related_party: false,
				product_category: 'Solvents',
				net: decimalText('100.00'),
				tax: decimalText('13.00')
			});
		})
);

it.live(
	'computes standalone invoice_only net with null freight, omits margin_rate on negative returns, handles credit-note collection, and converts units/isolates ledgers in purchaseChain',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const finance = yield* t.as(t.member(['finance']));
			const own = yield* draft(t);
			yield* confirm(t, own.order);
			const parent = yield* sourceOrder(t, own.order);

			// 1) Standalone invoice_only with freight: null still contributes to net; return row with costedNet < 0 omits margin_rate.
			const retFact = {
				...(yield* fact(t, own, 'RET-NEG-1')),
				kind: 'return',
				quantity: '-2',
				net_amount: '-100',
				tax_amount: '-9',
				freight: '0',
				booked_cost: '-80',
				booked_cost_currency: 'SGD'
			};
			yield* pull(t, [retFact]);
			yield* t.syncs.write('source_sales_lines.sync.kingdee', [
				{
					source: 'kingdee',
					external_code: 'INV-ONLY-NULL-FREIGHT',
					kind: 'invoice_only',
					reference: 'INV-STANDALONE-1',
					business_on: '2026-09-21',
					source_updated_at: stamp,
					unit: 'kg',
					quantity: '4',
					currency: 'SGD',
					net_amount: '250.00',
					tax_amount: '22.50',
					freight: null,
					active: true,
					source_dimensions: {
						customer: 'Standalone Co',
						customer_id: 'C-STANDALONE',
						product: 'Additive Z'
					}
				}
			]);
			const deliveryRows = salesDetail(
				yield* finance.query(
					salesReadDuring({ from: '2026-09-01', to: '2026-09-30', basis: 'delivery' })
				),
				{ basis: 'delivery' }
			);
			const retRow = deliveryRows.find((r) => r.external_code === 'RET-NEG-1');
			expect(retRow).toMatchObject({
				net: decimalText('-100.00'),
				margin: decimalText('-20.00'),
				margin_rate: null
			});
			const invRows = salesDetail(
				yield* finance.query(
					salesReadDuring({ from: '2026-09-01', to: '2026-09-30', basis: 'invoice' })
				),
				{ basis: 'invoice' }
			);
			expect(invRows.find((r) => r.external_code === 'INV-ONLY-NULL-FREIGHT')).toMatchObject({
				net: decimalText('250.00'),
				tax: decimalText('22.50')
			});

			// 2) salesCollection handles references without '/' AND credit-note invoices (billed < 0).
			const creditInv = yield* sourceTransaction(t, own, parent, 'invoice', '-2', {
				reference: 'CN-2026-1',
				total: '-100.00'
			});
			const cnFact = {
				...(yield* fact(t, own, 'CN-LINE-1')),
				kind: 'invoice',
				reference: 'CN-2026-1',
				quantity: '-2',
				net_amount: '-100.00',
				tax_amount: '0',
				freight: '0'
			};
			yield* pull(t, [cnFact]);
			const cnDetail = salesDetail(
				yield* finance.query(
					salesReadDuring({ from: '2026-09-01', to: '2026-09-30', basis: 'invoice' })
				),
				{ basis: 'invoice' }
			).filter((r) => r.external_code === 'CN-LINE-1');
			expect(
				salesCollection(cnDetail, yield* finance.query(salesCollectionRead([own.order])))[0]
					?.collection
			).toBe('unpaid');
			yield* sourcePayment(t, parent, creditInv.id, '-40.00', 'REFUND-PARTIAL');
			expect(
				salesCollection(cnDetail, yield* finance.query(salesCollectionRead([own.order])))[0]
					?.collection
			).toBe('partial');
			yield* sourcePayment(t, parent, creditInv.id, '-60.00', 'REFUND-REST');
			expect(
				salesCollection(cnDetail, yield* finance.query(salesCollectionRead([own.order])))[0]
					?.collection
			).toBe('paid');

			// 3) purchaseChain isolates ledgers, converts t -> kg via unitRatio, and attaches purchase_price_currency.
			const admin = yield* t.as(t.admin);
			const otherLedger = committed(
				'sys_integration',
				yield* admin.act({
					'sys_integration.create': [
						{
							integration: 'kingdee',
							name: 'Secondary Ledger',
							configuration: { baseCurrency: 'USD' }
						}
					]
				})
			);
			yield* t.syncs.write(
				'source_purchase_lines.sync.receipts',
				[
					{
						source: 'kingdee',
						external_code: 'REC-1',
						kind: 'receipt',
						reference: 'WIN-1',
						business_on: '2026-09-01',
						source_updated_at: stamp,
						supplier_name: 'Main Supplier',
						product_code: 'RESIN-A',
						lot_number: 'LOT-MIX',
						unit: 't',
						currency: 'CNY',
						quantity: '2',
						net_amount: '24000.00',
						order_reference: 'PO-1',
						active: true
					}
				],
				{ instance: 'kingdee' }
			);
			yield* t.syncs.write(
				'source_purchase_lines.sync.receipts',
				[
					{
						source: otherLedger,
						external_code: 'REC-OTHER',
						kind: 'receipt',
						reference: 'WIN-OTHER',
						business_on: '2026-09-02',
						source_updated_at: stamp,
						supplier_name: 'Other Ledger Supplier',
						product_code: 'RESIN-A',
						lot_number: 'LOT-MIX',
						unit: 'kg',
						currency: 'USD',
						quantity: '100',
						net_amount: '9999.00',
						order_reference: 'PO-OTHER',
						active: true
					}
				],
				{ instance: otherLedger }
			);
			const purchaseLines = (yield* finance.query(purchaseChainRead(['LOT-MIX'])))
				.source_purchase_lines.rows;
			const mainLine = purchaseLines.find((r) => r.external_code === 'REC-1');
			const otherLine = purchaseLines.find((r) => r.external_code === 'REC-OTHER');
			if (!mainLine || !otherLine) throw new Error('Expected synced purchase receipt lines');
			const chained = purchaseChain(
				[{ source: mainLine.source, product_code: 'RESIN-A', lot_number: 'LOT-MIX', unit: 'kg' }],
				purchaseLines
			);
			expect(chained[0]).toMatchObject({
				supplier: 'Main Supplier',
				purchase_price: '12',
				purchase_price_currency: 'CNY'
			});
			// Mixed currencies on same ledger withhold purchase_price and purchase_price_currency.
			const mixed = purchaseChain(
				[{ source: mainLine.source, product_code: 'RESIN-A', lot_number: 'LOT-MIX', unit: 'kg' }],
				[mainLine, { ...otherLine, source: mainLine.source }]
			);
			expect(mixed[0]).toMatchObject({
				purchase_price: null,
				purchase_price_currency: null
			});
		})
);
