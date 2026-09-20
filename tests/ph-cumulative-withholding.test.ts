import assert from 'node:assert/strict';
import test from 'node:test';
import { assessStatutory, expectStatutory, COMPANY_ID } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

// RR 11-2018 s.2.79(B)(5)(a), printed pp.29–33; 2023 onward Annex E. The cumulative-average
// method is mandatory where the employee had a prior employer in the year, where regular
// compensation is below the exemption level and supplementary pay is present, or where the
// supplementary pay is at least the regular pay; once triggered it continues for the year.
// Average compensation and each periodic table result round to centavos as the published worked
// examples do, then multiply by the represented payroll periods before prior withholding.

const opening = (base: number, employee: number, extra: Readonly<Record<string, unknown>> = {}) => [
	{ year: '2026', base, employee, employer: 0, months: 6, reference: 'SYNTHETIC-2316', ...extra }
];

function prior(
	world: PayrollWorld,
	month: number,
	wage: number,
	tax: number,
	bonus = 0,
	frequency = 'MONTHLY'
) {
	const runId = `ph-cumulative-${month}`;
	const sss = Math.min(wage * 0.05, 1000);
	const mpf = Math.min(wage * 0.05 - sss, 750);
	const phic = wage * 0.025;
	world.payroll_runs.push({
		id: runId,
		company_id: COMPANY_ID,
		period: `2026-${String(month).padStart(2, '0')}`
	});
	world.payslips.push({
		id: `${runId}-slip`,
		payroll_run_id: runId,
		employment_id: world.employments[0]!.id,
		status: 'PAID',
		paid_at: `2026-${String(month).padStart(2, '0')}-28T00:00:00.000Z`,
		currency: 'PHP',
		base: [{ component_code: 'BASIC', amount: wage }],
		adjustments: bonus ? [{ component_code: 'bonus', amount: bonus }] : [],
		statutory: [
			{
				scheme_code: 'WTAX',
				base_amount: wage + Math.max(0, bonus - 90000),
				ordinary_amount: wage,
				assessment_frequency: frequency,
				employee_amount: tax,
				employer_amount: 0
			},
			{ scheme_code: 'SSS', base_amount: wage, employee_amount: sss, employer_amount: sss * 2 },
			{
				scheme_code: 'SSS_MPF',
				base_amount: wage,
				employee_amount: mpf,
				employer_amount: mpf * 2
			},
			{ scheme_code: 'PHIC', base_amount: wage, employee_amount: phic, employer_amount: phic },
			{ scheme_code: 'HDMF', base_amount: wage, employee_amount: 200, employer_amount: 200 }
		]
	} as never);
}

function bonus(world: PayrollWorld, amount: number) {
	const active = world.jurisdiction_settings.find(
		(row) =>
			String(row.effective_range.start).slice(0, 10) <= '2026-07-01' &&
			String(row.effective_range.end).slice(0, 10) > '2026-07-01'
	)!;
	const row = world.adhoc_catalogue!.find(
		(candidate) => candidate.code === 'bonus' && candidate.settings_id === active.id
	)!;
	world.adhoc_requests!.push({
		id: 'a9000000-0000-4000-8000-000000000001',
		employment_id: world.employments[0]!.id,
		catalogue_id: row.id,
		amount,
		event_date: '2026-07-20',
		pay_period: '2026-07',
		payslip_id: null,
		reason: 'Synthetic bonus',
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});
}

test('PH cumulative: prior employer, six periods of PHP27550 taxable plus PHP56550 current', () => {
	const book = assessStatutory(
		{
			code: 'PH',
			period: '2026-07',
			people: [
				{
					key: 'CUM',
					wage: 60000,
					hire_date: '2026-07-01',
					registrations: {
						WTAX: { kind: 'REGISTERED', opening: opening(180000, 6045.3) },
						SSS: { kind: 'REGISTERED', opening: opening(180000, 6000) },
						SSS_MPF: { kind: 'REGISTERED', opening: opening(180000, 3000) },
						PHIC: { kind: 'REGISTERED', opening: opening(180000, 4500) },
						HDMF: { kind: 'REGISTERED', opening: opening(180000, 1200) }
					}
				}
			]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
		}
	);
	// (165,300 + 56,550) / 7 = 31,692.86; table 1,628.98 × 7 − 6,045.30 = 5,357.56.
	expectStatutory(book, 'CUM', 'WTAX', 5357.56, 0);
});

test('PH cumulative: regular below the exemption level, supplementary below regular', () => {
	const book = assessStatutory(
		{ code: 'PH', period: '2026-07', people: [{ key: 'CUM', wage: 20000 }] },
		(world) => {
			for (let month = 1; month <= 6; month += 1) prior(world, month, 20000, 0);
			bonus(world, 100000);
		}
	);
	// Six 18,300 + July 28,300 = 138,100; / 7 = 19,728.57; table 0; withheld 0.
	expectStatutory(book, 'CUM', 'WTAX', 0, 0);
});

test('PH cumulative: supplementary at least the taxable regular compensation', () => {
	const book = assessStatutory(
		{ code: 'PH', period: '2026-07', people: [{ key: 'CUM', wage: 30000 }] },
		(world) => {
			for (let month = 1; month <= 6; month += 1) prior(world, month, 30000, 1007.55);
			bonus(world, 140000);
		}
	);
	// Six 27,550 + July 77,550 = 242,850; / 7 = 34,692.86; table 2,146.97;
	// 2,146.97 × 7 − 6,045.30 = 8,983.49.
	expectStatutory(book, 'CUM', 'WTAX', 8983.49, 0);
});

