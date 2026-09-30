// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import cases from '../src/data/collection/benefit_cases/+collection.ts';
import cutoffs from '../src/data/collection/benefit_case_cutoffs/+collection.ts';
import plans from '../src/data/collection/benefit_case_plans/+collection.ts';
import monthsCollection from '../src/data/collection/contribution_statement_months/+collection.ts';
import movements from '../src/data/collection/benefit_case_movements/+collection.ts';
import { caller, query, transform } from './helpers/bodies.ts';
import { lineageTables } from './fixtures/benefit-cases.ts';

const lineage = lineageTables({
	id: 'employment-1',
	employee_id: 'mother',
	company_id: 'company-1'
});

const caseRow = {
	id: 'case-1',
	employee_id: 'mother',
	employment_id: 'employment-1',
	case_type: 'MATERNITY_LEAVE',
	case_reference: 'MBA-2026-1',
	application_on: '2026-09-01',
	expected_event_on: '2026-10-05',
	leave_from: '2026-10-05',
	leave_through: '2027-01-17'
};
const months = Array.from({ length: 12 }, (_, index) => {
	const day = new Date(Date.UTC(2025, 6 + index, 1)).toISOString().slice(0, 7);
	return {
		id: `sss-${day}`,
		employee_id: 'mother',
		scheme_code: 'SSS',
		coverage_month: day,
		credited_amount: '20000.00',
		paid_on: '2026-06-30',
		source_reference: `SSS-STATEMENT-${day}`,
		evidence_file: { path: `sss-statement-${day}.pdf` }
	};
});
const planInput = {
	benefit_case_id: 'case-1',
	basis_method: 'DOCUMENTED_MONTHLY_EQUIVALENT',
	monthly_full_pay_basis: '31300.00',
	qualifying_allowances_assessed: true,
	basis_reference: 'SIGNED-FULL-PAY-BASIS-1',
	basis_file: { path: 'wage-basis.pdf' }
};

