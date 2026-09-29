// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import cases from '../src/data/collection/ph_maternity_cases/+collection.ts';
import cutoffs from '../src/data/collection/ph_maternity_pay_cutoffs/+collection.ts';
import plans from '../src/data/collection/ph_maternity_pay_plans/+collection.ts';
import monthsCollection from '../src/data/collection/sss_contribution_months/+collection.ts';
import movements from '../src/data/collection/ph_maternity_movements/+collection.ts';
import { caller, query, transform } from './helpers/bodies.ts';

const caseRow = {
	id: 'case-1',
	employee_id: 'mother',
	employment_id: 'employment-1',
	case_reference: 'MBA-2026-1',
	application_on: '2026-09-01',
	expected_delivery_on: '2026-10-05',
	leave_from: '2026-10-05',
	leave_through: '2027-01-17'
};
const months = Array.from({ length: 12 }, (_, index) => {
	const day = new Date(Date.UTC(2025, 6 + index, 1)).toISOString().slice(0, 7);
	return {
		id: `sss-${day}`,
		employee_id: 'mother',
		coverage_month: day,
		regular_msc: '20000.00',
		paid_on: '2026-06-30',
		source_reference: `SSS-STATEMENT-${day}`,
		evidence_file: { path: `sss-statement-${day}.pdf` }
	};
});
const planInput = {
	ph_maternity_case_id: 'case-1',
	basis_method: 'DOCUMENTED_MONTHLY_EQUIVALENT',
	monthly_full_pay_basis: '31300.00',
	qualifying_allowances_assessed: true,
	basis_reference: 'SIGNED-FULL-PAY-BASIS-1',
	basis_file: { path: 'wage-basis.pdf' }
};

test('prebirth PH plan freezes twelve paid SSS months and reports overdue or actual-award true-up', async () => {
	const [created] = await transform(plans, [planInput], {
		now: '2026-09-20T00:00:00.000Z',
		tables: { ph_maternity_cases: [caseRow], sss_contribution_months: months }
	});
	assert.equal(created.contingency_basis_kind, 'EXPECTED_BIRTH');
	assert.equal(created.candidate_sss_amount, 70000);
	assert.equal(created.advance_due_on, '2026-10-01');
	assert.equal(JSON.parse(created.sss_history_snapshot).length, 12);
	const plan = { id: 'plan-1', ...created };
	const overdue = await query(
		plans,
		'advance_status',
		{ plan_id: 'plan-1', as_of: '2026-10-02' },
		caller({
			tables: {
				ph_maternity_pay_plans: [plan],
				ph_maternity_cases: [caseRow],
				sss_contribution_months: months
			}
		})
	);
	assert.equal(overdue.status, 'OVERDUE_OR_SHORT_CANDIDATE_ADVANCE');
	const bareEntry = await query(
		plans,
		'advance_status',
		{ plan_id: 'plan-1', as_of: '2026-10-02' },
		caller({
			tables: {
				ph_maternity_pay_plans: [plan],
				ph_maternity_cases: [caseRow],
				sss_contribution_months: months,
				ph_maternity_movements: [
					{
						ph_maternity_case_id: 'case-1',
						kind: 'SSS_ADVANCE',
						paid_on: '2026-09-30',
						amount: '70000.00'
					}
				]
			}
		})
	);
	assert.equal(bareEntry.status, 'OVERDUE_OR_SHORT_CANDIDATE_ADVANCE');
	assert.equal(bareEntry.unproved_or_unlinked_recorded_cash, 70000);
	const awarded = {
		...caseRow,
		event_kind: 'BIRTH',
		event_on: '2026-10-05',
		solo_parent_claimed: false,
		sss_award_amount: '71000.00'
	};
	const paid = await query(
		plans,
		'advance_status',
		{ plan_id: 'plan-1', as_of: '2026-10-25' },
		caller({
			tables: {
				ph_maternity_pay_plans: [plan],
				ph_maternity_cases: [awarded],
				sss_contribution_months: months,
				ph_maternity_movements: [
					{
						ph_maternity_case_id: 'case-1',
						ph_maternity_pay_plan_id: 'plan-1',
						kind: 'SSS_ADVANCE',
						paid_on: '2026-09-30',
						amount: '70000.00',
						evidence_file: { path: 'bank-credit.pdf' }
					}
				]
			}
		})
	);
	assert.equal(paid.status, 'CANDIDATE_ADVANCE_RECORDED_WITH_DOCUMENT_BY_DUE_DATE');
	assert.equal(paid.actual_award_minus_advance, 1000);
	assert.equal(
		paid.actual_award_status,
		'ADDITIONAL_ADVANCE_AND_DIFFERENTIAL_RECALCULATION_REQUIRED'
	);
});

