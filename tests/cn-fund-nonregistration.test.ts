// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import { statutoryFactStatusFault } from '../src/lib/datatypes/statutory_fact_status.ts';
import { COMPANY_ID, createStatutoryWorld } from './fixtures/statutory-world.ts';
import { runTransform } from './helpers/ctx.ts';

function world(hireDate, status) {
	const tables = createStatutoryWorld({
		code: 'CN-shanghai',
		period: '2025-12',
		region: 'SHANGHAI',
		companyFacts: { injury_rate: 0.2, housing_fund_rate: 7, housing_fund_supplementary_rate: 0 },
		people: [
			{
				key: 'CN-FUND',
				wage: 10_000,
				hire_date: hireDate,
				worksite: 'SHANGHAI',
				registrations: {
					PENSION: { kind: 'REGISTERED', elections: { contribution_base: 10_000 } }
				}
			}
		]
	});
	for (const fact of tables.employment_statutory_facts) {
		const scheme = tables.statutory_contributions.find(
			(row) => row.id === fact.statutory_contribution_id
		);
		if (scheme?.code !== 'HOUSING_FUND') continue;
		fact.employment_id = tables.employments[0].id;
		fact.status = status;
		fact.effective_range = { start: hireDate, end: null };
	}
	return tables;
}

const save = (tables) =>
	runTransform(payrollRuns, [{ company_id: COMPANY_ID, period: '2025-12' }], { tables });

test('saved Shanghai payroll assesses no fund charge in an evidenced first employment month', async () => {
	// Shanghai housing-fund contribution measure art. 16: a new worker starts in month two.
	const status = {
		kind: 'NOT_REGISTERED',
		reason: 'First employment month; fund contribution starts in the second month',
		elections: { first_ever_account: true },
		declaration_reference: 'CN-FUND-FIRST-EMPLOYMENT-2025-12'
	};
	assert.equal(statutoryFactStatusFault(status), undefined);
	const [run] = await save(world('2025-12-01', status));
	assert.equal(run.payslips.create.length, 1);
	assert.equal(
		run.payslips.create[0].statutory.find((row) => row.scheme_code === 'HOUSING_FUND'),
		undefined
	);
});

test('saved Shanghai payroll refuses a covered nonrecipient without a fund base', async () => {
	await assert.rejects(
		save(
			world('2025-11-01', {
				kind: 'NOT_REGISTERED',
				reason: 'Account registration pending; contribution is still due'
			})
		),
		/HOUSING_FUND:.*contribution base.*required/i
	);
});
