import { decimalText, firstRow, fixtureId } from './test-runtime.js';
import { DateTime, Effect } from 'effect';
import { sourceOrder, sourceTransaction, sourcePayment } from './synced-kit.js';
import { expect, it as test } from '@effect/vitest';
import { committed, workspace, draft, confirm } from './kit.js';
import { agingOf } from './reads.js';
import {
	agingDetails,
	agingRead,
	agingSummary,
	commissionCalculation,
	creditExceptions,
	creditRead,
	estimateAging,
	readAgingReport
} from '../src/lib/reports.js';
import { businessRows } from './business-source.js';
test.live(
	'AR separates applied payments, unapplied deposits, overdue buckets and overpayments',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const { order, line } = yield* draft(t);
			yield* confirm(t, order);
			const as = yield* t.as(t.admin);
			const parent = yield* sourceOrder(t, order);
			const invoice = yield* sourceTransaction(t, { order, line }, parent);
			yield* sourcePayment(t, parent, invoice.id, '5');
			yield* sourcePayment(t, parent, null, '3');
			const cutoff = '2026-10-10';
			const paged = agingRead(cutoff, [], 1);
			const first = yield* as.query(paged);
			expect(first.source_payments.next).not.toBeNull();
			const full = yield* as.query(agingRead(cutoff));
			expect(yield* readAgingReport(as, paged, first, cutoff, Effect.succeed([]))).toEqual(
				agingDetails(full, cutoff)
			);

			expect(yield* agingOf(as, { as_of: '2026-10-10' })).toMatchObject([
				{ balance: decimalText('16.80'), bucket: '61_90', overpaid: decimalText('0') }
			]);
			yield* sourcePayment(t, parent, invoice.id, '20');
			committed(
				'orders',
				yield* as.act({
					'orders.update': [{ target: yield* t.at('orders', order), set: { archived: true } }]
				})
			);
			expect(yield* agingOf(as, { as_of: '2026-10-10' })).toMatchObject([
				{ balance: decimalText('0'), overpaid: decimalText('3.20') }
			]);
		})
);

test('the account estimate uses oldest due date and native contact ties without changing signed account balances', () => {
	const day = '2026-11-06';
	const main = fixtureId('sys_integration', 'kingdee');
	const other = fixtureId('sys_integration', 'kingdee-other');
	const row = (
		contact_id: string | null,
		fields: Partial<Parameters<typeof estimateAging>[0][number]> = {}
	): Parameters<typeof estimateAging>[0][number] => ({
		contact_id,
		order: null,
		order_number: '',
		invoice: null,
		ledger: main,
		ledger_name: 'Primary',
		party: '123',
		party_name: 'Customer',
		reference: contact_id ?? 'Order invoice',
		currency: 'CNY',
		issued_on: '2026-10-01',
		due_on: '2026-11-01',
		settled_on: null,
		settlement: null,
		delivered_on: null,
		as_of: day,
		bucket: '1_30',
		balance: '10',
		unapplied: '0',
		overpaid: '0',
		credit: '0',
		...fields
	});
	const cash = (id: string, amount: number, party = '123') =>
		row(id, { party, balance: '0', unapplied: String(amount), bucket: 'unapplied' });
	const credit = (id: string, amount: number, party = '123') =>
		row(id, { party, balance: '0', credit: String(amount) });
	const raw = [
		row('1', { due_on: null, bucket: 'not_due' }),
		row('10', { balance: '100' }),
		row('2', { balance: '40' }),
		cash('11', 55),
		credit('12', 20),
		row('13', { ledger: other }),
		row('14', { currency: 'USD' }),
		row(null, { party: 'order-only' }),
		row('15', { party: 'refund', balance: '50' }),
		cash('16', -10, 'refund'),
		credit('17', 2, 'refund'),
		row('18', { party: 'advance' }),
		cash('19', 20, 'advance')
	];
	const estimated = estimateAging(raw);
	expect(estimated.map((entry) => entry.estimated_applied?.toString() ?? null)).toEqual([
		'0',
		'35',
		'40',
		null,
		'-20',
		'0',
		'0',
		null,
		'0',
		null,
		'-2',
		'10',
		null
	]);
	expect(estimated.map((entry) => entry.estimated_balance?.toString() ?? null)).toEqual([
		'10',
		'65',
		'0',
		null,
		'0',
		'10',
		'10',
		null,
		'50',
		null,
		'0',
		'0',
		null
	]);
	const [customer] = agingSummary(estimated.slice(0, 5));
	expect(customer).toMatchObject({
		balance: decimalText('150'),
		net: decimalText('75'),
		estimated_balance: decimalText('75'),
		'1_30': decimalText('65'),
		not_due: decimalText('10')
	});
	expect(firstRow(agingSummary(raw.slice(0, 5)))).toMatchObject({
		net: decimalText('75'),
		estimated_balance: null,
		'1_30': decimalText('140')
	});
	expect(firstRow(agingSummary(estimated.slice(8, 11)))).toMatchObject({
		net: decimalText('58'),
		estimated_balance: decimalText('50')
	});
	expect(firstRow(agingSummary(estimated.slice(11)))).toMatchObject({
		net: decimalText('-10'),
		estimated_balance: decimalText('0')
	});
	expect(firstRow(agingSummary(estimated.slice(7, 8))).estimated_balance).toBeNull();
});

