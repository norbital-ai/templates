import { decimalText, firstRow, fixtureId } from './test-runtime.js';
import { addDays, PlainDate } from '@norbital-ai/std/date';
import { Decimal, currency } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { sourceOrder, sourceTransaction, sourcePayment } from './synced-kit.js';
import { expect, it as test } from '@effect/vitest';
import { committed, workspace, draft, confirm } from './kit.js';
import { agingOf } from './reads.js';
import { agingDetails, agingRead, agingSummary, estimateAging } from '../src/lib/reports.js';
test.live(
	'AR separates applied payments, unapplied deposits, overdue buckets and overpayments',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const { order, line } = yield* draft(t);
			yield* confirm(t, order);
			const as = t.as(t.admin);
			const parent = yield* sourceOrder(t, order);
			const invoice = yield* sourceTransaction(t, { order, line }, parent);
			yield* sourcePayment(t, parent, invoice.id, '5');
			yield* sourcePayment(t, parent, null, '3');
			expect(yield* agingOf(as, { as_of: PlainDate('2026-10-10') })).toMatchObject([
				{ balance: decimalText('16.80'), bucket: '61_90', overpaid: decimalText('0') }
			]);
			yield* sourcePayment(t, parent, invoice.id, '20');
			committed(
				'orders',
				yield* as.act('orders.update', [{ target: order, set: { archived: true } }])
			);
			expect(yield* agingOf(as, { as_of: PlainDate('2026-10-10') })).toMatchObject([
				{ balance: decimalText('0'), overpaid: decimalText('3.20') }
			]);
		})
);

test('the account estimate uses oldest due date and native contact ties without changing signed account balances', () => {
	const day = PlainDate('2026-11-06');
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
		currency: currency('CNY'),
		issued_on: PlainDate('2026-10-01'),
		due_on: PlainDate('2026-11-01'),
		settled_on: null,
		as_of: day,
		bucket: '1_30',
		balance: Decimal.of(10),
		unapplied: Decimal.of(0),
		overpaid: Decimal.of(0),
		credit: Decimal.of(0),
		...fields
	});
	const cash = (id: string, amount: number, party = '123') =>
		row(id, { party, balance: Decimal.of(0), unapplied: Decimal.of(amount), bucket: 'unapplied' });
	const credit = (id: string, amount: number, party = '123') =>
		row(id, { party, balance: Decimal.of(0), credit: Decimal.of(amount) });
	const raw = [
		row('1', { due_on: null, bucket: 'no_due_date' }),
		row('10', { balance: Decimal.of(100) }),
		row('2', { balance: Decimal.of(40) }),
		cash('11', 55),
		credit('12', 20),
		row('13', { ledger: other }),
		row('14', { currency: currency('USD') }),
		row(null, { party: 'order-only' }),
		row('15', { party: 'refund', balance: Decimal.of(50) }),
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
		no_due_date: decimalText('10')
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
		const cutoff = PlainDate('2026-10-10');
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
			[null, 'no_due_date']
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

		const finance = t.as(t.member(['finance']));
		const read = (day: PlainDate) =>
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
				no_due_date: decimalText('1')
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
