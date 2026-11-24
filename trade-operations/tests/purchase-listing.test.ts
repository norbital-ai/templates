import { expect, it } from '@effect/vitest';
import { BigDecimal, Effect, Exit } from 'effect';
import {
	allocateExpenses,
	fixedDecimal,
	purchasePaymentStatus,
	sharesOffReport,
	summarizeExpenses,
	type ExpenseSharePair
} from '../src/lib/purchase-listing.js';
import { mapPurchaseListingEntry } from '../src/integration/kingdee/purchase-listing.js';
import { purchaseListingTotals, readPurchaseListingAt } from '../src/lib/reports.js';
import type { SqlRow } from '../src/integration/kingdee/polling.js';
import { committed, confirm, draft, SUPPLIER, workspace } from './kit.js';
import { kingdeeFixture } from './kingdee-fixture.js';
import { sourceOrder, sourcePayment, sourceTransaction } from './synced-kit.js';
import { decimalText, firstRow, fixtureId } from './test-runtime.js';

const padded = (value: string, width = 20) => value.padStart(width, '0');

it('allocates expense charges proportionally by positive receipt weight with exact cent remainder on the last PO line', () => {
	const pairs: ExpenseSharePair[] = [
		// 100.00 split evenly 3 ways: 33.33, 33.33, 33.34 on last (order_id 11, entry_id 1)
		{
			expense_id: '500',
			expense_entry_id: '1',
			kind: 'duty',
			amount: '100.00',
			order_id: '11',
			entry_id: '1',
			weight: '100'
		},
		{
			expense_id: '500',
			expense_entry_id: '1',
			kind: 'duty',
			amount: '100.00',
			order_id: '10',
			entry_id: '2',
			weight: '100'
		},
		{
			expense_id: '500',
			expense_entry_id: '1',
			kind: 'duty',
			amount: '100.00',
			order_id: '10',
			entry_id: '1',
			weight: '100'
		},
		// Negative net receipt weight takes no share; positive line takes full charge
		{
			expense_id: '501',
			expense_entry_id: '1',
			kind: 'import_vat',
			amount: '75.50',
			order_id: '20',
			entry_id: '1',
			weight: '-200'
		},
		{
			expense_id: '501',
			expense_entry_id: '1',
			kind: 'import_vat',
			amount: '75.50',
			order_id: '20',
			entry_id: '2',
			weight: '50'
		},
		// Second import VAT on 20/2 accumulates onto existing share
		{
			expense_id: '502',
			expense_entry_id: '1',
			kind: 'import_vat',
			amount: '24.50',
			order_id: '20',
			entry_id: '2',
			weight: '50'
		}
	];
	const shares = allocateExpenses(pairs);
	expect(shares.get('10/1')).toEqual({ duty: '33.33', import_vat: null });
	expect(shares.get('10/2')).toEqual({ duty: '33.33', import_vat: null });
	expect(shares.get('11/1')).toEqual({ duty: '33.34', import_vat: null });
	expect(shares.get('20/1')).toBeUndefined();
	expect(shares.get('20/2')).toEqual({ duty: null, import_vat: '100.00' });

	// Off-report shares count distinct expense lines and total amount allocated outside reportKeys
	const off = sharesOffReport(pairs, shares, new Set(['10/1', '10/2', '20/2']));
	expect(off.rows).toBe(1);
	expect(BigDecimal.format(off.amount)).toBe('33.34');
});

it('formats arbitrary-precision BigDecimals half-up without IEEE-754 float truncation', () => {
	expect(fixedDecimal(BigDecimal.fromStringUnsafe('9007199254740993.125'), 2)).toBe(
		'9007199254740993.13'
	);
	expect(fixedDecimal(BigDecimal.fromStringUnsafe('-0.004'), 2)).toBe('0.00');
	expect(fixedDecimal(BigDecimal.normalize(BigDecimal.fromStringUnsafe('1000')), 2)).toBe(
		'1000.00'
	);
	expect(fixedDecimal(BigDecimal.fromBigInt(0n), 3)).toBe('0.000');
});