test.live('customer aging preserves cutoff, due boundaries and settlement scope', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const own = yield* draft(t);
		yield* confirm(t, own.order);
		const parent = yield* sourceOrder(t, own.order);
		const cutoff = '2026-10-10';
		const addDays = (date: string, days: number) =>
			DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(date), { days }));
		const invoice = yield* sourceTransaction(t, own, parent, 'invoice', '4', {
			reference: 'INV-100',
			total: '100',
			due_on: '2026-09-01'
		});
		yield* sourcePayment(t, parent, invoice.id, '30', 'RECEIPT-30');
		yield* sourcePayment(t, parent, invoice.id, '-5', 'REFUND-5', { settled_on: cutoff });
		yield* sourcePayment(t, parent, null, '20', 'UNALLOCATED-20', { settled_on: cutoff });
		yield* sourcePayment(t, parent, invoice.id, '75', 'FUTURE-75', {
			settled_on: addDays(cutoff, 1),
			source_updated_at: '2026-10-11T00:00:00Z'
		});
		const boundaries = [
			[0, 'not_due'],
			[1, '1_30'],
			[30, '1_30'],
			[31, '31_60'],
			[60, '31_60'],
			[61, '61_90'],
			[90, '61_90'],
			[91, 'over_90'],
			[null, 'not_due']
		] as const;
		for (const [days] of boundaries)
			yield* sourceTransaction(t, own, parent, 'invoice', '4', {
				reference: `DUE-${days ?? 'UNKNOWN'}`,
				total: '1',
				due_on: days === null ? null : addDays(cutoff, -days)
			});
		const purchase = yield* draft(t, 'purchasing');
		yield* confirm(t, purchase.order);
		const payable = yield* sourceOrder(t, purchase.order);
		yield* sourceTransaction(t, purchase, payable, 'invoice', '4', {
			reference: 'SUPPLIER-INVOICE',
			total: '999'
		});

		const finance = yield* t.as(t.member(['finance']));
		const read = (day: string) =>
			finance.query(agingRead(day)).pipe(Effect.map((answer) => agingDetails(answer, day)));
		const earlier = yield* read(addDays(cutoff, -1));
		expect(earlier.find((row) => row.reference === 'INV-100')?.balance).toEqual(decimalText('70'));
		expect(earlier.find((row) => row.reference === 'UNALLOCATED-20')).toBeUndefined();
		const details = yield* read(cutoff);
		expect(details.find((row) => row.reference === 'INV-100')).toMatchObject({
			balance: decimalText('75'),
			as_of: cutoff
		});
		expect(details.find((row) => row.reference === 'UNALLOCATED-20')).toMatchObject({
			unapplied: decimalText('20'),
			balance: decimalText('0')
		});
		expect(details.find((row) => row.reference === 'SUPPLIER-INVOICE')).toBeUndefined();
		for (const [days, bucket] of boundaries)
			expect(details.find((row) => row.reference === `DUE-${days ?? 'UNKNOWN'}`)?.bucket).toBe(
				bucket
			);
		expect(agingSummary(details)).toMatchObject([
			{
				as_of: cutoff,
				currency: 'SGD',
				balance: decimalText('84'),
				unapplied: decimalText('20'),
				net: decimalText('64'),
				'31_60': decimalText('77'),
				not_due: decimalText('2')
			}
		]);
		const later = yield* read(addDays(cutoff, 1));
		expect(later.find((row) => row.reference === 'INV-100')).toBeUndefined();
		const otherCurrency = details.find((row) => row.reference === 'INV-100');
		if (!otherCurrency) throw new Error('Expected the funded invoice');
		expect(
			agingSummary([...details, { ...otherCurrency, currency: 'CNY' }]).map((row) => row.currency)
		).toEqual(['CNY', 'SGD']);
	})
);

