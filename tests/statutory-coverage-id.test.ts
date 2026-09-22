import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	assessStatutory,
	buildStatutory,
	chargeOf,
	createStatutoryWorld,
	leaveCatalogue
} from './fixtures/statutory-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { gatherPayrollRun, buildPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';

const uuid = (n: number) => `d1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Governor decrees 561.7/Kep.798-Kesra/2024 and 561.7/Kep.862-Kesra/2025,
// operative tables and commencement clauses; Perpres 82/2018 art.32(2)-(3).
for (const [region, prior, current] of [
	['Kota Bekasi', 5_690_752.95, 5_999_443],
	['Kabupaten Bekasi', 5_558_515.1, 5_938_885],
	['Kota Bandung', 4_482_914.09, 4_737_678],
	['Kabupaten Pangandaran', 2_221_724.19, 2_351_250],
	['Kota Banjar', 2_204_754.48, 2_361_241]
] as const) {
	for (const [period, floor] of [
		['2025-12', prior],
		['2026-01', current],
		['2026-03', current]
	] as const)
		test(`ID ${region}: ${period} Kesehatan uses the workplace UMK`, () => {
			const book = assessStatutory({
				code: 'ID',
				period,
				region,
				riskClass: 'I',
				people: [{ key: 'UMK', wage: 2_000_000, marital_status: 'SINGLE' }]
			});
			const charge = chargeOf(book, 'UMK', 'KESEHATAN');
			assert.equal(charge.employee, Math.round(floor / 100));
			assert.equal(charge.employer, Math.round((floor * 4) / 100));
		});
}

test('ID: a province name cannot select a lower UMP where every city and regency has a UMK', () => {
	assert.throws(
		() =>
			assessStatutory({
				code: 'ID',
				period: '2026-01',
				region: 'Jawa Barat',
				riskClass: 'I',
				people: [{ key: 'PROVINCE', wage: 2_000_000 }]
			}),
		/KESEHATAN bounds its base by the regional minimum wage/
	);
});

type ExitFacts = Readonly<Record<string, string | number | boolean>>;

function separationAmounts(options: {
	readonly facts: ExitFacts;
	readonly wage?: number;
	readonly payFrequency?: 'MONTHLY' | 'DAILY';
	readonly employmentType?: 'PERMANENT' | 'CONTRACT';
	readonly reason?: string;
}) {
	const { slips } = buildStatutory(
		{
			code: 'ID',
			period: '2026-01',
			region: 'DKI Jakarta',
			riskClass: 'I',
			people: [
				{
					key: 'LEAVER',
					employment_type: options.employmentType ?? 'PERMANENT',
					pay_frequency: options.payFrequency ?? 'MONTHLY',
					wage: options.wage ?? 10_000_000,
					hire_date: '2022-01-31',
					exit_date: '2026-01-31',
					exit_reason: options.reason ?? 'DISMISSAL'
				}
			]
		},
		(world) => {
			world.employments[0]!.exit_facts = { thr_holiday_date: HOLIDAY_2026, ...options.facts };
			const version = world.jurisdiction_settings.find((row) =>
				String(row.effective_range.start).startsWith('2026-01')
			)!;
			for (const [offset, code] of [
				'PESANGON',
				'UPMK',
				'UANG_PISAH',
				'PENSION_OFFSET',
				'PKWT_COMPENSATION'
			].entries()) {
				const catalogue = world.adhoc_catalogue!.find(
					(row) => row.settings_id === version.id && row.code === code
				)!;
				world.adhoc_requests!.push({
					id: uuid(200 + offset),
					employment_id: world.employments[0]!.id,
					catalogue_id: catalogue.id,
					amount: 0,
					event_date: '2026-01-31',
					pay_period: '2026-01',
					payslip_id: null,
					reason: code,
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
	const adjustments = slips.get('LEAVER')!.adjustments;
	return Object.fromEntries(
		['PESANGON', 'UPMK', 'UANG_PISAH', 'PENSION_OFFSET', 'PKWT_COMPENSATION'].map((code) => {
			const line = adjustments.find((row) => row.component_code === code);
			return [code, { amount: line?.amount ?? 0, bucket: line?.bucket }];
		})
	);
}

/** Idul Fitri 1447 H (SKB 2026): the religious holiday a January 2026 departure's THR is judged against. */
const HOLIDAY_2026 = '2026-03-21';

const standardFacts = (cause: string, extra: ExitFacts = {}): ExitFacts => ({
	thr_holiday_date: HOLIDAY_2026,
	termination_cause: cause,
	separation_wage_basis: 'MONTHLY',
	micro_small_enterprise: false,
	pension_offset_applies: false,
	...extra
});

for (const [cause, pesangonMultiplier, upmk, separationPay] of [
	['MERGER_CONSOLIDATION_SEPARATION', 1, true, false],
	['ACQUISITION', 1, true, false],
	['ACQUISITION_TERMS_CHANGE_REJECTED', 0.5, true, false],
	['EFFICIENCY_ACTUAL_LOSS', 0.5, true, false],
	['EFFICIENCY_PREVENT_LOSS', 1, true, false],
	['CLOSURE_LOSS', 0.5, true, false],
	['CLOSURE_NO_LOSS', 1, true, false],
	['FORCE_MAJEURE_CLOSURE', 0.5, true, false],
	['FORCE_MAJEURE_NO_CLOSURE', 0.75, true, false],
	['DEBT_SUSPENSION_LOSS', 0.5, true, false],
	['DEBT_SUSPENSION_NO_LOSS', 1, true, false],
	['BANKRUPTCY', 0.5, true, false],
	['EMPLOYEE_REQUEST_EMPLOYER_MISCONDUCT', 1, true, false],
	['EMPLOYEE_REQUEST_REJECTED', 0, false, true],
	['VOLUNTARY_RESIGNATION', 0, false, true],
	['UNEXCUSED_ABSENCE', 0, false, true],
	['VIOLATION_AFTER_WARNINGS', 0.5, true, false],
	['URGENT_VIOLATION', 0, false, true],
	['DETENTION_CAUSED_LOSS', 0, false, true],
	['DETENTION_NO_LOSS', 0, true, false],
	['LONG_ILLNESS_OR_WORK_ACCIDENT_DISABILITY', 2, true, false],
	['RETIREMENT', 1.75, true, false],
	['DEATH', 2, true, false]
] as const)
	test(`ID PP 35 cause ${cause} selects its own termination benefits`, () => {
		const amounts = separationAmounts({
			facts: standardFacts(
				cause,
				separationPay
					? { separation_pay_amount: 3_000_000, separation_pay_reference: 'CBA-2026-1' }
					: {}
			)
		});
		assert.equal(amounts.PESANGON!.amount, 50_000_000 * pesangonMultiplier);
		assert.equal(amounts.UPMK!.amount, upmk ? 20_000_000 : 0);
		assert.equal(amounts.UANG_PISAH!.amount, separationPay ? 3_000_000 : 0);
	});

test('ID detailed cause, not the broad exit reason, determines the multiplier', () => {
	const loss = separationAmounts({
		reason: 'REDUNDANCY',
		facts: standardFacts('EFFICIENCY_ACTUAL_LOSS')
	});
	const prevention = separationAmounts({
		reason: 'REDUNDANCY',
		facts: standardFacts('EFFICIENCY_PREVENT_LOSS')
	});
	assert.equal(loss.PESANGON!.amount, 25_000_000);
	assert.equal(prevention.PESANGON!.amount, 50_000_000);
});

test('ID daily and output-paid separation wage bases follow article 157', () => {
	const daily = separationAmounts({
		wage: 400_000,
		payFrequency: 'DAILY',
		facts: standardFacts('EFFICIENCY_PREVENT_LOSS', {
			separation_wage_basis: 'DAILY',
			separation_daily_wage: 400_000
		})
	});
	assert.equal(daily.PESANGON!.amount, 60_000_000);
	assert.equal(daily.UPMK!.amount, 24_000_000);

	const output = separationAmounts({
		facts: standardFacts('EFFICIENCY_PREVENT_LOSS', {
			separation_wage_basis: 'OUTPUT',
			output_average_12m: 4_000_000
		})
	});
	assert.equal(output.PESANGON!.amount, 28_649_380);
	assert.equal(output.UPMK!.amount, 11_459_752);
});

test('ID pension offset is limited to the statutory and contract-defined obligations', () => {
	const partial = separationAmounts({
		facts: standardFacts('EFFICIENCY_PREVENT_LOSS', {
			pension_offset_applies: true,
			employer_funded_pension_benefit: 15_000_000,
			pension_offset_reference: 'CBA-PENSION-1'
		})
	});
	assert.deepEqual(partial.PENSION_OFFSET, { amount: 15_000_000, bucket: 'DEDUCTION' });

	const capped = separationAmounts({
		facts: standardFacts('EMPLOYEE_REQUEST_REJECTED', {
			separation_pay_amount: 3_000_000,
			separation_pay_reference: 'CBA-2026-1',
			pension_offset_applies: true,
			employer_funded_pension_benefit: 10_000_000,
			pension_offset_reference: 'CBA-PENSION-1'
		})
	});
	assert.equal(capped.PENSION_OFFSET!.amount, 3_000_000);
});

test('ID micro and small enterprise agreement amounts replace statutory schedules', () => {
	const permanent = separationAmounts({
		facts: standardFacts('EFFICIENCY_PREVENT_LOSS', {
			micro_small_enterprise: true,
			micro_small_agreement_reference: 'AGREEMENT-1',
			agreed_pesangon_amount: 12_000_000,
			agreed_upmk_amount: 4_000_000
		})
	});
	assert.equal(permanent.PESANGON!.amount, 12_000_000);
	assert.equal(permanent.UPMK!.amount, 4_000_000);

	const fixed = separationAmounts({
		employmentType: 'CONTRACT',
		reason: 'END_OF_CONTRACT',
		facts: {
			micro_small_enterprise: true,
			micro_small_agreement_reference: 'PKWT-AGREEMENT-1',
			agreed_pkwt_compensation_amount: 7_500_000
		}
	});
	assert.equal(fixed.PKWT_COMPENSATION!.amount, 7_500_000);
});

test('ID fixed-term compensation remains separate from permanent termination benefits', () => {
	const { slips } = buildStatutory(
		{
			code: 'ID',
			period: '2026-01',
			region: 'DKI Jakarta',
			riskClass: 'I',
			people: ['PERMANENT', 'CONTRACT'].map((employment_type) => ({
				key: employment_type,
				employment_type,
				wage: 10_000_000,
				hire_date: '2022-01-31',
				exit_date: '2026-01-31',
				exit_reason: employment_type === 'CONTRACT' ? 'END_OF_CONTRACT' : 'REDUNDANCY'
			}))
		},
		(world) => {
			world.employments[0]!.exit_facts = standardFacts('EFFICIENCY_PREVENT_LOSS');
			world.employments[1]!.exit_facts = {
				micro_small_enterprise: false,
				thr_holiday_date: HOLIDAY_2026
			};
			const version = world.jurisdiction_settings.find((row) =>
				String(row.effective_range.start).startsWith('2026-01')
			)!;
			for (const [index, employment] of world.employments.entries())
				for (const [offset, code] of ['PESANGON', 'UPMK', 'PKWT_COMPENSATION'].entries()) {
					const catalogue = world.adhoc_catalogue!.find(
						(row) => row.settings_id === version.id && row.code === code
					)!;
					world.adhoc_requests!.push({
						id: uuid(index * 10 + offset),
						employment_id: employment.id,
						catalogue_id: catalogue.id,
						amount: 0,
						event_date: '2026-01-31',
						pay_period: '2026-01',
						payslip_id: null,
						reason: code,
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					});
				}
		}
	);
	const amount = (person: string, code: string) =>
		slips.get(person)!.adjustments.find((row) => row.component_code === code)?.amount ?? 0;
	assert.equal(amount('PERMANENT', 'PESANGON'), 50_000_000);
	assert.equal(amount('PERMANENT', 'UPMK'), 20_000_000);
	assert.equal(amount('PERMANENT', 'PKWT_COMPENSATION'), 0);
	assert.equal(amount('CONTRACT', 'PESANGON'), 0);
	assert.equal(amount('CONTRACT', 'UPMK'), 0);
	assert.equal(amount('CONTRACT', 'PKWT_COMPENSATION'), 40_000_000);
});

function contractualCashOut(conversion: string) {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-03',
		region: 'DKI Jakarta',
		riskClass: 'I',
		people: [{ key: 'POLICY', wage: 6_000_000 }]
	});
	// Synthetic employer policies, not a claim that either divisor is prescribed by law.
	// Each policy is part of its sealed, dated jurisdiction profile.
	for (const version of world.jurisdiction_settings)
		version.work_rules.encashment = {
			reference: 'EVENT_DATE',
			day_amount: String(version.effective_range.start).startsWith('2026-03')
				? 'terms.monthly_wage / 25.0'
				: 'terms.monthly_wage / 30.0',
			pay_frequencies: ['MONTHLY', 'SEMI_MONTHLY'],
			include_allowances: ['HOUSE_ALLOWANCE', 'CAR_ALLOWANCE'],
			exclude_allowances: ['SPECIAL_ALLOWANCE'],
			preserve_year_end_rate: false,
			authority: `Synthetic collective agreement ${String(version.effective_range.start).slice(0, 10)}`
		};
	world.leave_catalogue.push(...leaveCatalogue('ID').map((row) => ({ ...row, approval_id: null })));
	const version = world.jurisdiction_settings.find(
		(row) =>
			String(row.effective_range.start).slice(0, 10) <= conversion &&
			String(row.effective_range.end).slice(0, 10) > conversion
	)!;
	const catalogue = world.leave_catalogue.find(
		(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
	)!;
	world.leave_entries.push({
		id: uuid(100),
		employment_id: world.employments[0]!.id,
		catalogue_id: catalogue.id,
		leave_code: catalogue.code,
		reference: 'CONTRACTUAL-CONVERSION',
		from_date: '2026-01-01',
		to_date: '2026-12-31',
		days: 1.5,
		encash_days: 1.5,
		effective_on: conversion,
		due_on: '2026-03-31',
		charges: [],
		allocations: [],
		approval_id: null,
		payslip_id: null,
		as_adjustment_entry: false
	} as never);
	return world;
}

function cashAmount(world: ReturnType<typeof contractualCashOut>) {
	const prepared = Effect.runSync(
		gatherPayrollRun({
			api: memoryPayrollApi(world),
			companyId: world.companies[0]!.id,
			period: '2026-03'
		})
	);
	return buildPayrollRun(prepared).payslip_payroll_run[0]!.adjustments.find(
		(row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT'
	)!.amount;
}

test('ID contractual cash-out retains the conversion-date policy across a later policy change', () => {
	assert.equal(cashAmount(contractualCashOut('2026-02-28')), 300_000);
	assert.equal(cashAmount(contractualCashOut('2026-03-01')), 360_000);
});

test('ID contractual cash-out retains conversion-date salary and explicit allowance classifications', () => {
	const world = contractualCashOut('2026-02-28');
	const prior = world.employment_terms[0]!;
	const catalogue = (code: string) => world.allowance_catalogue.find((row) => row.code === code)!;
	prior.allowances = [
		{ catalogue_id: catalogue('HOUSE_ALLOWANCE').id, amount: 1_000_000 },
		{ catalogue_id: catalogue('SPECIAL_ALLOWANCE').id, amount: 2_000_000 }
	];
	prior.effective_range = { start: '2015-01-01', end: '2026-02-28T23:59:59.999Z' };
	world.employment_terms.push({
		...prior,
		id: uuid(101),
		effective_range: { start: '2026-03-01', end: null },
		base_salary: { currency: 'IDR', value: 12_000_000 },
		allowances: []
	} as never);
	assert.equal(cashAmount(world), 350_000);
});

test('ID contractual cash-out refuses unclassified allowances and unsupported wage bases', () => {
	const world = contractualCashOut('2026-02-28');
	world.employment_terms[0]!.pay_frequency = 'DAILY';
	assert.throws(() => cashAmount(world), /no verified DAILY valuation rule/);
	world.employment_terms[0]!.pay_frequency = 'MONTHLY';
	world.employment_terms[0]!.allowances = [{ catalogue_id: uuid(999), amount: 100 }];
	assert.throws(() => cashAmount(world), /wage-base classification/);
});
