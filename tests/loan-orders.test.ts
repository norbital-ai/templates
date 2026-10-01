// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * L6 — third-party deduction orders: a stored `recovery_rule` over what net pay the payslip leaves.
 *
 * Hand-computed goldens, jurisdiction-free. One payslip: gross 3000.00, employee statutory 300.00, so
 * net before orders is 2700.00.
 *
 * - Order A (priority 0, principal 1000.00, nothing recovered): rule
 *   `min(0.2 * payment.net, max(0.0, payment.net - 2200.0))` = min(540.00, 500.00) = 500.00 — the
 *   stored 2200.00 floor binds before the stored 20% cap. Net left 2200.00.
 * - Order B (priority 1, principal 5000.00, 4900.00 already on a payslip): rule `0.5 * payment.net`
 *   = 1100.00, capped at its balance 100.00. Net left 2100.00.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	loanCaptures,
	orderBalance,
	settleWithOrders,
	thirdPartyWithheld
} from '../src/lib/payroll/loan.ts';
import { repaymentProgress } from '../src/lib/loan-schedule.ts';

const component = (code: string) => ({
	id: `component-${code}`,
	code,
	family: 'LOAN',
	destination: 'NET',
	direction: 'SUBTRACT',
	eligibility: ''
});
const base = (amount: number) => ({
	catalogueComponent: { id: 'component-BASE', code: 'BASE', family: 'EARNING' },
	bucket: 'EARNING',
	label: 'BASE',
	amount,
	entry: { component_code: 'BASE', amount }
});
const orderLine = (loanId: string, code = 'ORDER') => ({
	input: { family: 'LOAN_REPAYMENT', id: loanId },
	catalogueComponent: component(code),
	bucket: 'DEDUCTION',
	label: code,
	amount: 0,
	quantity: null,
	rate: null,
	statutoryRuleKey: null
});
const order = (id: string, fields: object) => ({
	id,
	employment_id: 'employment-1',
	principal: 1000,
	effective_from: '2026-01-01',
	creditor: 'THIRD_PARTY',
	authority: 'Court order 1',
	priority: 0,
	on_exit: 'RULE',
	...fields
});
const bundle = (loans: object[], loanRepayments: object[] = []) => ({
	employment: { id: 'employment-1', employee_number: 'E-1' },
	window: { salary: { start: '2026-03-01', end: '2026-03-31' } },
	loans,
	loanRepayments
});
const charges = [{ employee: 300, employer: 0 }];

const A = order('loan-a', {
	recovery_rule: 'min(0.2 * payment.net, max(0.0, payment.net - 2200.0))'
});
const B = order('loan-b', { principal: 5000, priority: 1, recovery_rule: '0.5 * payment.net' });
const B_PAID = {
	id: 'rep-b1',
	loan_id: 'loan-b',
	payslip_id: 'slip-old',
	amount_due: 4900,
	due_date: '2026-02-28',
	sequence: 1
};

test('orderBalance is principal less repayments a payslip holds; an unlinked row is not recovered', () => {
	assert.equal(orderBalance(B, [B_PAID]), 100);
	assert.equal(orderBalance(B, [{ ...B_PAID, payslip_id: null }]), 5000);
	assert.equal(orderBalance(B, [{ ...B_PAID, amount_due: 6000 }]), 0);
});

test('orders withhold by priority from the net each leaves: floor binds A at 500.00, balance caps B at 100.00', () => {
	const { settlement, issues } = settleWithOrders({
		base: [base(3000)],
		adjustments: [orderLine('loan-b'), orderLine('loan-a')],
		charges,
		currency: 'USD',
		bundle: bundle([A, B], [B_PAID]),
		configuration: {}
	});
	const taken = Object.fromEntries(settlement.adjustments.map((row) => [row.input.id, row.amount]));
	assert.deepEqual(taken, { 'loan-a': 500, 'loan-b': 100 });
	assert.equal(settlement.net, 2100);
	assert.deepEqual(issues, []);
});

test('an order amount is floored to the minor unit, never rounded up', () => {
	// net 2699.99 × 0.2 = 539.998 → 539.99.
	const { settlement } = settleWithOrders({
		base: [base(2999.99)],
		adjustments: [orderLine('loan-a')],
		charges,
		currency: 'USD',
		bundle: bundle([order('loan-a', { recovery_rule: '0.2 * payment.net' })]),
		configuration: {}
	});
	assert.equal(settlement.adjustments[0].amount, 539.99);
	assert.equal(settlement.net, 2160);
});