test('PH cumulative: the method persists after an earlier trigger and a salary increase', () => {
	const book = assessStatutory(
		{ code: 'PH', period: '2026-08', people: [{ key: 'CUM', wage: 60000 }] },
		(world) => {
			for (let month = 1; month <= 6; month += 1) prior(world, month, 20000, 0);
			// July saved its own ordinary compensation, so the supplementary trigger is rederived
			// from the assessment history: (109,800 + 68,300) / 7 = 25,442.86; table 691.48 × 7.
			prior(world, 7, 20000, 4840.36, 140000);
		}
	);
	// (178,100 + 56,550) / 8 = 29,331.25; table 1,274.74 × 8 − 4,840.36 = 5,357.56.
	expectStatutory(book, 'CUM', 'WTAX', 5357.56, 0);
});

test('PH cumulative: a zero prior-employer balance still triggers the method', () => {
	const book = assessStatutory(
		{
			code: 'PH',
			period: '2026-07',
			people: [
				{
					key: 'CUM',
					wage: 60000,
					hire_date: '2026-07-01',
					registrations: {
						WTAX: { kind: 'REGISTERED', opening: opening(0, 0) },
						SSS: { kind: 'REGISTERED', opening: opening(0, 0) },
						SSS_MPF: { kind: 'REGISTERED', opening: opening(0, 0) },
						PHIC: { kind: 'REGISTERED', opening: opening(0, 0) },
						HDMF: { kind: 'REGISTERED', opening: opening(0, 0) }
					}
				}
			]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
		}
	);
	// Prior employment is a trigger even with nothing remitted: 56,550 / 7 = 8,078.57; table 0.
	// The ordinary monthly table would have withheld 1,628.98.
	expectStatutory(book, 'CUM', 'WTAX', 0, 0);
});

test('PH cumulative: an interim negative is not a refund', () => {
	const book = assessStatutory(
		{
			code: 'PH',
			period: '2026-07',
			people: [
				{
					key: 'CUM',
					wage: 60000,
					hire_date: '2026-07-01',
					registrations: {
						WTAX: { kind: 'REGISTERED', opening: opening(360000, 100000) },
						SSS: { kind: 'REGISTERED', opening: opening(360000, 6000) },
						SSS_MPF: { kind: 'REGISTERED', opening: opening(360000, 3000) },
						PHIC: { kind: 'REGISTERED', opening: opening(360000, 4500) },
						HDMF: { kind: 'REGISTERED', opening: opening(360000, 1200) }
					}
				}
			]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
		}
	);
	// (360,000 − 14,700 + 56,550) / 7 = 57,407.14; table 6,689.83 × 7 = 46,828.81, below the
	// 100,000 already withheld: the period withholds nothing rather than refunding in-year.
	expectStatutory(book, 'CUM', 'WTAX', 0, 0);
});

test('PH cumulative: an incomplete prior-employer opening stops calculation', () => {
	assert.throws(
		() =>
			assessStatutory(
				{
					code: 'PH',
					period: '2026-07',
					people: [
						{
							key: 'CUM',
							wage: 60000,
							hire_date: '2026-07-01',
							registrations: {
								WTAX: {
									kind: 'REGISTERED',
									opening: [
										{ year: '2026', base: 180000, employee: 6045.3, employer: 0, reference: 'X' }
									]
								}
							}
						}
					]
				},
				(world) => {
					world.companies[0]!.pay_cutoff_day = 1;
				}
			),
		/record the prior employer.?s payroll periods and cadence/i
	);
});

test('PH cumulative: a semi-monthly average uses the semi-monthly table', () => {
	const book = assessStatutory(
		{
			code: 'PH',
			period: '2026-07-2',
			payFrequency: 'SEMI_MONTHLY',
			people: [
				{
					key: 'CUM',
					wage: 30000,
					pay_frequency: 'SEMI_MONTHLY',
					hire_date: '2026-07-16',
					registrations: {
						WTAX: { kind: 'REGISTERED', opening: opening(0, 0, { months: 2 }) },
						SSS: { kind: 'REGISTERED', opening: opening(0, 0, { months: 2 }) },
						SSS_MPF: { kind: 'REGISTERED', opening: opening(0, 0, { months: 2 }) },
						PHIC: { kind: 'REGISTERED', opening: opening(0, 0, { months: 2 }) },
						HDMF: { kind: 'REGISTERED', opening: opening(0, 0, { months: 2 }) }
					}
				}
			]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
		}
	);
	// Two prior months are four semi-monthly periods: (27,550) / 5 = 5,510; table 0.
	// The semi-monthly periodic table alone would have withheld 3,114.10.
	expectStatutory(book, 'CUM', 'WTAX', 0, 0);
});

test('PH cumulative: a weekly average uses the weekly table', () => {
	const book = assessStatutory(
		{
			code: 'PH',
			period: '2026-07-2',
			payFrequency: 'WEEKLY',
			people: [
				{
					key: 'CUM-WK',
					wage: 10_000,
					pay_frequency: 'WEEKLY',
					hire_date: '2026-07-06',
					registrations: {
						WTAX: { kind: 'REGISTERED', opening: opening(0, 0, { months: 1 }) },
						SSS: { kind: 'REGISTERED', opening: opening(0, 0, { months: 1 }) },
						SSS_MPF: { kind: 'REGISTERED', opening: opening(0, 0, { months: 1 }) },
						PHIC: { kind: 'REGISTERED', opening: opening(0, 0, { months: 1 }) },
						HDMF: { kind: 'REGISTERED', opening: opening(0, 0, { months: 1 }) }
					}
				}
			]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
		}
	);
	// One prior month is 52/12 ≈ 4.333 weekly periods: 10,000 / 5.333 = 1,875; weekly table 0.
	// The weekly periodic table alone would have withheld 894.20.
	expectStatutory(book, 'CUM-WK', 'WTAX', 0, 0);
});