it('partitions expense lines into allocated shares, unattached, and before-start without double counting', () => {
	const result = summarizeExpenses(
		[
			{
				expense_id: '1',
				expense_entry_id: '1',
				group_id: '10',
				dated_on: '2025-03-01',
				kind: 'duty',
				amount: '40.00'
			},
			{
				expense_id: '2',
				expense_entry_id: '1',
				group_id: '20',
				dated_on: '2025-03-02',
				kind: 'import_vat',
				amount: '15.00'
			},
			{
				expense_id: '3',
				expense_entry_id: '1',
				group_id: '30',
				dated_on: '2025-03-03',
				kind: 'import_vat',
				amount: '80.00'
			}
		],
		[
			{ group_id: '10', order_id: '50', entry_id: '1', weight: '100', in_report: false },
			{ group_id: '10', order_id: '102', entry_id: '1', weight: '300', in_report: true },
			{ group_id: '20', order_id: '99', entry_id: '1', weight: '-50', in_report: true },
			{ group_id: '30', order_id: '40', entry_id: '1', weight: '200', in_report: false }
		],
		new Set(['102/1'])
	);
	expect(result.shares.get('102/1')).toEqual({ duty: '30.00', import_vat: null });
	expect(result.notice).toEqual({
		unattached_rows: 1,
		unattached_amount: '15.00',
		before_start_rows: 2,
		before_start_amount: '90.00'
	});
});

it('derives purchase payment status including partial-quantity downgrade (R14)', () => {
	expect(purchasePaymentStatus(0, null, null, null, '10.000')).toBe('uninvoiced');
	expect(purchasePaymentStatus(1, 0, 0, '10.000', '10.000')).toBe('unpaid');
	expect(purchasePaymentStatus(1, 1, 1, '10.000', '10.000')).toBe('partial');
	expect(purchasePaymentStatus(2, 0, 2, '10.000', '10.000')).toBe('partial');
	expect(purchasePaymentStatus(1, 2, 2, '10.000', '10.000')).toBe('paid');
	// Paid invoice covering strictly less than ordered quantity downgrades to partial
	expect(purchasePaymentStatus(1, 2, 2, '4.000', '10.000')).toBe('partial');
	expect(purchasePaymentStatus(1, 2, 2, '0.000', '10.000')).toBe('partial');
	expect(purchasePaymentStatus(1, null, null, '10.000', '10.000')).toBeNull();
});

it('maps PO lines with safe due-date fallback, VAT combining import VAT, and sentinel cleanup', () => {
	const entry = mapPurchaseListingEntry(
		{
			order_id: '100',
			entry_id: '1',
			order_number: 'PO-2025-001',
			ordered_on: '2025-03-05',
			supplier_id: '201',
			supplier_name: 'Supplier North',
			product_category: '*',
			product_spec: 'Grade A',
			quantity: '10',
			currency: 'RMB',
			unit_price: '11.3',
			exchange_rate: '1',
			amount: '113',
			amount_base: '113',
			received_qty: '10',
			last_received_on: '2025-03-08',
			invoiced_on: '2025-03-10',
			invoice_lines: 1,
			invoiced_qty: '10',
			net_amount: '100',
			invoice_tax: '13',
			paid_amount: '50',
			status_min: 1,
			status_max: 1,
			due_on: '3290-11-13',
			paid_on: '2025-03-20',
			settlement_code: 'M30',
			settlement: '*',
			note: 'Urgent'
		},
		{ duty: '4.25', import_vat: '7.50' },
		{ M30: { creditDays: 30, fromMonthEnd: true } },
		2,
		'PINV-1, PINV-2'
	);
	expect(entry).toMatchObject({
		order_number: 'PO-2025-001',
		product_category: null,
		currency: 'CNY',
		settlement: null,
		invoice_numbers: 'PINV-1, PINV-2',
		invoice_amount: '113.00',
		duty: '4.25',
		vat_amount: '20.50',
		due_on: '2025-04-30',
		payment_status: 'partial'
	});
});

