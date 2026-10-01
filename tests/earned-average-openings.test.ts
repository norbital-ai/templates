// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * `employment.earned_monthly_average` reads the wages of each month before the rule date: a month
 * no payslip of this workspace settles reads the opening pay recorded for it
 * (`employment_wage_periods.normal_wages`), and a month a payslip settles reads the payslip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFamilyHistory } from '../src/lib/payroll/families.ts';
import { earnedMonthlyAverage } from '../src/lib/expressions/person-functions.ts';

const opening = (month: string, normal_wages: number) => ({
	id: `open-${month}`,
	employment_id: 'job',
	period: { from: `${month}-01`, to: `${month}-28` },
	currency: 'XXX',
	normal_wages,
	ordinary_wages: null,
	ordinary_days: null,
	due_on: `${month}-28`,
	paid_on: `${month}-28`,
	approval_id: null
});

test('the twelve-month average reads opening wage periods for months no payslip settles', () => {
	const months = Array.from(
		{ length: 12 },
		(_, index) => `2025-${String(index + 1).padStart(2, '0')}`
	);
	const openings = months.map((month, index) =>
		// January–June 20,000, July–November 23,500; December's opening is shadowed by its payslip.
		opening(month, index < 6 ? 20_000 : index < 11 ? 23_500 : 99_999)
	);
	const december = {
		id: 'slip-12',
		employment_id: 'job',
		payroll_run_id: 'run-12',
		status: 'PAID',
		paid_at: '2025-12-31T00:00:00Z',
		base: [{ component_code: 'BASIC', amount: 30_000 }],
		adjustments: [],
		statutory: [],
		proration: [{ component_code: 'BASIC', prorated_amount: 30_000 }]
	};
	const prepared = prepareFamilyHistory({
		world: {
			employment_wage_periods: openings,
			payslips: [december],
			claim_requests: [],
			adhoc_requests: []
		},
		payslips: [december],
		inTaxYear: new Set(),
		employmentToEmployee: new Map([['job', 'person']]),
		periodByRun: new Map([['run-12', '2025-12']]),
		traceByRun: new Map(),
		catalogueComponents: []
	});
	const earnings = prepared.earnedByMonth.get('person');
	const wages = Object.fromEntries(
		[...earnings].map(([month, codes]) => [month, Object.fromEntries(codes)])
	);
	// (6 × 20,000 + 5 × 23,500 + 30,000) / 12 = 267,500 / 12 = 22,291.666…
	const average = earnedMonthlyAverage(
		{
			service_start: '2020-03-02',
			exit_date: '2026-01-31',
			history: { as_of: '2026-01-31', wages }
		},
		12
	);
	assert.equal(Math.round(average * 100) / 100, 22_291.67);
	assert.equal(wages['2025-12'].WAGES, 30_000);
});

for (const overtimeCode of ['OVERTIME', 'WORKDAY_OT'])
	test(`a saved ${overtimeCode} work line enters the overtime history total once`, () => {
		const slip = {
			id: 'work-slip',
			employment_id: 'job',
			payroll_run_id: 'work-run',
			status: 'PAID',
			paid_at: '2025-12-31T00:00:00Z',
			base: [{ component_code: 'BASIC', amount: 3000 }],
			adjustments: [
				{ component_code: overtimeCode, family: 'WORK_DAY', bucket: 'EARNING', amount: 120 },
				{ component_code: 'NIGHT', family: 'WORK_DAY', bucket: 'EARNING', amount: 80 }
			],
			statutory: [],
			proration: [{ component_code: 'BASIC', prorated_amount: 3000 }]
		};
		const prepared = prepareFamilyHistory({
			world: {
				employment_wage_periods: [],
				payslips: [slip],
				claim_requests: [],
				adhoc_requests: []
			},
			payslips: [slip],
			inTaxYear: new Set(),
			employmentToEmployee: new Map([['job', 'person']]),
			periodByRun: new Map([['work-run', '2025-12']]),
			traceByRun: new Map(),
			catalogueComponents: []
		});
		const codes = prepared.earnedByMonth.get('person').get('2025-12');
		assert.equal(codes.get('OVERTIME'), 200);
		assert.equal(codes.get('WAGES'), 3200);
		assert.equal(
			earnedMonthlyAverage(
				{
					service_start: '2025-12-01',
					exit_date: '2026-01-31',
					history: { as_of: '2026-01-31', wages: { '2025-12': Object.fromEntries(codes) } }
				},
				12,
				['OVERTIME']
			),
			3000
		);
	});
