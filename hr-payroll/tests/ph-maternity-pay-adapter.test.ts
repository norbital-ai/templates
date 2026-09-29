// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { daysBetween } from '../src/lib/payroll/run/dates.ts';
import {
	maternityCashConflictsWithPayroll,
	unallocatedPhMaternityLeave
} from '../src/lib/ph/maternity-payroll-guard.ts';
import { planPhMaternityPayslips } from '../src/lib/ph/maternity-pay-adapter.ts';

const caseRow = {
	id: 'case-1',
	employment_id: 'employment-1',
	application_on: '2026-09-01',
	event_kind: 'BIRTH',
	event_on: '2026-10-05',
	solo_parent_claimed: false,
	leave_from: '2026-10-05',
	leave_through: '2027-01-17',
	sss_award_amount: '70000.00',
	sss_awarded_on: '2026-10-20',
	sss_award_reference: 'SSS-AWARD-001',
	sss_award_file: { path: 'sss-award.pdf' }
};
const spans = [
	['2026-10-05', '2026-10-31'],
	['2026-11-01', '2026-11-30'],
	['2026-12-01', '2026-12-31'],
	['2027-01-01', '2027-01-17']
];
const entries = spans.map(([from, through], index) => ({
	id: `leave-${index}`,
	employment_id: 'employment-1',
	leave_code: 'MATERNITY_LEAVE',
	approval_id: null,
	event_kind: 'BIRTH',
	event_date: '2026-10-05',
	charges: daysBetween(from, through).map((date) => ({ date, days: 1 }))
}));
const cutoffs = spans.map(([start, end], index) => ({
	period: [`2026-10`, `2026-11`, `2026-12`, `2027-01`][index],
	salary: { start, end },
	pay_on: [`2026-10-31`, `2026-11-30`, `2026-12-31`, `2027-01-31`][index],
	leave_entry_ids: [`leave-${index}`],
	employee_premiums: [
		{ sss: '700.00', philhealth: '400.00', pagibig: '100.00' },
		{ sss: '700.00', philhealth: '500.00', pagibig: '100.00' },
		{ sss: '700.00', philhealth: '500.00', pagibig: '100.00' },
		{ sss: '800.00', philhealth: '56.31', pagibig: '0.00' }
	][index],
	premium_evidence_reference: `ASSESSED-STATUTORY-${index}`
}));
const movements = [
	{
		ph_maternity_case_id: 'case-1',
		kind: 'SSS_ADVANCE',
		paid_on: '2026-09-30',
		amount: '70000.00'
	},
	{
		ph_maternity_case_id: 'case-1',
		kind: 'SALARY_DIFFERENTIAL',
		paid_on: '2026-10-01',
		amount: '34893.69'
	},
	{
		ph_maternity_case_id: 'case-1',
		kind: 'SSS_REIMBURSEMENT',
		paid_on: '2026-12-01',
		amount: '70000.00'
	}
];
const evidence = {
	monthly_salary: '31300.00',
	monthly_salary_reference: 'CONTRACT-MONTHLY-001',
	full_span_wage_period: {
		period: { from: '2026-10-05', to: '2027-01-17' },
		currency: 'PHP',
		normal_wages: '109550.00',
		reference: 'NORMAL-WAGES-105D-001'
	}
};
const saved = {
	maternity_case: caseRow,
	entries,
	payslips: [],
	movements,
	as_of: '2027-01-31',
	wage_basis: evidence,
	cutoffs
};

test('PH saved case adapter proposes four immutable cutoff allocations while payroll still refuses cash-funded BASIC', () => {
	const result = planPhMaternityPayslips(saved);
	assert.equal(result.status, 'PROPOSED_NOT_SAVED');
	assert.equal(result.case_id, 'case-1');
	assert.equal(result.cutoffs.length, 4);
	assert.ok(Object.isFrozen(result.cutoffs));
	assert.ok(result.cutoffs.every((row) => Object.isFrozen(row)));
	assert.equal(
		Math.round(result.cutoffs.reduce((sum, row) => sum + row.prior_cash_applied, 0) * 100) / 100,
		104893.69
	);
	assert.equal(
		result.cutoffs.reduce((sum, row) => sum + row.payroll_cash_transfer, 0),
		0
	);
	assert.equal(
		Math.round(result.cutoffs.reduce((sum, row) => sum + row.employer_differential, 0) * 100) / 100,
		34893.69
	);
	assert.equal(
		maternityCashConflictsWithPayroll({
			entries,
			cases: [caseRow],
			movements,
			paying: [
				{ employment_id: 'employment-1', salary: { start: '2026-10-01', end: '2026-10-31' } }
			]
		}),
		true
	);
	assert.equal(
		unallocatedPhMaternityLeave({
			entries,
			paying: [
				{ employment_id: 'employment-1', salary: { start: '2026-10-01', end: '2026-10-31' } }
			]
		}),
		true
	);
});

test('PH saved case adapter refuses unsupported wage evidence, paid overlap and partial cutoff capture', () => {
	assert.throws(
		() =>
			planPhMaternityPayslips({
				...saved,
				wage_basis: {
					...evidence,
					full_span_wage_period: { ...evidence.full_span_wage_period, normal_wages: '109549.99' }
				}
			}),
		/disagree with the DOLE monthly-salary formula/
	);
	assert.throws(
		() =>
			planPhMaternityPayslips({
				...saved,
				payslips: [
					{
						id: 'paid-1',
						employment_id: 'employment-1',
						paid_at: '2026-10-31T00:00:00.000Z',
						salary_window: { start: '2026-10-01', end: '2026-10-31' }
					}
				]
			}),
		/Prior paid salary overlaps maternity leave/
	);
	assert.throws(
		() =>
			planPhMaternityPayslips({
				...saved,
				cutoffs: [cutoffs[0], { ...cutoffs[1], leave_entry_ids: ['leave-0'] }, ...cutoffs.slice(2)]
			}),
		/one cutoff/
	);
	assert.throws(
		() =>
			planPhMaternityPayslips({
				...saved,
				cutoffs: [{ ...cutoffs[0], premium_evidence_reference: '' }, ...cutoffs.slice(1)]
			}),
		/premium evidence/
	);
	assert.throws(
		() => planPhMaternityPayslips({ ...saved, as_of: '2026-10-19' }),
		/current actual SSS award/
	);
	assert.throws(
		() =>
			planPhMaternityPayslips({
				...saved,
				entries: [{ ...entries[0], payslip_id: 'missing-paid-slip' }, ...entries.slice(1)]
			}),
		/existing maternity payslip/
	);
	assert.throws(
		() =>
			planPhMaternityPayslips({
				...saved,
				entries: [...entries, { ...entries[0], id: 'other-event', event_date: '2026-10-06' }]
			}),
		/Every maternity charge in the case span/
	);
	assert.throws(
		() => planPhMaternityPayslips({ ...saved, movements: [movements[0], movements[2]] }),
		/full SSS advance and salary differential/
	);
	assert.throws(
		() =>
			planPhMaternityPayslips({
				...saved,
				movements: [{ ...movements[0], paid_on: '2026-10-02' }, movements[1], movements[2]]
			}),
		/full SSS advance and salary differential/
	);
});