it.live(
	'syncs period-sharded Kingdee purchase listing, stays quiet when idle, preserves notice when a later month empties, and joins live related_party',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const state: {
				digest: string;
				observed: string;
				lines: SqlRow[];
				invoiceNumbers: SqlRow[];
				expenseLines: SqlRow[];
				hookWeights: SqlRow[];
				checkpointCalls: number;
				listingCalls: number;
			} = {
				digest: 'v1',
				observed: '2025-04-01T01:00:00.000Z',
				lines: [
					{
						__key: `${padded('101')}:${padded('1', 10)}`,
						order_id: '101',
						entry_id: '1',
						order_number: 'PO-FEB-1',
						ordered_on: '2025-02-15',
						supplier_id: '201',
						supplier_name: 'Kingdee supplier',
						product_category: 'Polymers',
						product_spec: 'A',
						quantity: '10',
						currency: 'RMB',
						unit_price: '20',
						exchange_rate: '1',
						amount: '200',
						amount_base: '200',
						received_qty: '10',
						last_received_on: '2025-02-20',
						invoiced_on: '2025-02-22',
						invoice_lines: 1,
						invoiced_qty: '10',
						net_amount: '176.99',
						invoice_tax: '23.01',
						paid_amount: '200',
						status_min: 2,
						status_max: 2,
						due_on: '3290-11-13',
						paid_on: '2025-03-01',
						settlement_code: 'PROBE-NET30',
						settlement: 'Probe net 30',
						note: null
					},
					{
						__key: `${padded('102')}:${padded('1', 10)}`,
						order_id: '102',
						entry_id: '1',
						order_number: 'PO-MAR-1',
						ordered_on: '2025-03-10',
						supplier_id: '202',
						supplier_name: 'Supplier South',
						product_category: 'Additives',
						product_spec: 'B',
						quantity: '8',
						currency: 'USD',
						unit_price: '10',
						exchange_rate: '7.2',
						amount: '80',
						amount_base: '576',
						received_qty: '5',
						last_received_on: '2025-03-18',
						invoiced_on: '2025-03-20',
						invoice_lines: 1,
						invoiced_qty: '5',
						net_amount: '360',
						invoice_tax: '0',
						paid_amount: '100',
						status_min: 2,
						status_max: 2,
						due_on: '2025-04-20',
						paid_on: '2025-03-25',
						settlement_code: null,
						settlement: null,
						note: 'Import batch'
					}
				],
				invoiceNumbers: [
					{
						__key: `${padded('101')}:${padded('1', 10)}:${padded('701')}`,
						order_id: '101',
						entry_id: '1',
						invoice_number: 'PINV-201'
					},
					{
						__key: `${padded('102')}:${padded('1', 10)}:${padded('702')}`,
						order_id: '102',
						entry_id: '1',
						invoice_number: 'PINV-301'
					}
				],
				expenseLines: [
					{
						__key: `${padded('900')}:${padded('1', 10)}`,
						expense_id: '900',
						expense_entry_id: '1',
						group_id: '10',
						dated_on: '2025-03-20',
						kind: 'duty',
						amount: '40.00'
					},
					{
						__key: `${padded('900')}:${padded('2', 10)}`,
						expense_id: '900',
						expense_entry_id: '2',
						group_id: '10',
						dated_on: '2025-03-20',
						kind: 'import_vat',
						amount: '46.80'
					},
					{
						__key: `${padded('901')}:${padded('1', 10)}`,
						expense_id: '901',
						expense_entry_id: '1',
						group_id: '20',
						dated_on: '2025-03-21',
						kind: 'import_vat',
						amount: '15.00'
					},
					{
						__key: `${padded('902')}:${padded('1', 10)}`,
						expense_id: '902',
						expense_entry_id: '1',
						group_id: '30',
						dated_on: '2025-03-22',
						kind: 'import_vat',
						amount: '80.00'
					}
				],
				hookWeights: [
					// Group 10: shared between pre-start 50/1 (100) and in-report 102/1 (300)
					{
						__key: `${padded('10')}:${padded('50')}:${padded('1', 10)}`,
						group_id: '10',
						order_id: '50',
						entry_id: '1',
						weight: '100',
						in_report: false
					},
					{
						__key: `${padded('10')}:${padded('102')}:${padded('1', 10)}`,
						group_id: '10',
						order_id: '102',
						entry_id: '1',
						weight: '300',
						in_report: true
					},
					// Group 30: only pre-start PO 40/1
					{
						__key: `${padded('30')}:${padded('40')}:${padded('1', 10)}`,
						group_id: '30',
						order_id: '40',
						entry_id: '1',
						weight: '200',
						in_report: false
					}
				],
				checkpointCalls: 0,
				listingCalls: 0
			};

			const t = yield* workspace({
				now: state.observed,
				source: (op) => {
					if (op.op !== 'call') return fixture.request(op);
					const stmt = String(op.arguments.stmt);
					const after = String(op.arguments.after ?? '');
					const page = (rows: readonly SqlRow[]) =>
						Effect.succeed({ rows: rows.filter((row) => String(row.__key) > after) });
					if (stmt.includes('kingdee-purchase-listing-checkpoint')) {
						state.checkpointCalls++;
						return page([{ __key: 'pl', observed_at: state.observed, digest: state.digest }]);
					}
					if (stmt.includes('kingdee-purchase-listing-lines')) {
						state.listingCalls++;
						return page(state.lines);
					}
					if (stmt.includes('kingdee-purchase-listing-invoice-numbers'))
						return page(state.invoiceNumbers);
					if (stmt.includes('kingdee-purchase-listing-expense-lines'))
						return page(state.expenseLines);
					if (stmt.includes('kingdee-purchase-listing-hook-weights'))
						return page(state.hookWeights);
					return fixture.request(op);
				}
			});
			const as = yield* t.as(t.admin);
			const finance = yield* t.as(t.member(['finance']));
			const manager = yield* t.as(t.member(['manager']));
			const procurement = yield* t.as(t.member(['procurement']));
			const sales = yield* t.as(t.member(['sales']));
			const logistics = yield* t.as(t.member(['logistics']));
			const instance = fixtureId('sys_integration', 'kingdee');

			// Opt-in gating: unset purchaseListingAccount performs zero SQL reads
			yield* as.act({
				'sys_integration.update': [
					{ target: { id: instance }, set: { configuration: fixture.configuration('pl-owner') } }
				]
			});
			yield* t.pull('source_purchase_orders');
			expect(state.checkpointCalls).toBe(0);

			// Enable purchaseListingAccount + pull parties so supplier 201 exists locally
			const config = fixture.configuration('pl-owner');
			yield* as.act({
				'sys_integration.update': [
					{
						target: { id: instance },
						set: {
							configuration: {
								...config,
								purchaseListingAccount: config.writeAccount,
								settlementRules: JSON.stringify({
									'PROBE-NET30': { creditDays: 30, fromMonthEnd: false }
								})
							}
						}
					}
				]
			});
			yield* t.pull('parties');
			yield* t.pull('source_purchase_orders');
			expect(state.checkpointCalls).toBe(2);
			expect(state.listingCalls).toBe(1);

			// Second pull with identical digest runs checkpoint once and skips listing queries
			yield* t.pull('source_purchase_orders');
			expect(state.checkpointCalls).toBe(3);
			expect(state.listingCalls).toBe(1);

			// Mark supplier 201 as related party via Finance (no Kingdee re-sync needed)
			const supplier201 = firstRow(
				(yield* as.query({
					parties: {
						where: { source: { eq: instance }, external_code: { eq: '201' } },
						limit: 1
					}
				})).parties.rows
			);
			committed(
				'parties',
				yield* finance.act({
					'parties.update': [
						{ target: yield* t.at('parties', supplier201.id), set: { related_party: true } }
					]
				})
			);

			const report = yield* readPurchaseListingAt(
				finance,
				{ from: '2025-01-01', to: '2025-12-31' },
				{ sourcePurchaseOrders: true, localOrders: true }
			);
			expect(report.rows).toHaveLength(2);
			const feb = report.rows.find((r) => r.order_number === 'PO-FEB-1');
			const mar = report.rows.find((r) => r.order_number === 'PO-MAR-1');
			expect(feb).toMatchObject({
				related_party: true,
				due_on: '2025-03-24',
				unreceived_qty: '0.000',
				unpaid_amount: '0.00',
				payment_status: 'paid'
			});
			// PO-MAR-1 gets 30.00 duty (3/4 of 40.00), 35.10 import VAT (3/4 of 46.80), and R14 partial status (5 < 8)
			expect(mar).toMatchObject({
				related_party: false,
				invoice_numbers: 'PINV-301',
				duty: '30.00',
				vat_amount: '35.10',
				unreceived_qty: '3.000',
				unpaid_amount: '260.00',
				payment_status: 'partial'
			});
			// Notice combines pre-start group 30 (1 line, 80.00) + off-report shares on 50/1 from group 10 (2 lines, 10.00 + 11.70 = 21.70)
			expect(report.notices).toMatchObject([
				{
					currency: 'CNY',
					unattached_rows: 1,
					unattached_amount: '15.00',
					before_start_rows: 3,
					before_start_amount: '101.70'
				}
			]);
			expect(purchaseListingTotals(report.rows)).toMatchObject([
				{
					currency: 'CNY',
					lines: 2,
					quantity: '18',
					received_qty: '15',
					unreceived_qty: '3'
				}
			]);

			// Emptying the later month (2025-03) moves expense_notice onto 2025-02; readPurchaseListingAt still surfaces it
			state.digest = 'v2';
			state.observed = '2025-04-02T01:00:00.000Z';
			state.lines = state.lines.slice(0, 1);
			state.invoiceNumbers = state.invoiceNumbers.slice(0, 1);
			state.expenseLines = [
				{
					__key: `${padded('910')}:${padded('1', 10)}`,
					expense_id: '910',
					expense_entry_id: '1',
					group_id: '99',
					dated_on: '2025-03-25',
					kind: 'import_vat',
					amount: '12.50'
				},
				{
					__key: `${padded('911')}:${padded('1', 10)}`,
					expense_id: '911',
					expense_entry_id: '1',
					group_id: '99',
					dated_on: '2025-03-26',
					kind: 'import_vat',
					amount: '12.50'
				}
			];
			state.hookWeights = [];
			yield* t.pull('source_purchase_orders');
			const afterCancel = yield* readPurchaseListingAt(
				finance,
				{ from: '2025-01-01', to: '2025-12-31' },
				{ sourcePurchaseOrders: true, localOrders: true }
			);
			expect(afterCancel.rows.map((r) => r.order_number)).toEqual(['PO-FEB-1']);
			expect(afterCancel.notices).toMatchObject([
				{ unattached_rows: 2, unattached_amount: '25.00', before_start_rows: 0 }
			]);

			// Role scoping: finance, manager, procurement can read; sales and logistics cannot
			for (const allowed of [finance, manager, procurement]) {
				const answer = yield* allowed.query({ source_purchase_orders: {} });
				expect(answer.source_purchase_orders.rows.length).toBeGreaterThan(0);
			}
			for (const denied of [sales, logistics]) {
				expect(
					Exit.isFailure(yield* Effect.exit(denied.query({ source_purchase_orders: {} })))
				).toBe(true);
			}
		})
);

