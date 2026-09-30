// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import { COMPANY_ID, createStatutoryWorld, settingsIdOn } from './fixtures/statutory-world.ts';
import { runTransform } from './helpers/ctx.ts';

const SH = 'CN-shanghai';

function contractRun(code, fields = {}, eventDate = '2025-12-20', exitDate = null) {
	const tables = createStatutoryWorld({
		code: SH,
		period: '2025-12',
		region: 'SHANGHAI',
		companyFacts: { injury_rate: 0.2, housing_fund_rate: 7, housing_fund_supplementary_rate: 0 },
		people: [
			{
				key: 'CN-CONTRACT',
				wage: 10_000,
				worksite: 'SHANGHAI',
				registrations: {
					PENSION: { kind: 'REGISTERED', elections: { contribution_base: 10_000 } },
					HOUSING_FUND: { kind: 'REGISTERED', elections: { contribution_base: 10_000 } }
				}
			}
		]
	});
	if (exitDate != null) tables.employments[0].effective_range.end = exitDate;
	// The contract determinations are the version's declared terms inputs (`terms_facts`).
	tables.employment_terms[0].facts = { ...tables.employment_terms[0].facts, ...fields };
	const component = tables.adhoc_catalogue.find(
		(row) => row.code === code && row.settings_id === settingsIdOn(SH, eventDate)
	);
	tables.adhoc_requests.push({
		id: 'd0000000-0000-4000-8000-000000000013',
		employment_id: tables.employments[0].id,
		catalogue_id: component.id,
		amount: 0,
		event_date: eventDate,
		pay_period: null,
		payslip_id: null,
		reason: 'Recorded contract obligation',
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});
	return runTransform(payrollRuns, [{ company_id: COMPANY_ID, period: '2025-12' }], { tables });
}

test('saved CN contract claims refuse when their required dated terms are absent', async () => {
	await assert.rejects(
		contractRun('PROBATION_EXCESS_DAMAGES'),
		/PROBATION_EXCESS_DAMAGES.*probation_end/
	);
	await assert.rejects(
		contractRun('PROBATION_WAGE_SHORTFALL', { probation_end: '2025-12-20' }),
		/PROBATION_WAGE_SHORTFALL.*post_probation_wage/
	);
	await assert.rejects(
		contractRun('OPEN_ENDED_CONTRACT_WAGE'),
		/OPEN_ENDED_CONTRACT_WAGE.*open_ended_due_on/
	);
	await assert.rejects(
		contractRun('OPEN_ENDED_CONTRACT_WAGE', { open_ended_due_on: '2026-01-01' }),
		/OPEN_ENDED_CONTRACT_WAGE.*open_ended_due_on/
	);
	await assert.rejects(
		contractRun('OPEN_ENDED_CONTRACT_WAGE', { open_ended_due_on: '2014-12-31' }),
		/OPEN_ENDED_CONTRACT_WAGE.*open_ended_due_on/
	);
	await assert.rejects(
		contractRun(
			'OPEN_ENDED_CONTRACT_WAGE',
			{ open_ended_due_on: '2025-12-01' },
			'2025-12-20',
			'2025-12-10'
		),
		/OPEN_ENDED_CONTRACT_WAGE.*event date.*exit/
	);
});

test('saved CN open-ended second wage uses the recorded due date', async () => {
	const [run] = await contractRun('OPEN_ENDED_CONTRACT_WAGE', {
		open_ended_due_on: '2025-12-01'
	});
	const line = run.payslips.create[0].adjustments.find(
		(row) => row.component_code === 'OPEN_ENDED_CONTRACT_WAGE'
	);
	assert.ok(line?.amount > 0);
});