test('on_exit BALANCE takes the whole balance on the final payslip, bounded by net; the rest is reported', () => {
	const run = (gross: number) =>
		settleWithOrders({
			base: [base(gross)],
			adjustments: [orderLine('loan-a')],
			charges,
			currency: 'USD',
			finalPay: true,
			bundle: bundle([{ ...A, on_exit: 'BALANCE' }]),
			configuration: {}
		});
	// Net 2700.00 carries the whole 1000.00 balance.
	const whole = run(3000);
	assert.equal(whole.settlement.adjustments[0].amount, 1000);
	assert.deepEqual(whole.issues, []);
	// Net 800.00 (1100.00 − 300.00) carries 800.00; 200.00 stays owed and is said once.
	const short = run(1100);
	assert.equal(short.settlement.adjustments[0].amount, 800);
	assert.equal(short.settlement.net, 0);
	assert.equal(short.issues.length, 1);
	assert.equal(short.issues[0].code, 'ORDER_OUTSTANDING_AT_EXIT');
	assert.match(short.issues[0].message, /owing 200/);
});

test('a payslip with no order is plain settle', () => {
	const { settlement, issues } = settleWithOrders({
		base: [base(3000)],
		adjustments: [],
		charges,
		currency: 'USD',
		bundle: bundle([A]),
		configuration: {}
	});
	assert.equal(settlement.net, 2700);
	assert.deepEqual(issues, []);
});

test('loanCaptures links schedules, reuses an identical released row, creates the next sequence, lists stale rows', () => {
	const scheduled = { id: 'loan-s', recovery_rule: null };
	const repayments = [
		{
			id: 'rep-s1',
			loan_id: 'loan-s',
			payslip_id: null,
			amount_due: 50,
			due_date: '2026-03-15',
			sequence: 1
		},
		// A released draft withheld exactly this period's 500.00 under A: reused, not duplicated.
		{
			id: 'rep-a1',
			loan_id: 'loan-a',
			payslip_id: null,
			amount_due: 500,
			due_date: '2026-03-31',
			sequence: 1
		},
		// A released draft under A with another amount: no payslip holds it.
		{
			id: 'rep-a0',
			loan_id: 'loan-a',
			payslip_id: null,
			amount_due: 480,
			due_date: '2026-03-31',
			sequence: 2
		},
		B_PAID
	];
	const adjustments = [
		{
			input: { family: 'LOAN_REPAYMENT', id: 'rep-s1' },
			amount: 50,
			catalogueComponent: component('STAFF')
		},
		{
			input: { family: 'LOAN_REPAYMENT', id: 'loan-a' },
			amount: 500,
			catalogueComponent: component('ORDER')
		},
		{
			input: { family: 'LOAN_REPAYMENT', id: 'loan-b' },
			amount: 100,
			catalogueComponent: component('ORDER')
		}
	];
	const captures = loanCaptures({
		bundle: bundle([scheduled, A, B], repayments),
		settlement: { adjustments },
		captured: ['rep-s1', 'loan-a', 'loan-b']
	});
	assert.deepEqual(captures.link, ['rep-s1', 'rep-a1']);
	assert.deepEqual(captures.create, [
		{
			loan_id: 'loan-b',
			employment_id: 'employment-1',
			due_date: '2026-03-31',
			amount_due: 100,
			sequence: 2
		}
	]);
	assert.deepEqual(captures.stale, ['rep-a0']);
	// What the remittance duty owes each creditor code: third-party orders only.
	assert.deepEqual(
		thirdPartyWithheld([{ ...scheduled, creditor: 'EMPLOYER' }, A, B], repayments, adjustments),
		{ ORDER: 600 }
	);
});

test("an order's progress is against its principal, not the sum of what was withheld", () => {
	// Two paid withholdings of 500.00 + 100.00 under a 1000.00 order: 400.00 outstanding, not settled.
	const rows = [{ amount_due: 500 }, { amount_due: 100 }];
	const p = repaymentProgress(rows, 600, 1000);
	assert.equal(p.outstandingAmount, 400);
	assert.equal(p.settled, false);
	// Without the principal the rows read as a plan that is fully recovered.
	assert.equal(repaymentProgress(rows, 600).settled, true);
});
