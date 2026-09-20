import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	assessStatutory,
	buildStatutory,
	createStatutoryWorld,
	COMPANY_ID,
	expectStatutory,
	type Person
} from './fixtures/statutory-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';

const insuredCodes = ['LI', 'EI', 'NHI', 'OCC_INJURY', 'LABOR_PENSION', 'WAGE_ARREARS_BASE'];

function registrations(amount = 34800): NonNullable<Person['registrations']> {
	return Object.fromEntries(
		insuredCodes.map((code) => [
			code,
			{
				kind: 'REGISTERED',
				elections: {
					insured_amount: amount,
					...(code === 'NHI' ? { enrolled_dependants: 0 } : {}),
					...(code === 'LABOR_PENSION' ? { voluntary_rate: 0 } : {})
				}
			}
		])
	);
}

for (const period of ['2025-12', '2026-01', '2027-01']) {
	test(`Taiwan ${period} — recorded insurance grades survive an unreported salary increase`, () => {
		// BLI: https://www.bli.gov.tw/0005472.htm and /0006928.html. A declared adjustment
		// takes effect on the first of the month after notification; contract salary is not that date.
		const book = assessStatutory({
			code: 'TW',
			period,
			riskClass: '1',
			people: [{ key: 'DECLARED', wage: 60000, registrations: registrations() }]
		});
		expectStatutory(
			book,
			'DECLARED',
			'LI',
			period === '2027-01' ? 835 : 800,
			period === '2027-01' ? 2923 : 2801
		);
		expectStatutory(book, 'DECLARED', 'EI', 70, 244);
		expectStatutory(book, 'DECLARED', 'NHI', 540, 1684);
		expectStatutory(book, 'DECLARED', 'OCC_INJURY', 0, 87);
		expectStatutory(book, 'DECLARED', 'LABOR_PENSION', 0, 2088);
		assert.equal(book.get('DECLARED')!.get('WAGE_ARREARS_BASE')!.base, 34800);
	});

	test(`Taiwan ${period} — unknown and invalid declared insurance amounts cannot use salary as a default`, () => {
		for (const code of insuredCodes)
			for (const amount of [undefined, 0, 35555, 34800.5])
				assert.throws(
					() =>
						assessStatutory(
							{
								code: 'TW',
								period,
								riskClass: '1',
								people: [
									{
										key: 'UNKNOWN',
										wage: 60000,
										registrations: {
											...registrations(),
											[code]: {
												kind: 'REGISTERED',
												elections: {
													...(amount == null ? {} : { insured_amount: amount }),
													...(code === 'NHI' ? { enrolled_dependants: 0 } : {}),
													...(code === 'LABOR_PENSION' ? { voluntary_rate: 0 } : {})
												}
											}
										}
									}
								]
							},
							(world) => {
								if (amount != null) return;
								const ids = new Set(
									world.statutory_contributions
										.filter((row) => row.code === code)
										.map((row) => row.id)
								);
								for (const fact of world.employment_statutory_facts)
									if (ids.has(fact.statutory_contribution_id) && fact.status.kind === 'REGISTERED')
										delete fact.status.elections!.insured_amount;
							}
						),
					/(?:required|at least|one of|whole number)/
				);
	});
}

for (const [period, amount, expected] of [
	['2026-01', 34800, 800],
	['2026-02', 40100, 922]
] as const)
	test(`Taiwan — ${period} uses the insurance notice effective interval`, () => {
		const book = assessStatutory(
			{
				code: 'TW',
				period,
				riskClass: '1',
				people: [{ key: 'NOTICE', wage: 60000, registrations: registrations() }]
			},
			(world) => {
				world.companies[0]!.pay_cutoff_day = 1;
				const ids = new Set(
					world.statutory_contributions.filter((row) => row.code === 'LI').map((row) => row.id)
				);
				for (const fact of [...world.employment_statutory_facts]) {
					if (!ids.has(fact.statutory_contribution_id) || fact.status.kind !== 'REGISTERED')
						continue;
					fact.effective_range = { ...fact.effective_range, end: '2026-01-31' };
					world.employment_statutory_facts.push({
						...fact,
						id: `${fact.id}-notice`,
						effective_range: { start: '2026-02-01', end: null },
						status: {
							...fact.status,
							elections: {
								...fact.status.elections,
								insured_amount: 40100,
								notification_reference: 'JANUARY-NOTICE'
							}
						}
					});
				}
			}
		);
		assert.equal(book.get('NOTICE')!.get('LI')!.base, amount);
		assert.equal(book.get('NOTICE')!.get('LI')!.employee, expected);
	});