it.live(
	'falls back to local confirmed purchasing orders, receipts, invoices and payments when Kingdee purchase listing is disabled',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const finance = yield* t.as(t.member(['finance']));
			const purchase = yield* draft(t, 'purchasing', undefined, '2026-09-10');
			yield* confirm(t, purchase.order);
			committed(
				'parties',
				yield* finance.act({
					'parties.update': [
						{ target: yield* t.at('parties', SUPPLIER), set: { related_party: true } }
					]
				})
			);
			const parent = yield* sourceOrder(t, purchase.order);
			yield* sourceTransaction(t, purchase, parent, 'delivery', '6', {
				reference: 'REC-1',
				issued_on: '2026-09-15'
			});
			const inv = yield* sourceTransaction(t, purchase, parent, 'invoice', '6', {
				reference: 'PINV-1',
				issued_on: '2026-09-18',
				due_on: '2026-10-18',
				total: '13.08'
			});
			yield* sourcePayment(t, parent, inv.id, '5.00', 'PAY-1', { settled_on: '2026-09-20' });

			const report = yield* readPurchaseListingAt(
				finance,
				{ from: '2026-09-01', to: '2026-09-30' },
				{ sourcePurchaseOrders: true, localOrders: true }
			);
			expect(report.rows).toHaveLength(1);
			expect(report.rows[0]).toMatchObject({
				order: purchase.order,
				related_party: true,
				quantity: '10.000',
				received_qty: '6.000',
				unreceived_qty: '4.000',
				last_received_on: '2026-09-15',
				invoice_numbers: 'PINV-1',
				invoiced_qty: '6.000',
				due_on: '2026-10-18',
				paid_amount: decimalText('5.00'),
				payment_status: 'partial'
			});
		})
);