test('prebirth PH plan freezes twelve paid SSS months and reports overdue or actual-award true-up', async () => {
	const [created] = await transform(plans, [planInput], {
		now: '2026-09-20T00:00:00.000Z',
		tables: { ...lineage, benefit_cases: [caseRow], contribution_statement_months: months }
	});
	assert.equal(created.event_basis_kind, 'EXPECTED_EVENT');
	assert.equal(created.candidate_amount, 70000);
	assert.equal(created.advance_due_on, '2026-10-01');
	assert.equal(JSON.parse(created.history_snapshot).length, 12);
	const plan = { id: 'plan-1', ...created };
	const overdue = await query(
		plans,
		'advance_status',
		{ plan_id: 'plan-1', as_of: '2026-10-02' },
		caller({
			tables: {
				...lineage,
				benefit_case_plans: [plan],
				benefit_cases: [caseRow],
				contribution_statement_months: months
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
				...lineage,
				benefit_case_plans: [plan],
				benefit_cases: [caseRow],
				contribution_statement_months: months,
				benefit_case_movements: [
					{
						benefit_case_id: 'case-1',
						kind: 'SSS_ADVANCE',
						direction: 'EMPLOYEE_PAYMENT',
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
		facts: { solo_parent_claimed: false },
		award_amount: '71000.00'
	};
	const paid = await query(
		plans,
		'advance_status',
		{ plan_id: 'plan-1', as_of: '2026-10-25' },
		caller({
			tables: {
				...lineage,
				benefit_case_plans: [plan],
				benefit_cases: [awarded],
				contribution_statement_months: months,
				benefit_case_movements: [
					{
						benefit_case_id: 'case-1',
						benefit_case_plan_id: 'plan-1',
						kind: 'SSS_ADVANCE',
						direction: 'EMPLOYEE_PAYMENT',
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
				...lineage,
				benefit_cases: [caseRow],
				contribution_statement_months: [{ ...months[0], evidence_file: null }, ...months.slice(1)]
			}
		}),
		/attached contribution statement/
	);
	await assert.rejects(
		transform(plans, [planInput], {
			now: '2026-09-20T00:00:00.000Z',
			tables: {
				...lineage,
				benefit_cases: [caseRow],
				contribution_statement_months: months.slice(1)
			}
		}),
		/all 12 SSS contribution months/
	);
	const [created] = await transform(plans, [planInput], {
		now: '2026-09-20T00:00:00.000Z',
		tables: { ...lineage, benefit_cases: [caseRow], contribution_statement_months: months }
	});
	const first = { id: 'plan-1', ...created };
	const [revision] = await transform(
		plans,
		[{ ...planInput, basis_reference: 'CORRECTED-WAGE-BASIS-2' }],
		{
			now: '2026-09-20T00:00:00.000Z',
			tables: {
				...lineage,
				benefit_cases: [caseRow],
				contribution_statement_months: months,
				benefit_case_plans: [first]
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
					...lineage,
					benefit_cases: [caseRow],
					benefit_case_plans: [first, { id: 'plan-2', ...revision }],
					contribution_statement_months: months
				}
			})
		),
		/superseded before cash/
	);
	const tables = {
		...lineage,
		benefit_cases: [caseRow],
		benefit_case_plans: [first, { id: 'plan-2', ...revision }],
		benefit_case_movements: [
			{
				benefit_case_id: 'case-1',
				benefit_case_plan_id: 'plan-2',
				kind: 'SSS_ADVANCE',
				direction: 'EMPLOYEE_PAYMENT'
			}
		]
	};
	await assert.rejects(
		transform(plans, [{ ...planInput, basis_reference: 'TOO-LATE' }], {
			now: '2026-09-20T00:00:00.000Z',
			tables: { ...tables, contribution_statement_months: months }
		}),
		/cannot be created or superseded after employee cash/
	);
	await assert.rejects(
		transform(monthsCollection, [{ credited_amount: '19000.00' }], {
			existing: [months[0]],
			tables
		}),
		/used by a frozen advance plan cannot change/
	);
	await assert.rejects(
		transform(cases, [{ expected_event_on: '2026-10-06' }], {
			existing: [caseRow],
			tables: {
				...lineage,
				...tables
			}
		}),
		/funded benefit expected event cannot change/
	);
});

test('PH cash cannot pin an active candidate after its sourced SSS months changed', async () => {
	const [created] = await transform(plans, [planInput], {
		now: '2026-09-20T00:00:00.000Z',
		tables: { ...lineage, benefit_cases: [caseRow], contribution_statement_months: months }
	});
	const cash = {
		benefit_case_id: 'case-1',
		kind: 'SSS_ADVANCE',
		paid_on: '2026-09-30',
		amount: '70000.00',
		payment_reference: 'BANK-CREDIT-1',
		evidence_file: { path: 'bank-credit.pdf' }
	};
	const tables = {
		...lineage,
		benefit_cases: [caseRow],
		benefit_case_plans: [{ id: 'plan-1', ...created }],
		contribution_statement_months: months
	};
	const [pinned] = await transform(movements, [cash], { tables });
	assert.equal(pinned.benefit_case_plan_id, 'plan-1');
	const staleMonths = [{ ...months[0], credited_amount: '19000.00' }, ...months.slice(1)];
	await assert.rejects(
		query(
			plans,
			'advance_status',
			{ plan_id: 'plan-1', as_of: '2026-09-30' },
			caller({ tables: { ...tables, contribution_statement_months: staleMonths } })
		),
		/stale contribution-statement months/
	);
	await assert.rejects(
		transform(movements, [cash], {
			tables: {
				...lineage,
				...tables,
				contribution_statement_months: staleMonths
			}
		}),
		/stale contribution-statement months/
	);
});

test('PH sourced cutoff rows refuse overlapping leave slices and unproved premium shares', async () => {
	const input = {
		benefit_case_plan_id: 'plan-1',
		cutoff_reference: 'OCT-2026',
		payroll_period: '2026-10',
		salary_window: { from: '2026-10-01', to: '2026-10-31' },
		leave_slice: { from: '2026-10-05', to: '2026-10-31' },
		pay_on: '2026-10-31',
		premium_basis: 'STATUTORY_PROJECTION',
		premium_shares: { SSS: 700, PHIC: 400, HDMF: 100 },
		premium_reference: 'CONTRIBUTION-PROJECTION-1',
		premium_file: { path: 'premium-projection.pdf' }
	};
	const tables = { benefit_case_plans: [{ id: 'plan-1' }] };
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
