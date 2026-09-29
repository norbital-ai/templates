// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import { COMPANY_ID, createStatutoryWorld, settingsIdOn } from './fixtures/statutory-world.ts';
import { runTransform } from './helpers/ctx.ts';

test('saved Shanghai payroll keeps an internal retiree’s wage in cumulative IIT and taxes the subsidy separately', async () => {
	// STA Shanxi annual-settlement FAQ question 20: combined tax minus simulated wage-only tax
	// belongs to the subsidy; the actual wage remains in annual comprehensive income.
	const tables = createStatutoryWorld({
		code: 'CN-shanghai',
		period: '2026-01',
		region: 'SHANGHAI',
		companyFacts: {
			injury_rate: 0.2,
			housing_fund_rate: 7,
			housing_fund_supplementary_rate: 0,
			unemployment_employer_rate: 0.5,
			unemployment_employee_rate: 0.5
		},
		people: [
			{
				key: 'SH-INTERNAL',
				wage: 10_000,
				worksite: 'SHANGHAI',
				registrations: {
					PENSION: { kind: 'REGISTERED', elections: { contribution_base: 10_000 } },
					HOUSING_FUND: { kind: 'REGISTERED', elections: { contribution_base: 10_000 } }
				}
			}
		]
	});
	const employment = tables.employments[0];
	employment.exit_facts = { iit164_internal_retirement_months: 24 };
	const subsidy = tables.adhoc_catalogue.find(
		(row) =>
			row.code === 'INTERNAL_RETIREMENT_SUBSIDY' &&
			row.settings_id === settingsIdOn('CN-shanghai', '2026-01-20')
	);
	tables.adhoc_requests.push({
		id: 'd0000000-0000-4000-8000-000000000001',
		employment_id: employment.id,
		catalogue_id: subsidy.id,
		amount: 120_000,
		event_date: '2026-01-20',
		pay_period: null,
		payslip_id: null,
		reason: 'Internal-retirement subsidy',
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});
	const [run] = await runTransform(payrollRuns, [{ company_id: COMPANY_ID, period: '2026-01' }], {
		tables
	});
	const statutory = run.payslips.create[0].statutory;
	const charge = (code) => statutory.find((row) => row.scheme_code === code);
	// The wage stays in ordinary cumulative IIT, withheld on STA 2018 No.61 art.6's ANNEX table 1
	// annual scale (3% to 36,000): 10,000 − 1,750 of employee pension, medical, unemployment and
	// housing fund − 5,000 = 3,250 taxable, 3% = 97.50. This file expected 115, which is the MONTHLY
	// scale's 3,250 × 10% − 210; art.6 cumulative withholding is on the annual table.
	assert.deepEqual([charge('IIT')?.base_amount, charge('IIT')?.employee_amount], [10_000, 97.5]);
	// 国税发〔1999〕58号 art.1: the one-off spread over the 24 months to statutory age merges with
	// this month's wage to choose the rate — 10,000 + 120,000 ÷ 24 − 5,000 = 10,000, the 10% rung —
	// and that rate is charged on wage plus the whole one-off less the 5,000 deduction:
	// 125,000 × 10% − 210 = 12,290. The FAQ's wage-only subtraction is the wage's own monthly tax on
	// 10,000 − 5,000 = 5,000, i.e. the monthly scale's 3,000 at 3% (90) plus 2,000 at 10% (200) = 290,
	// leaving 12,000. This file expected 12,140: it took the wage-only tax as a flat 3% of 5,000.
	assert.deepEqual(
		[
			charge('IIT_INTERNAL_RETIREMENT')?.base_amount,
			charge('IIT_INTERNAL_RETIREMENT')?.employee_amount
		],
		[130_000, 12_000]
	);
});
