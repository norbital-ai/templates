import assert from 'node:assert/strict';
import { loanRuleFacts } from '../src/lib/loan_values.js';
import { test } from '@effect/vitest';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal, sum } from '@norbital-ai/std/decimal';
import {
	buildLoanSchedule,
	validateLoanRepayments,
	type LoanRepayment,
	type LoanScheduleInput
} from '../src/lib/loan_schedule.ts';

const terms = (overrides: Partial<LoanScheduleInput> = {}): LoanScheduleInput => ({
	principal_amount: Decimal.of('100.00'),
	repayment_period: { from: PlainDate('2026-01-31'), to: PlainDate('2026-04-30') },
	scale: 2,
	semi_monthly_split: 15,
	...overrides
});
const repayment = (
	date: string,
	amount: string,
	extra: Partial<LoanRepayment> = {}
): LoanRepayment => ({
	occurred_on: PlainDate(date),
	amount: Decimal.of(amount),
	...extra
});

test('one paid repayment stays byte-identical while three unpaid dates share the remaining principal', () => {
	const paid = repayment('2026-01-31', '100.00', { id: 'paid', payslip_id: 'slip', sequence: 1 });
	const result = buildLoanSchedule(
		terms({
			principal_amount: Decimal.of('1000.00'),
			repayments: [
				paid,
				repayment('2026-02-28', '1.00', { id: 'feb', activity: 'REVERSAL' }),
				repayment('2026-03-31', '7.00', { id: 'mar' }),
				repayment('2026-04-30', '9.00', { id: 'apr' })
			]
		})
	);
	assert.ok(result.ok);
	assert.strictEqual(result.repayments[0], paid);
	assert.deepEqual(
		result.repayments.map(({ id, occurred_on, amount, activity }) => [
			id,
			occurred_on,
			amount.toString(),
			activity
		]),
		[
			['paid', '2026-01-31', '100.00', undefined],
			[undefined, '2026-02-28', '300.00', 'AWARD'],
			['mar', '2026-03-31', '300.00', 'AWARD'],
			['apr', '2026-04-30', '300.00', 'AWARD']
		]
	);
	const rerun = buildLoanSchedule(
		terms({ principal_amount: Decimal.of('1000.00'), repayments: result.repayments })
	);
	assert.deepEqual(rerun, result);
});