test('Taiwan — ending insurance mid-month retains premiums for the preceding covered days', () => {
	const book = assessStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [{ key: 'WITHDRAWAL', wage: 40000, registrations: registrations(40100) }]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
			const ids = new Set(
				world.statutory_contributions.filter((row) => row.code === 'LI').map((row) => row.id)
			);
			for (const fact of [...world.employment_statutory_facts]) {
				if (!ids.has(fact.statutory_contribution_id)) continue;
				fact.effective_range = { ...fact.effective_range, end: '2026-01-15' };
				world.employment_statutory_facts.push({
					...fact,
					id: `${fact.id}-withdrawal`,
					effective_range: { start: '2026-01-16', end: null },
					status: { kind: 'NOT_REGISTERED', reason: 'Coverage ended' }
				});
			}
		}
	);
	expectStatutory(book, 'WITHDRAWAL', 'LI', 461, 1614);
});

test('Taiwan — deferred joining wages retain the joining month insurance liability', () => {
	const world = createStatutoryWorld({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{ key: 'DEFERRED', wage: 34800, hire_date: '2026-01-25', registrations: registrations() }
		]
	});
	const build = (period: string) =>
		buildPayrollRun(
			Effect.runSync(
				gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
			)
		);
	const january = build('2026-01');
	const slip = january.payslip_payroll_run[0];
	assert.ok(slip, 'The deferred wage month must retain its own statutory assessment.');
	assert.equal(slip.gross, 0);
	for (const [code, employee, employer] of [
		['LI', 160, 560],
		['EI', 14, 49],
		['NHI', 540, 1684],
		['OCC_INJURY', 0, 17],
		['LABOR_PENSION', 0, 418]
	] as const) {
		const row = slip.statutory.find((entry) => entry.scheme_code === code)!;
		assert.deepEqual([row.employee_amount, row.employer_amount], [employee, employer], code);
	}
	assert.equal(slip.unfunded_contributions, 714);
	assert.equal(slip.net, 0);
	world.payroll_runs.push({
		id: 'JAN-INSURANCE',
		company_id: COMPANY_ID,
		period: '2026-01',
		company_charges: january.company_charges
	});
	world.payslips.push({ ...slip, payroll_run_id: 'JAN-INSURANCE', paid_at: null });
	const february = build('2026-02').payslip_payroll_run[0]!;
	// The seven calendar days of January wage settle in February, but its six insurance
	// days were already assessed in January and do not recur in February's premiums.
	assert.equal(february.gross, 42658.06);
	assert.equal(february.statutory.find((row) => row.scheme_code === 'LI')!.employee_amount, 800);
	assert.equal(february.statutory.find((row) => row.scheme_code === 'EI')!.employee_amount, 70);
	assert.equal(february.statutory.find((row) => row.scheme_code === 'NHI')!.employee_amount, 540);
	assert.equal(february.unfunded_contributions, 0);
	assert.equal(february.net, 41248.06);
});

test('Taiwan — occupational accident premium rounds only after covered-day proration', () => {
	// Occupational Accident Insurance Enforcement Rules article 2(3), and BLI's 30-day
	// premium formula: 29,500 × 0.25% × 14/30 = 34.4166… → NT$34 (not round(74 ×14/30)).
	const book = assessStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				{ key: 'JOINER', wage: 29500, hire_date: '2026-01-17', registrations: registrations(29500) }
			]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
		}
	);
	expectStatutory(book, 'JOINER', 'OCC_INJURY', 0, 34);
});