test.live(
	'credit exceptions name the customers over limit or overdue, with the invoices behind them',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const own = yield* draft(t);
			yield* confirm(t, own.order);
			const parent = yield* sourceOrder(t, own.order);
			yield* sourceTransaction(t, own, parent, 'invoice', '4', {
				reference: 'LATE-1',
				due_on: '2026-09-01'
			});
			yield* sourceTransaction(t, own, parent, 'invoice', '4', {
				reference: 'CURRENT-1',
				due_on: '2026-10-31'
			});
			yield* businessRows(t, 'credit_snapshots', [
				{
					external_code: 'CR-1',
					party_code: 'C-101',
					currency: 'SGD',
					credit_limit: '100',
					credit_used: '150',
					credit_hold: false,
					as_of: '2026-10-10T00:00:00Z'
				}
			]);
			const as = yield* t.as(t.admin);
			const on = '2026-10-10';
			const { customers, invoices } = creditExceptions(
				(yield* as.query(creditRead)).credit_snapshots.rows,
				agingDetails(yield* as.query(agingRead(on)), on),
				on
			);
			expect(customers).toMatchObject([
				{
					currency: 'SGD',
					credit_available: decimalText('-50.00'),
					over_limit: decimalText('50'),
					overdue: decimalText('21.8'),
					oldest_overdue: 39,
					reasons: ['over_limit', 'overdue']
				}
			]);
			expect(invoices.map((row) => [row.reference, row.days_overdue])).toEqual([['LATE-1', 39]]);
		})
);

test('creditExceptions honors estimated_balance from estimateAging and commission handles case-insensitive units and zero-qty custom rules', () =>
	Effect.gen(function* () {
		const ledger = fixtureId('sys_integration', 'kingdee');
		const raw: Parameters<typeof estimateAging>[0] = [
			{
				contact_id: '10',
				order: null,
				order_number: '',
				invoice: null,
				ledger,
				ledger_name: 'Primary',
				party: '101',
				party_name: 'Paid via Unapplied',
				reference: 'INV-OLD',
				currency: 'CNY',
				issued_on: '2026-08-01',
				due_on: '2026-09-01',
				settled_on: null,
				settlement: null,
				delivered_on: null,
				as_of: '2026-10-10',
				bucket: '31_60',
				balance: '100.00',
				unapplied: '0',
				overpaid: '0',
				credit: '0'
			},
			{
				contact_id: '11',
				order: null,
				order_number: '',
				invoice: null,
				ledger,
				ledger_name: 'Primary',
				party: '101',
				party_name: 'Paid via Unapplied',
				reference: 'RCPT-1',
				currency: 'CNY',
				issued_on: null,
				due_on: null,
				settled_on: '2026-09-15',
				settlement: null,
				delivered_on: null,
				as_of: '2026-10-10',
				bucket: 'unapplied',
				balance: '0',
				unapplied: '100.00',
				overpaid: '0',
				credit: '0'
			}
		];
		const estimated = estimateAging(raw);
		const cleared = creditExceptions([], estimated, '2026-10-10');
		expect(cleared.customers).toEqual([]);
		expect(cleared.invoices).toEqual([]);

		// Commission handles case-insensitive/synonym units ('KG' vs 'kg') and zero-qty price adjustments.
		const orderId = fixtureId('orders', 'comm-1');
		const lineId = fixtureId('order_lines', 'comm-line-1');
		const calc = yield* commissionCalculation(
			{
				id: orderId,
				number: 'TR-2026-9999',
				direction: 'sales',
				status: 'confirmed',
				owner: fixtureId('sys_user', 'seller-1'),
				currency: 'CNY',
				ordered_on: '2026-10-01',
				freight_treatment: 'include',
				commission: {
					rule_id: fixtureId('commission_rules', 'rule-1'),
					currency: 'CNY',
					effective_on: '2026-10-01',
					basis_unit: 't',
					fixed_rate: '0',
					spread_pct: '0',
					eligibility_expression: 'true',
					amount_expression: 'net * 0.05',
					engine_version: 'cel-v1',
					parameters: []
				},
				party: { external_code: '101' },
				lines: [
					{
						id: lineId,
						product: fixtureId('products', 'p1'),
						product_code: 'P1',
						product_name: 'Resin A',
						unit: 'kg',
						quantity: '1000',
						net: '10000',
						floor_net: '8'
					}
				]
			},
			[
				{
					id: fixtureId('source_sales_lines', 'f1'),
					order: orderId,
					order_line: lineId,
					kind: 'shipment',
					unit: 'KG',
					quantity: '0',
					currency: 'CNY',
					net_amount: '2000',
					active: true,
					business_on: '2026-10-05'
				}
			]
		);
		expect(calc.unresolved_lines).toBe(0);
		expect(calc.snapshot.lines[0]).toMatchObject({
			reason: 'resolved',
			spread: null,
			amount: '100.00'
		});
	}));