test('PH plan refuses incomplete SSS history and freezes referenced source months and application facts', async () => {
	await assert.rejects(
		transform(plans, [planInput], {
			now: '2026-09-20T00:00:00.000Z',
			tables: {
				ph_maternity_cases: [caseRow],
				sss_contribution_months: [{ ...months[0], evidence_file: null }, ...months.slice(1)]
			}
		}),
		/attached contribution statement/
	);
	await assert.rejects(
		transform(plans, [planInput], {
			now: '2026-09-20T00:00:00.000Z',
			tables: { ph_maternity_cases: [caseRow], sss_contribution_months: months.slice(1) }
		}),
		/all twelve SSS contribution months/
	);
	const [created] = await transform(plans, [planInput], {
		now: '2026-09-20T00:00:00.000Z',
		tables: { ph_maternity_cases: [caseRow], sss_contribution_months: months }
	});
	const first = { id: 'plan-1', ...created };
	const [revision] = await transform(
		plans,
		[{ ...planInput, basis_reference: 'CORRECTED-WAGE-BASIS-2' }],
		{
			now: '2026-09-20T00:00:00.000Z',
			tables: {
				ph_maternity_cases: [caseRow],
				sss_contribution_months: months,
				ph_maternity_pay_plans: [first]
			}
		}
	);
	assert.equal(revision.plan_number, 2);
	assert.equal(revision.supersedes_plan_id, 'plan-1');
	await assert.rejects(
		query(
			plans,
			'advance_status',
			{ plan_id: 'plan-1', as_of: '2026-09-20' },
			caller({
				tables: {
					ph_maternity_cases: [caseRow],
					ph_maternity_pay_plans: [first, { id: 'plan-2', ...revision }],
					sss_contribution_months: months
				}
			})
		),
		/superseded before cash/
	);
	const tables = {
		ph_maternity_cases: [caseRow],
		ph_maternity_pay_plans: [first, { id: 'plan-2', ...revision }],
		ph_maternity_movements: [
			{ ph_maternity_case_id: 'case-1', ph_maternity_pay_plan_id: 'plan-2', kind: 'SSS_ADVANCE' }
		]
	};
	await assert.rejects(
		transform(plans, [{ ...planInput, basis_reference: 'TOO-LATE' }], {
			now: '2026-09-20T00:00:00.000Z',
			tables: { ...tables, sss_contribution_months: months }
		}),
		/cannot be created or superseded after employee cash/
	);
	await assert.rejects(
		transform(monthsCollection, [{ regular_msc: '19000.00' }], { existing: [months[0]], tables }),
		/used by a frozen PH maternity advance plan cannot change/
	);
	await assert.rejects(
		transform(cases, [{ expected_delivery_on: '2026-10-06' }], {
			existing: [caseRow],
			tables: {
				...tables,
				employments: [{ id: 'employment-1', employee_id: 'mother', company_id: 'company-1' }],
				companies: [{ id: 'company-1', settings_code: 'PH' }]
			}
		}),
		/funded maternity expected contingency cannot change/
	);
});

test('PH cash cannot pin an active candidate after its sourced SSS months changed', async () => {
	const [created] = await transform(plans, [planInput], {
		now: '2026-09-20T00:00:00.000Z',
		tables: { ph_maternity_cases: [caseRow], sss_contribution_months: months }
	});
	const cash = {
		ph_maternity_case_id: 'case-1',
		kind: 'SSS_ADVANCE',
		paid_on: '2026-09-30',
		amount: '70000.00',
		payment_reference: 'BANK-CREDIT-1',
		evidence_file: { path: 'bank-credit.pdf' }
	};
	const tables = {
		ph_maternity_cases: [caseRow],
		ph_maternity_pay_plans: [{ id: 'plan-1', ...created }],
		sss_contribution_months: months
	};
	const [pinned] = await transform(movements, [cash], { tables });
	assert.equal(pinned.ph_maternity_pay_plan_id, 'plan-1');
	const staleMonths = [{ ...months[0], regular_msc: '19000.00' }, ...months.slice(1)];
	await assert.rejects(
		query(
			plans,
			'advance_status',
			{ plan_id: 'plan-1', as_of: '2026-09-30' },
			caller({ tables: { ...tables, sss_contribution_months: staleMonths } })
		),
		/stale SSS source months/
	);
	await assert.rejects(
		transform(movements, [cash], {
			tables: {
				...tables,
				sss_contribution_months: staleMonths
			}
		}),
		/stale SSS source months/
	);
});

test('PH sourced cutoff rows refuse overlapping leave slices and unproved premium shares', async () => {
	const input = {
		ph_maternity_pay_plan_id: 'plan-1',
		cutoff_reference: 'OCT-2026',
		payroll_period: '2026-10',
		salary_window: { from: '2026-10-01', to: '2026-10-31' },
		leave_slice: { from: '2026-10-05', to: '2026-10-31' },
		pay_on: '2026-10-31',
		premium_basis: 'STATUTORY_PROJECTION',
		employee_sss_share: '700.00',
		employee_philhealth_share: '400.00',
		employee_pagibig_share: '100.00',
		premium_reference: 'CONTRIBUTION-PROJECTION-1',
		premium_file: { path: 'premium-projection.pdf' }
	};
	const tables = { ph_maternity_pay_plans: [{ id: 'plan-1' }] };
	await transform(cutoffs, [input], { tables });
	await assert.rejects(
		transform(cutoffs, [input, { ...input, cutoff_reference: 'OVERLAP' }], { tables }),
		/cannot overlap/
	);
	await assert.rejects(
		transform(cutoffs, [{ ...input, premium_reference: '' }], { tables }),
		/dated source document/
	);
});