test('monthly cadence preserves the original day and month-end anchoring when dates must be generated', () => {
	for (const [from, to, expected] of [
		['2026-01-31', '2026-04-30', ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']],
		['2026-01-30', '2026-04-30', ['2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30']],
		['2028-02-29', '2028-05-31', ['2028-02-29', '2028-03-31', '2028-04-30', '2028-05-31']],
		['9999-12-31', '9999-12-31', ['9999-12-31']]
	] as const) {
		const result = buildLoanSchedule(
			terms({ repayment_period: { from: PlainDate(from), to: PlainDate(to) } })
		);
		assert.ok(result.ok);
		assert.deepEqual(
			result.repayments.map(({ occurred_on }) => occurred_on),
			expected
		);
	}
});

test('semi-monthly cadence uses the 15th and month end inside the period and distributes exact cents evenly', () => {
	const result = buildLoanSchedule(
		terms({
			repayment_frequency: 'SEMI_MONTHLY',
			repayment_period: { from: PlainDate('2026-01-20'), to: PlainDate('2026-03-01') }
		})
	);
	assert.ok(result.ok);
	assert.deepEqual(
		result.repayments.map(({ occurred_on, amount }) => [occurred_on, amount.toString()]),
		[
			['2026-01-31', '33.33'],
			['2026-02-15', '33.33'],
			['2026-02-28', '33.34']
		]
	);
	assert.equal(sum(result.repayments.map(({ amount }) => amount)).toString(), '100.00');
	const six = buildLoanSchedule(
		terms({
			principal_amount: Decimal.of('800.00'),
			repayment_period: { from: PlainDate('2026-01-01'), to: PlainDate('2026-06-30') }
		})
	);
	assert.ok(six.ok);
	assert.deepEqual(
		six.repayments.map(({ amount }) => amount.toString()),
		['133.33', '133.33', '133.33', '133.33', '133.34', '133.34']
	);
});

test('valid unpaid dates survive and unusable dates regenerate without duplicating a paid date', () => {
	const retained = buildLoanSchedule(
		terms({
			repayments: [
				repayment('2026-02-10', '1.00', { id: 'keep' }),
				repayment('2025-12-31', '1.00', { id: 'drop' })
			]
		})
	);
	assert.ok(retained.ok);
	assert.deepEqual(
		retained.repayments.map(({ id, occurred_on, amount }) => [id, occurred_on, amount.toString()]),
		[['keep', '2026-02-10', '100.00']]
	);
	const paid = repayment('2026-01-31', '25.00', { payslip_id: 'slip' });
	const regenerated = buildLoanSchedule(
		terms({ repayments: [paid, repayment('2025-12-31', '1.00')] })
	);
	assert.ok(regenerated.ok);
	assert.strictEqual(regenerated.repayments[0], paid);
	assert.deepEqual(
		regenerated.repayments.map(({ occurred_on, amount }) => [occurred_on, amount.toString()]),
		[
			['2026-01-31', '25.00'],
			['2026-02-28', '25.00'],
			['2026-03-31', '25.00'],
			['2026-04-30', '25.00']
		]
	);
});

test('zero remaining principal removes unpaid rows; excess paid principal and excluding paid dates refuse', () => {
	const paid = repayment('2026-01-31', '100.00', { payslip_id: 'slip' });
	assert.deepEqual(
		buildLoanSchedule(terms({ repayments: [paid, repayment('2026-02-28', '5.00')] })),
		{ ok: true, repayments: [paid] }
	);
	assert.deepEqual(
		buildLoanSchedule(terms({ principal_amount: Decimal.of('99.99'), repayments: [paid] })),
		{ ok: false, message: 'Paid repayments exceed the principal amount.' }
	);
	assert.deepEqual(
		buildLoanSchedule(
			terms({
				repayment_period: { from: PlainDate('2026-02-01'), to: PlainDate('2026-04-30') },
				repayments: [paid]
			})
		),
		{ ok: false, message: 'The repayment period cannot exclude a paid repayment.' }
	);
});

test('validation preserves genuine reversals and requires their signed total to equal principal', () => {
	const rows = [
		repayment('2026-01-31', '120.00'),
		repayment('2026-02-28', '20.00', { activity: 'REVERSAL' })
	];
	const valid = validateLoanRepayments(terms({ repayments: rows }));
	assert.ok(valid.ok);
	assert.strictEqual(valid.repayments, rows);
	assert.equal(
		validateLoanRepayments(terms({ repayments: [repayment('2026-01-31', '99.99')] })).ok,
		false
	);
	assert.equal(
		validateLoanRepayments(terms({ repayments: [repayment('2026-01-31', '0')] })).ok,
		false
	);
	assert.equal(
		validateLoanRepayments(terms({ repayments: [repayment('2025-12-31', '100')] })).ok,
		false
	);
	const paidAward = repayment('2026-01-31', '80.00', { payslip_id: 'slip-a' });
	const paidReversal = repayment('2026-02-28', '20.00', {
		payslip_id: 'slip-r',
		activity: 'REVERSAL'
	});
	const recalc = buildLoanSchedule(terms({ repayments: [paidAward, paidReversal] }));
	assert.ok(recalc.ok);
	assert.strictEqual(recalc.repayments[1], paidReversal);
	assert.deepEqual(
		recalc.repayments.map(({ amount }) => amount.toString()),
		['80.00', '20.00', '20.00', '20.00']
	);
});

test('invalid periods, fractional cents, impossible positive repayments and excessive schedules refuse', () => {
	for (const repayment_period of [
		{ from: PlainDate('2026-01-31'), to: null },
		{ from: PlainDate('2026-01-31'), to: PlainDate('2026-01-01') }
	]) {
		assert.equal(buildLoanSchedule(terms({ repayment_period })).ok, false);
		assert.equal(validateLoanRepayments(terms({ repayment_period })).ok, false);
	}
	for (const amount of ['0', '-1', '0.001', '1.999']) {
		assert.equal(buildLoanSchedule(terms({ principal_amount: Decimal.of(amount) })).ok, false);
		assert.equal(
			validateLoanRepayments(terms({ repayments: [repayment('2026-01-31', amount)] })).ok,
			false
		);
	}
	assert.equal(buildLoanSchedule(terms({ principal_amount: Decimal.of('0.01') })).ok, false);
	assert.equal(
		buildLoanSchedule(
			terms({
				repayment_frequency: 'SEMI_MONTHLY',
				repayment_period: { from: PlainDate('2026-01-20'), to: PlainDate('2026-01-25') }
			})
		).ok,
		false
	);
	assert.equal(
		buildLoanSchedule(
			terms({ repayment_period: { from: PlainDate('2026-01-01'), to: PlainDate('2076-01-01') } })
		).ok,
		false
	);
});

test('loan rules receive the principal, the advance date and the loan’s own facts', () => {
	assert.deepEqual(
		loanRuleFacts({
			principal_amount: Decimal.of('1000'),
			facts: { advance_purpose: 'MEDICAL_TREATMENT' }
		}),
		{
			principal: 1000,
			advance_purpose: 'MEDICAL_TREATMENT'
		}
	);
	assert.deepEqual(
		loanRuleFacts({
			facts: { written_agreement_reference: 'AGREEMENT-1' },
			advance_made_on: '2026-01-01'
		}),
		{
			written_agreement_reference: 'AGREEMENT-1',
			advance_made_on: '2026-01-01'
		}
	);
	assert.deepEqual(loanRuleFacts({}), {});
});

test('M19: the version’s money scale and semi-monthly split decide the schedule', () => {
	// A zero-decimal currency spreads whole units; the split day moves the first instalment.
	const result = buildLoanSchedule(
		terms({
			principal_amount: Decimal.of('100'),
			repayment_frequency: 'SEMI_MONTHLY',
			repayment_period: { from: PlainDate('2026-01-01'), to: PlainDate('2026-02-28') },
			scale: 0,
			semi_monthly_split: 10
		})
	);
	assert.ok(result.ok);
	assert.deepEqual(
		result.repayments.map(({ occurred_on, amount }) => [occurred_on, amount.toString()]),
		[
			['2026-01-10', '25'],
			['2026-01-31', '25'],
			['2026-02-10', '25'],
			['2026-02-28', '25']
		]
	);
	const uneven = buildLoanSchedule(
		terms({
			principal_amount: Decimal.of('100'),
			repayment_period: { from: PlainDate('2026-01-31'), to: PlainDate('2026-03-31') },
			scale: 0
		})
	);
	assert.ok(uneven.ok);
	assert.deepEqual(
		uneven.repayments.map(({ amount }) => amount.toString()),
		['33', '33', '34']
	);
	assert.equal(
		buildLoanSchedule(terms({ principal_amount: Decimal.of('100.5'), scale: 0 })).ok,
		false
	);
});
