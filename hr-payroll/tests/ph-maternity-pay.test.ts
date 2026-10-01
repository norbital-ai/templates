// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateBenefitPay, calculateBenefitPay } from '../src/lib/benefit-cases/pay.ts';
import { MATERNITY } from './fixtures/benefit-cases.ts';

/** The PH maternity case type in PHP; `leave_days` names the event whose compensable days are priced. */
const EVENT = {
	105: { event_kind: 'BIRTH', event_on: '2026-10-05', facts: { solo_parent_claimed: false } },
	60: { event_kind: 'MISCARRIAGE', event_on: '2026-10-05', facts: {} }
};
const premiums = ({ sss, philhealth, pagibig }) => ({ SSS: sss, PHIC: philhealth, HDMF: pagibig });
const calculatePhMaternityPay = ({ leave_days, employee_premiums, actual_sss_award, ...rest }) =>
	calculateBenefitPay({
		case_type: MATERNITY,
		currency: 'PHP',
		benefit_case: EVENT[leave_days],
		employee_premiums: premiums(employee_premiums),
		actual_award: actual_sss_award,
		...rest
	});
const allocatePhMaternityPay = ({ actual_sss_award, cutoffs, ...rest }) =>
	allocateBenefitPay({
		case_type: MATERNITY,
		currency: 'PHP',
		benefit_case: EVENT[105],
		actual_award: actual_sss_award,
		cutoffs: cutoffs.map((cutoff) => ({
			...cutoff,
			employee_premiums: premiums(cutoff.employee_premiums)
		})),
		...rest
	});

test('signed DOLE DA 01-2019 positive example keeps SSS cash, premium shares and differential distinct', () => {
	assert.deepEqual(
		calculatePhMaternityPay({
			monthly_salary: '31300.00',
			leave_days: 105,
			employee_premiums: { sss: '3000.00', philhealth: '1356.31', pagibig: '300.00' },
			actual_sss_award: '70000.00'
		}),
		{
			compensable_days: 105,
			full_pay: 109550,
			employee_premium_shares: 4656.31,
			award: 70000,
			signed_differential: 34893.69,
			employer_differential: 34893.69,
			basic_salary_share: 34893.69,
			employee_cash_entitlement: 104893.69,
			// L5 (docs/capability-plan.md): the result carries the case type's priced phases.
			phases: [
				{
					code: 'MATERNITY',
					index: 1,
					day_index: 0,
					days: 105,
					start: '2026-10-05',
					end: '2027-01-17',
					wage: 109550,
					award: 0,
					employer_pays: 34893.69,
					reimbursable: 0
				}
			]
		}
	);
});

test('signed DOLE negative example does not claw back an SSS benefit or create negative 13th basic', () => {
	const result = calculatePhMaternityPay({
		monthly_salary: '14006.75',
		leave_days: 105,
		employee_premiums: { sss: '2000.00', philhealth: '784.07', pagibig: '200.00' },
		actual_sss_award: '49000.00'
	});
	assert.equal(result.full_pay, 49023.63);
	assert.equal(result.signed_differential, -2960.45);
	assert.equal(result.employer_differential, 0);
	assert.equal(result.basic_salary_share, 0);
	assert.equal(result.employee_cash_entitlement, 49000);
});

test('PH maternity formula refuses guessed or fractional source amounts', () => {
	const valid = {
		monthly_salary: '30000.00',
		leave_days: 60,
		employee_premiums: { sss: '1000.00', philhealth: '750.00', pagibig: '100.00' },
		actual_sss_award: '20000.00'
	};
	for (const [change, refusal] of [
		[{ monthly_salary: '30000.001' }, /Monthly salary needs/],
		[
			{ employee_premiums: { ...valid.employee_premiums, sss: '-1.00' } },
			/Employee SSS share needs/
		],
		[{ actual_sss_award: '0.00' }, /actual positive award/]
	] as const)
		assert.throws(() => calculatePhMaternityPay({ ...valid, ...change }), refusal);
	// The days are the case's: a 104-day span is not the birth's 105 compensable days.
	assert.throws(
		() =>
			allocatePhMaternityPay({
				leave_from: '2026-10-05',
				leave_through: '2027-01-16',
				monthly_salary: '31300.00',
				actual_sss_award: '70000.00',
				cutoffs: [
					{
						period: '2026-10',
						from: '2026-10-05',
						through: '2027-01-16',
						pay_on: '2027-01-31',
						employee_premiums: valid.employee_premiums
					}
				],
				employee_cash: []
			}),
		/case's 105 compensable days/
	);
});