for (const [period, exit] of [
	['2026-01', '2026-01-15'],
	['2026-03', '2026-01-15']
])
	test(`Taiwan — ${period} departure bonus retains the withdrawal-month NHI grade`, () => {
		// NHI: https://www.nhi.gov.tw/ch/cp-2985-e7319-3150-1.html. The threshold remains
		// four times the withdrawal-month amount even when the payment follows departure.
		const { slips } = buildStatutory(
			{
				code: 'TW',
				period: period!,
				riskClass: '1',
				people: [{ key: 'LEAVER', wage: 60000, exit_date: exit!, registrations: registrations() }]
			},
			(world) => {
				world.companies[0]!.pay_cutoff_day = 1;
				const version = world.jurisdiction_settings.find((row) =>
					String(row.effective_range.start).startsWith('2026-01')
				)!;
				const bonus = world.adhoc_catalogue!.find(
					(row) => row.code === 'bonus' && row.settings_id === version.id
				)!;
				world.adhoc_requests!.push({
					id: 'd3000000-0000-4000-8000-000000008801',
					employment_id: world.employments[0]!.id,
					catalogue_id: bonus.id,
					amount: 150000,
					event_date: `${period}-15`,
					pay_period: null,
					payslip_id: null,
					reason: 'Departure bonus',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		);
		const supplement = slips
			.get('LEAVER')!
			.statutory.find((row) => row.scheme_code === 'NHI_SUPPLEMENT')!;
		// (150,000 − 34,800 ×4) ×2.11% =227.88 →228; no ordinary NHI is due at this employer.
		assert.equal(supplement.employee_amount, 228);
		assert.equal(
			slips.get('LEAVER')!.statutory.find((row) => row.scheme_code === 'NHI'),
			undefined
		);
	});

test('Taiwan — a single bonus supplementary premium is capped at NT$10 million of excess', () => {
	// NHI's 114.01 guidance, page15: each payment's assessable excess is capped at NT$10m.
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [{ key: 'BONUS-CAP', wage: 60000, registrations: registrations() }]
		},
		(world) => {
			const version = world.jurisdiction_settings.find((row) =>
				String(row.effective_range.start).startsWith('2026-01')
			)!;
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === version.id
			)!;
			world.adhoc_requests!.push({
				id: 'd3000000-0000-4000-8000-000000008802',
				employment_id: world.employments[0]!.id,
				catalogue_id: bonus.id,
				amount: 20000000,
				event_date: '2026-01-15',
				pay_period: null,
				payslip_id: null,
				reason: 'Annual bonus',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	assert.equal(
		slips.get('BONUS-CAP')!.statutory.find((row) => row.scheme_code === 'NHI_SUPPLEMENT')!
			.employee_amount,
		211000
	);
});

test('Taiwan — a bonus after a new-year grade change retains the previous-year withdrawal grade', () => {
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				{
					key: 'PRIOR-YEAR-LEAVER',
					wage: 28590,
					exit_date: '2025-12-15',
					registrations: registrations(28590)
				}
			]
		},
		(world) => {
			const version = world.jurisdiction_settings.find((row) =>
				String(row.effective_range.start).startsWith('2026-01')
			)!;
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === version.id
			)!;
			world.adhoc_requests!.push({
				id: 'd3000000-0000-4000-8000-000000008803',
				employment_id: world.employments[0]!.id,
				catalogue_id: bonus.id,
				amount: 150000,
				event_date: '2026-01-15',
				pay_period: null,
				payslip_id: null,
				reason: 'Prior-year departure bonus',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	// (150,000 − 28,590 ×4) ×2.11% =752.004 →752.
	assert.equal(
		slips.get('PRIOR-YEAR-LEAVER')!.statutory.find((row) => row.scheme_code === 'NHI_SUPPLEMENT')!
			.employee_amount,
		752
	);
});

test('Taiwan — an obsolete NHI grade cannot charge a currently insured worker', () => {
	assert.throws(
		() =>
			assessStatutory({
				code: 'TW',
				period: '2026-01',
				riskClass: '1',
				people: [
					{
						key: 'CURRENT',
						wage: 30000,
						registrations: {
							...registrations(),
							NHI: {
								kind: 'REGISTERED',
								elections: { insured_amount: 28590, enrolled_dependants: 0 }
							}
						}
					}
				]
			}),
		/declared insured amount is not a grade in force/
	);
});
