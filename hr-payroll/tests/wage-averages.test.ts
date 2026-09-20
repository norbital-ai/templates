import assert from 'node:assert/strict';
import test from 'node:test';
import { monthlyWageAverage } from '../src/lib/payroll/contribution.ts';
import { earnedAverage } from '../src/collections/payroll_runs/lib/contribute.ts';
import { adhocCatalogue, contributionSchemes } from './fixtures/statutory-world.ts';

const terms = (start: string, end: string | null, value: number) =>
	({ base_salary: { value, currency: 'VND' }, effective_range: { start, end } }) as never;

test('the six-month average of the contractual wage reads the terms in force on the first of each month (VN Decree 145 art.8(5))', () => {
	// Hired 1 Jan 2025 on 20,000,000; raised to 26,000,000 from 1 Nov 2025; leaving 31 Jan 2026.
	// The six months ending January: Aug, Sep, Oct at 20M, Nov, Dec, Jan at 26M → 23,000,000.
	const bundle = {
		employment: { effective_range: { start: '2025-01-01', end: '2026-01-31' } },
		termsHistory: [
			terms('2025-01-01', '2025-10-31', 20_000_000),
			terms('2025-11-01', null, 26_000_000)
		],
		terms: [terms('2025-11-01', null, 26_000_000)]
	} as never;
	const configuration = { catalogueComponents: [] } as never;
	assert.equal(monthlyWageAverage(bundle, configuration, '2026-01-31', 6), 23_000_000);
	// An employment younger than the window averages the months it has: hired 1 Dec 2025.
	const young = {
		...bundle,
		employment: { effective_range: { start: '2025-12-01', end: null } }
	} as never;
	assert.equal(monthlyWageAverage(young, configuration, '2026-01-31', 6), 26_000_000);
	// The VN severance and job-loss classes measure on it.
	for (const row of adhocCatalogue('VN'))
		if (row.code === 'SEVERANCE_ALLOWANCE' || row.code === 'JOB_LOSS_ALLOWANCE')
			assert.match(row.bands[0]!.amount, /monthly_wage_6m_average/);
});

test('earned_average reads a window of earlier payslips ending months_back before the pay month', () => {
	const history = new Map([
		['2026-05', new Map([['BASIC', 30_000]])],
		['2026-06', new Map([['BASIC', 36_000]])],
		['2026-07', new Map([['BASIC', 33_000]])],
		['2026-08', new Map([['BASIC', 99_000]])]
	]);
	// September, two months back, three months: May, June, July.
	assert.equal(earnedAverage(history, '2026-09', 'BASIC', 2, 3), 33_000);
	// A month with no payslip inside the window counts as zero; a window with none at all is 0.
	assert.equal(earnedAverage(history, '2026-10', 'BASIC', 1, 3), (33_000 + 99_000) / 3);
	assert.equal(earnedAverage(history, '2026-11', 'BASIC', 1, 3), 99_000 / 3);
	assert.equal(earnedAverage(history, '2027-06', 'BASIC', 2, 3), 0);
	// A year boundary: March reads November to January.
	assert.equal(
		earnedAverage(new Map([['2025-12', new Map([['BASIC', 60_000]])]]), '2026-03', 'BASIC', 2, 3),
		20_000
	);
	// Every TW insurance prices the declared grade, which the employment records as a required
	// election rather than re-deriving from the current wage.
	for (const scheme of contributionSchemes('TW'))
		if (['LI', 'EI', 'LABOR_PENSION', 'OCC_INJURY', 'NHI'].includes(scheme.code)) {
			assert.match(scheme.assessed_on, /scheme\.elections\.insured_amount/);
			assert.ok(
				scheme.elections.some((field) => field.key === 'insured_amount' && field.required === true),
				`${scheme.code} requires the insured amount`
			);
		}
});