test('PH cutoff ledger applies prior SSS and differential cash once and isolates annual 13th basic', () => {
	const input = {
		leave_from: '2026-10-05',
		leave_through: '2027-01-17',
		monthly_salary: '31300.00',
		actual_sss_award: '70000.00',
		cutoffs: [
			{
				period: '2026-10',
				from: '2026-10-05',
				through: '2026-10-31',
				pay_on: '2026-10-31',
				employee_premiums: { sss: '700.00', philhealth: '400.00', pagibig: '100.00' }
			},
			{
				period: '2026-11',
				from: '2026-11-01',
				through: '2026-11-30',
				pay_on: '2026-11-30',
				employee_premiums: { sss: '700.00', philhealth: '500.00', pagibig: '100.00' }
			},
			{
				period: '2026-12',
				from: '2026-12-01',
				through: '2026-12-31',
				pay_on: '2026-12-31',
				employee_premiums: { sss: '700.00', philhealth: '500.00', pagibig: '100.00' }
			},
			{
				period: '2027-01',
				from: '2027-01-01',
				through: '2027-01-17',
				pay_on: '2027-01-31',
				employee_premiums: { sss: '800.00', philhealth: '56.31', pagibig: '0.00' }
			}
		],
		employee_cash: [
			{ kind: 'SSS_ADVANCE', paid_on: '2026-09-30', amount: '70000.00' },
			{ kind: 'SALARY_DIFFERENTIAL', paid_on: '2026-10-01', amount: '34893.69' }
		]
	};
	const result = allocatePhMaternityPay(input);
	const sum = (field) =>
		Math.round(result.cutoffs.reduce((total, row) => total + row[field], 0) * 100) / 100;
	assert.equal(result.full_pay, 109550);
	assert.equal(result.employer_differential, 34893.69);
	assert.equal(sum('full_pay'), 109550);
	assert.equal(sum('award_share'), 70000);
	assert.equal(sum('employer_differential'), 34893.69);
	assert.equal(sum('prior_cash_applied'), 104893.69);
	assert.equal(sum('payroll_cash_transfer'), 0);
	assert.equal(
		result.cutoffs[0].basic_salary_share_by_year['2026'],
		result.cutoffs[0].employer_differential
	);
	assert.equal(
		result.cutoffs[3].basic_salary_share_by_year['2027'],
		result.cutoffs[3].employer_differential
	);
	const advanceOnly = allocatePhMaternityPay({ ...input, employee_cash: [input.employee_cash[0]] });
	assert.equal(
		Math.round(
			advanceOnly.cutoffs.reduce((total, row) => total + row.payroll_cash_transfer, 0) * 100
		) / 100,
		34893.69
	);
	assert.equal(
		Math.round(
			advanceOnly.cutoffs.reduce((total, row) => total + row.prior_cash_applied, 0) * 100
		) / 100,
		70000
	);
	assert.equal(advanceOnly.cutoffs[0].prior_award_cash_applied, advanceOnly.cutoffs[0].award_share);
	assert.equal(advanceOnly.cutoffs[0].prior_differential_cash_applied, 0);
	assert.equal(
		advanceOnly.cutoffs[0].payroll_cash_transfer,
		advanceOnly.cutoffs[0].employer_differential
	);
});

test('PH cutoff ledger divides a year-crossing differential by covered days', () => {
	const result = allocatePhMaternityPay({
		leave_from: '2026-10-05',
		leave_through: '2027-01-17',
		monthly_salary: '31300.00',
		actual_sss_award: '70000.00',
		cutoffs: [
			{
				period: '2026-11',
				from: '2026-10-05',
				through: '2026-11-30',
				pay_on: '2026-11-30',
				employee_premiums: { sss: '1500.00', philhealth: '700.00', pagibig: '200.00' }
			},
			{
				period: '2027-01',
				from: '2026-12-01',
				through: '2027-01-17',
				pay_on: '2027-01-31',
				employee_premiums: { sss: '1500.00', philhealth: '656.31', pagibig: '100.00' }
			}
		],
		employee_cash: []
	});
	const crossing = result.cutoffs[1];
	assert.ok(crossing.basic_salary_share_by_year['2026'] > 0);
	assert.ok(crossing.basic_salary_share_by_year['2027'] > 0);
	assert.equal(
		Math.round(
			(crossing.basic_salary_share_by_year['2026'] + crossing.basic_salary_share_by_year['2027']) *
				100
		) / 100,
		crossing.employer_differential
	);
});

test('PH cutoff ledger refuses missing days, excess cash and unsupported local differential', () => {
	const base = {
		leave_from: '2026-10-05',
		leave_through: '2027-01-17',
		monthly_salary: '31300.00',
		actual_sss_award: '70000.00',
		cutoffs: [
			{
				period: '2026-10',
				from: '2026-10-05',
				through: '2026-10-31',
				pay_on: '2026-10-31',
				employee_premiums: { sss: '1000.00', philhealth: '500.00', pagibig: '100.00' }
			},
			{
				period: '2027-01',
				from: '2026-11-01',
				through: '2027-01-17',
				pay_on: '2027-01-31',
				employee_premiums: { sss: '2000.00', philhealth: '856.31', pagibig: '200.00' }
			}
		],
		employee_cash: []
	};
	assert.throws(
		() =>
			allocatePhMaternityPay({
				...base,
				cutoffs: [base.cutoffs[0], { ...base.cutoffs[1], from: '2026-11-02' }]
			}),
		/cover consecutive days once/
	);
	assert.throws(
		() =>
			allocatePhMaternityPay({
				...base,
				employee_cash: [{ kind: 'SSS_ADVANCE', paid_on: '2026-09-30', amount: '70000.01' }]
			}),
		/exceeds its component/
	);
	assert.throws(
		() =>
			allocatePhMaternityPay({
				...base,
				cutoffs: [
					{
						...base.cutoffs[0],
						employee_premiums: { sss: '12000.00', philhealth: '500.00', pagibig: '100.00' }
					},
					base.cutoffs[1]
				]
			}),
		/negative local differential/
	);
	assert.throws(
		() =>
			allocatePhMaternityPay({
				...base,
				employee_cash: [{ kind: 'SSS_ADVANCE', paid_on: '2026-11-01', amount: '1000.00' }]
			}),
		/after the first cutoff/
	);
});
