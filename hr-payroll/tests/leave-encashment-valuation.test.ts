import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { createStatutoryWorld, COMPANY_ID, leaveCatalogue } from './fixtures/statutory-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { addUnpaidWorkingDays } from './fixtures/unpaid-leave.ts';
import { gatherPayrollRun, buildPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { leaveEncashmentRate } from '../src/lib/leave/encashment-rate.ts';
import { workRulesValueSchema } from '../src/datatypes/work_rules/+definition.ts';

const id = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function cashWorld(
	code: Parameters<typeof createStatutoryWorld>[0]['code'],
	salary: number,
	conversion = '2026-06-30',
	period = '2026-06',
	payFrequency: 'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY' = 'MONTHLY'
) {
	const world = createStatutoryWorld({
		code,
		period,
		payFrequency,
		riskClass: '1',
		region: code === 'VN' ? 'I' : null,
		people: [{ key: 'LEAVE-PAY', wage: salary, pay_frequency: payFrequency }]
	});
	const version = world.jurisdiction_settings.find(
		(row) =>
			String(row.effective_range.start).slice(0, 10) <= conversion &&
			String(row.effective_range.end).slice(0, 10) > conversion
	)!;
	world.leave_catalogue.push(...leaveCatalogue(code).map((row) => ({ ...row, approval_id: null })));
	const catalogue = world.leave_catalogue.find(
		(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
	)!;
	world.leave_entries.push({
		id: id(1),
		employment_id: world.employments[0]!.id,
		catalogue_id: catalogue.id,
		leave_code: catalogue.code,
		reference: 'LEGAL-VALUATION',
		from_date: '2026-01-01',
		to_date: '2026-12-31',
		days: 1.5,
		encash_days: 1.5,
		effective_on: conversion,
		due_on: `${period.slice(0, 7)}-30`,
		charges: [],
		allocations: [],
		approval_id: null,
		payslip_id: null,
		as_adjustment_entry: false
	} as never);
	return world;
}
/**
 * An approved normal-wage record for a whole month no payslip in the world settled (TW 施行細則
 * §24-1 reads the latest month's normal-hours wages; the payslips are the record where they exist).
 */
function recordNormalWages(world: ReturnType<typeof cashWorld>, month: string, value: number) {
	const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
		.toISOString()
		.slice(0, 10);
	world.employment_wage_periods = [
		...(world.employment_wage_periods ?? []),
		{
			id: `${id(900).slice(0, -6)}${month.replace('-', '')}`,
			employment_id: world.employments[0]!.id,
			period: { start: `${month}-01`, end },
			normal_wages: { currency: 'TWD', value },
			ordinary_wages: null,
			ordinary_days: null,
			due_on: end,
			paid_on: null,
			reference: `WAGE-RECORD ${month}`,
			approval_id: null
		} as never
	];
}
function payslip(world: ReturnType<typeof cashWorld>, period = '2026-06') {
	const prepared = Effect.runSync(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
	);
	return buildPayrollRun(prepared).payslip_payroll_run[0]!;
}
function amount(world: ReturnType<typeof cashWorld>, period = '2026-06') {
	return payslip(world, period).adjustments.find(
		(row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT'
	)!.amount;
}

function dailyRate(world: ReturnType<typeof cashWorld>, period: string) {
	const prepared = Effect.runSync(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
	);
	const bundle = prepared.gathered.bundles[0]!;
	return leaveEncashmentRate({
		bundle,
		configuration: prepared.configuration,
		entry: bundle.leave.entries.find((entry) => entry.id === id(1))!
	});
}

for (const [conversion, referenceMonth, expected] of [
	['2026-07-20', 'June', 1_000],
	['2026-08-01', 'July', 2_000]
] as const)
	test(`TW: ${conversion} cash-out uses the normal monthly wage due for ${referenceMonth}`, () => {
		const period = conversion.slice(0, 7);
		const world = cashWorld('TW', 30_000, conversion, period);
		const old = world.employment_terms[0]!;
		old.effective_range = { start: '2000-01-01', end: '2026-06-30' };
		world.employment_terms.push({
			...old,
			id: id(301),
			effective_range: { start: '2026-07-01', end: '2026-07-31' },
			base_salary: { currency: 'TWD', value: 60_000 }
		} as never);
		world.employment_terms.push({
			...old,
			id: id(302),
			effective_range: { start: '2026-08-01', end: null },
			base_salary: { currency: 'TWD', value: 90_000 }
		} as never);
		// No earlier payslip stands in this world, so the months are recorded: June 30,000 (due
		// 30 June), July 60,000 (due 31 July). 20 July reads June (30,000 / 30 = 1,000); 1 August
		// reads July (60,000 / 30 = 2,000).
		recordNormalWages(world, '2026-06', 30_000);
		recordNormalWages(world, '2026-07', 60_000);
		assert.equal(dailyRate(world, period), expected);
	});

test('TW: carried leave preserves December normal wages when a raise began in December', () => {
	const world = cashWorld('TW', 30_000);
	const old = world.employment_terms[0]!;
	old.effective_range = { start: '2000-01-01', end: '2025-11-30' };
	world.employment_terms.push({
		...old,
		id: id(303),
		effective_range: { start: '2025-12-01', end: '2025-12-31' },
		base_salary: { currency: 'TWD', value: 60_000 }
	} as never);
	world.employment_terms.push({
		...old,
		id: id(304),
		effective_range: { start: '2026-01-01', end: null },
		base_salary: { currency: 'TWD', value: 90_000 }
	} as never);
	world.leave_entries[0]!.from_date = '2025-01-01';
	world.leave_entries[0]!.to_date = '2025-12-31';
	// The 2025 year ends 31 December: December's recorded 60,000 / 30 × 1.5 = 3,000.
	recordNormalWages(world, '2025-12', 60_000);
	assert.equal(amount(world), 3_000);
});

for (const frequency of ['DAILY', 'HOURLY'] as const)
	test(`TW: ${frequency} cash-out retains normal wages on the day before conversion`, () => {
		const world = cashWorld('TW', frequency === 'DAILY' ? 800 : 200, '2026-07-20', '2026-07');
		const old = world.employment_terms[0]!;
		old.pay_frequency = frequency;
		old.ordinary_hours_per_week = 20;
		old.effective_range = { start: '2000-01-01', end: '2026-07-19' };
		world.employment_terms.push({
			...old,
			id: id(305),
			effective_range: { start: '2026-07-20', end: null },
			base_salary: { currency: 'TWD', value: frequency === 'DAILY' ? 1_600 : 400 }
		} as never);
		assert.equal(dailyRate(world, '2026-07'), 800);
	});

test('leave cash-out policy evidence cannot be blank', () => {
	const rules = cashWorld('SG', 3_000).jurisdiction_settings[0]!.work_rules;
	const invalid = { ...rules, encashment: { ...rules.encashment!, authority: ' \n\t ' } };
	assert.throws(() => Schema.decodeUnknownSync(workRulesValueSchema)(invalid), /authority/i);
});

for (const changed of ['salary', 'allowance'] as const)
	test(`TW: a ${changed} change within the reference month requires its actual wage record`, () => {
		const world = cashWorld('TW', 30_000, '2026-07-20', '2026-07');
		const old = world.employment_terms[0]!;
		old.effective_range = { start: '2000-01-01', end: '2026-06-15' };
		const newer = {
			...old,
			id: id(306),
			effective_range: { start: '2026-06-16', end: null },
			base_salary: { currency: 'TWD', value: changed === 'salary' ? 60_000 : 30_000 }
		};
		if (changed === 'allowance') {
			for (const version of world.jurisdiction_settings)
				version.work_rules.encashment!.include_allowances = ['SHIFT'];
			world.allowance_catalogue.push({
				id: id(307),
				settings_id: world.jurisdiction_settings.at(-1)!.id,
				code: 'SHIFT',
				name: 'Shift allowance',
				destination: 'PAY',
				direction: 'ADD',
				eligibility: '',
				counts_toward: [],
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				approval_id: null
			} as never);
			newer.allowances = [{ catalogue_id: id(307), amount: 3_000 }];
		}
		world.employment_terms.push(newer as never);
		// §24-1 reads June's normal-hours wages as earned, which the contract alone cannot state:
		// with no payslip or record for June the cash-out stops and says so.
		assert.throws(
			() => dailyRate(world, '2026-07'),
			/complete monthly wage period received or due before 2026-07-20/
		);
		// June recorded as earned: salary 30,000 × 15/30 + 60,000 × 15/30 = 45,000 → 1,500 a day;
		// allowance 30,000 + 3,000 × 15/30 = 31,500 → 1,050 a day.
		recordNormalWages(world, '2026-06', changed === 'salary' ? 45_000 : 31_500);
		assert.equal(dailyRate(world, '2026-07'), changed === 'salary' ? 1_500 : 1_050);
	});

for (const unpaidDays of [14, 22])
	test(`VN cash-out preserves the agreed insurance base with ${unpaidDays} unpaid working days`, () => {
		const world = cashWorld('VN', 22000000);
		world.companies[0]!.pay_cutoff_day = 1;
		addUnpaidWorkingDays(world, '2026-06', unpaidDays);
		const ids = new Set(
			world.statutory_contributions.filter((row) => row.code === 'SI').map((row) => row.id)
		);
		for (const fact of world.employment_statutory_facts)
			if (ids.has(fact.statutory_contribution_id) && fact.status.kind === 'REGISTERED')
				fact.status.elections = {
					continue_si_unpaid: true,
					continued_si_base: 17000000,
					continued_si_reference: 'UNPAID-AGREEMENT'
				};
		const slip = payslip(world);
		assert.ok(
			slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')!.amount > 0
		);
		const si = slip.statutory.find((row) => row.scheme_code === 'SI')!;
		assert.deepEqual(
			[si.base_amount, si.employee_amount, si.employer_amount],
			[17000000, 1360000, 2975000]
		);
		if (unpaidDays === 22) {
			assert.deepEqual(
				[slip.gross, slip.total_deductions, slip.unfunded_contributions, slip.net],
				[1571429, 1615000, 43571, 0]
			);
		}
	});

test('delayed cash-out validates entity declarations under the conversion-date version', () => {
	const world = cashWorld('SG', 3000, '2025-12-31');
	for (const version of world.jurisdiction_settings) {
		const prior = String(version.effective_range.start).slice(0, 10) < '2026-01-01';
		version.facts = [
			{
				key: 'conversion_declaration',
				type: 'number',
				label: 'Conversion declaration',
				...(prior
					? { required_when: 'company.pay_frequency == "MONTHLY"', minimum: 1 }
					: { default_value: 1 })
			}
		];
	}
	world.companies[0]!.facts = {};
	assert.throws(() => amount(world), /Conversion declaration is required/);
	world.companies[0]!.facts = { conversion_declaration: 0 };
	assert.throws(() => amount(world), /Conversion declaration must be at least 1/);
	world.companies[0]!.facts = { conversion_declaration: 1 };
	assert.equal(amount(world), 207.69);
});

// Expected awards are independently calculated from the cited daily-rate definitions.
test('SG: 3,000 × 12 / (52 × 5) × 1.5 rounds once to 207.69 (MOM gross daily rate)', () => {
	assert.equal(amount(cashWorld('SG', 3000)), 207.69);
});
test('MY: 2,601 / 26 × 1.5 rounds once to 150.06 (EA 60I)', () => {
	assert.equal(amount(cashWorld('MY', 2601)), 150.06);
});

for (const code of ['MY', 'MY-nihon'] as const) {
	test(`${code}: weekly leave pay uses wages / 6 and monthly allowances / 26`, () => {
		const world = cashWorld(code, 601, '2026-06-28', '2026-06-4', 'WEEKLY');
		world.leave_entries[0]!.due_on = '2026-06-28';
		// Employment Act 60I(1B): weekly basic / 6, regardless of a five-day roster.
		assert.equal(amount(world, '2026-06-4'), 150.25);
		world.employment_terms[0]!.allowances = [
			{ catalogue_id: world.allowance_catalogue.find((row) => row.code === 'SUA')!.id, amount: 260 }
		];
		// The allowance is a monthly contract amount: 260 / 26, not 260 / 6.
		assert.equal(amount(world, '2026-06-4'), 165.25);
	});

	test(`${code}: delayed weekly cash-out retains conversion-date basic and allowances`, () => {
		const world = cashWorld(code, 601, '2026-06-28', '2026-07-1', 'WEEKLY');
		world.leave_entries[0]!.due_on = '2026-07-05';
		const old = world.employment_terms[0]!;
		old.allowances = [
			{ catalogue_id: world.allowance_catalogue.find((row) => row.code === 'SUA')!.id, amount: 260 }
		];
		world.employment_terms.push({
			...old,
			id: id(5),
			effective_range: { start: '2026-07-01', end: null },
			base_salary: { currency: 'MYR', value: 1202 },
			allowances: [{ ...old.allowances[0]!, amount: 520 }]
		} as never);
		old.effective_range = { start: '2000-01-01', end: '2026-06-30' };
		assert.equal(amount(world, '2026-07-1'), 165.25);
		// Current weekly allowance follows both dated monthly rates; cash-out retains June's rate.
		const paid = payslip(world, '2026-07-1');
		assert.equal(
			paid.base.find((row) => row.component_code === 'SUA')!.amount,
			101.2,
			JSON.stringify(paid.proration)
		);
	});
}

test('weekly payroll prorates monthly allowances across both calendar months', () => {
	const world = cashWorld('MY', 601, '2026-06-28', '2026-07-1', 'WEEKLY');
	world.leave_entries = [];
	world.employment_terms[0]!.allowances = [
		{ catalogue_id: world.allowance_catalogue.find((row) => row.code === 'SUA')!.id, amount: 260 }
	];
	const slip = payslip(world, '2026-07-1');
	// June 29–July 5: 260 × (2/30 + 5/31) = 59.27; basic remains one weekly amount.
	assert.equal(slip.base.find((row) => row.component_code === 'BASIC')!.amount, 601);
	assert.equal(slip.base.find((row) => row.component_code === 'SUA')!.amount, 59.27);
});

test('MY: TP1 relief applies to normal and additional remuneration when unused leave is paid', () => {
	const world = cashWorld('MY', 5001, '2026-01-31', '2026-01');
	world.employment_terms[0]!.residency_status = 'CITIZEN';
	const pcbIds = new Set(
		world.statutory_contributions.filter((row) => row.code === 'PCB').map((row) => row.id)
	);
	const foreignIds = new Set(
		world.statutory_contributions
			.filter((row) => row.code === 'EPF_NON_CITIZEN')
			.map((row) => row.id)
	);
	for (const fact of world.employment_statutory_facts) {
		if (foreignIds.has(fact.statutory_contribution_id))
			fact.status = { kind: 'NOT_REGISTERED', reason: 'Citizen: Part F does not apply.' };
		if (pcbIds.has(fact.statutory_contribution_id) && fact.status.kind === 'REGISTERED')
			fact.status.deduction_claims = [
				{
					period: '2026-01',
					category: 'LIFESTYLE',
					amount: 2500,
					source: 'EMPLOYEE',
					reference: 'Synthetic TP1'
				}
			];
	}
	const prepared = Effect.runSync(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	const slip = buildPayrollRun(prepared).payslip_payroll_run[0]!;
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')!.amount,
		288.52
	);
	// Normal projected chargeable income: 60,012 - 4,000 - 36.75 - 9,000 - 2,500 = 44,475.25.
	// Normal MTD 97.40. Additional tax: 1,185.8262 - 12×97.40 = 17.0262 → 17.05.
	assert.equal(slip.statutory.find((row) => row.scheme_code === 'PCB')!.employee_amount, 114.45);
});
test('TW: 60,001 / 30 × 1.5 rounds once to 3,000.05 (Enforcement Rules 24-1)', () => {
	// Converted on 30 June: June is not yet due, so May's recorded 60,001 is the latest month.
	const world = cashWorld('TW', 60001);
	recordNormalWages(world, '2026-05', 60_001);
	assert.equal(amount(world), 3000.05);
});
test('a later payment uses conversion-date terms, not the settlement month salary', () => {
	const world = cashWorld('SG', 3000, '2026-05-31');
	const old = world.employment_terms[0]!;
	world.employment_terms.push({
		...old,
		id: id(2),
		effective_range: { start: '2026-06-01', end: null },
		base_salary: { currency: 'SGD', value: 6000 }
	} as never);
	old.effective_range = { start: '2000-01-01', end: '2026-05-31T23:59:59.999Z' };
	assert.equal(amount(world), 207.69);
});
test('missing leave valuation rules stop payroll instead of substituting the overtime rate', () => {
	const world = cashWorld('SG', 3000);
	for (const row of world.jurisdiction_settings) delete row.work_rules.encashment;
	assert.throws(() => amount(world), /no verified valuation rule/);
});

test('SG gross pay includes a qualifying wage allowance and excludes food reimbursement', () => {
	const world = cashWorld('SG', 3000);
	for (const version of world.jurisdiction_settings) {
		version.work_rules.encashment!.include_allowances = ['SHIFT'];
		version.work_rules.encashment!.exclude_allowances = ['FOOD'];
		for (const [index, code] of ['SHIFT', 'FOOD'].entries())
			world.allowance_catalogue.push({
				id: id(100 + world.allowance_catalogue.length),
				settings_id: version.id,
				code,
				name: code,
				destination: 'PAY',
				direction: 'ADD',
				eligibility: '',
				counts_toward: [],
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				approval_id: null
			} as never);
	}
	world.employment_terms[0]!.allowances = [
		{
			catalogue_id: world.allowance_catalogue.find((row) => row.code === 'SHIFT')!.id,
			amount: 250
		},
		{ catalogue_id: world.allowance_catalogue.find((row) => row.code === 'FOOD')!.id, amount: 500 }
	];
	// (3,000 + 250) × 12 / 260 × 1.5 = 225.00; the excluded 500 never enters the rate.
	assert.equal(amount(world), 225);
	for (const version of world.jurisdiction_settings)
		version.work_rules.encashment!.exclude_allowances = [];
	assert.throws(() => amount(world), /classification for allowance FOOD/);
});

test('MY fixed normal-hours allowances enter the section 60I monthly wage', () => {
	const world = cashWorld('MY-nihon', 2600);
	world.employment_terms[0]!.allowances = [
		{ catalogue_id: world.allowance_catalogue.find((row) => row.code === 'SUA')!.id, amount: 260 }
	];
	assert.equal(amount(world), 165);
});

test('VN uses May contract salary and May normal working days for a June exit', () => {
	const world = cashWorld('VN', 22000000);
	const old = world.employment_terms[0]!;
	world.employment_terms.push({
		...old,
		id: id(3),
		effective_range: { start: '2026-06-01', end: null },
		base_salary: { currency: 'VND', value: 44000000 }
	} as never);
	old.effective_range = { start: '2000-01-01', end: '2026-05-31T23:59:59.999Z' };
	// May 2026 has 21 Monday–Friday days. 22,000,000 / 21 × 1.5 = 1,571,428.571… đồng.
	assert.equal(amount(world), 1571429);
});

test('a daily rate without its preceding wage period is refused by name', () => {
	const world = cashWorld('MY', 100);
	world.employment_terms[0]!.pay_frequency = 'DAILY';
	// s.60I(1C) prices a daily rate from the preceding complete wage period; without that
	// record the conversion stops rather than falling back to an unrelated divisor.
	assert.throws(() => amount(world), /Ordinary rate requires the wage period ending 2026-05-31/);
});

test('ID blocks cash-out until the entity records its PK/PP/PKB daily basis', () => {
	// UU 13/2003 art.79(4) as amended defers the leave basis to the PK, PP or PKB; see round4-L.
	const world = cashWorld('ID', 6000000);
	assert.throws(() => amount(world), /Leave cash-out daily divisor is required before calculation/);
});

test('TW carried leave retains the original year-end salary despite a later increase', () => {
	const world = cashWorld('TW', 30_000);
	const old = world.employment_terms[0]!;
	world.employment_terms.push({
		...old,
		id: id(4),
		effective_range: { start: '2026-01-01', end: null },
		base_salary: { currency: 'TWD', value: 60_000 }
	} as never);
	old.effective_range = { start: '2000-01-01', end: '2025-12-31T23:59:59.999Z' };
	world.leave_entries[0]!.from_date = '2025-01-01';
	world.leave_entries[0]!.to_date = '2025-12-31';
	// December 2025's recorded 30,000 / 30 × 1.5 = 1,500, not the 2026 salary.
	recordNormalWages(world, '2025-12', 30_000);
	recordNormalWages(world, '2026-05', 60_000);
	assert.equal(amount(world), 1500);
});

test('TW current-year cash-out separates carried credit from current entitlement', () => {
	const world = cashWorld('TW', 30_000);
	const old = world.employment_terms[0]!;
	world.employment_terms.push({
		...old,
		id: id(5),
		effective_range: { start: '2026-01-01', end: null },
		base_salary: { currency: 'TWD', value: 60_000 }
	} as never);
	old.effective_range = { start: '2000-01-01', end: '2025-12-31T23:59:59.999Z' };
	const entry = world.leave_entries[0]!;
	world.leave_entries.push({
		...entry,
		id: id(6),
		reference: 'CARRY-2025',
		from_date: '2025-01-01',
		to_date: '2025-12-31',
		days: 1,
		encash_days: null,
		effective_on: null,
		due_on: null,
		destination_from: '2026-01-01',
		destination_to: '2026-12-31',
		available_from: '2026-01-01',
		expires_on: '2026-12-31',
		allocations: []
	} as never);
	entry.allocations = [
		{
			window: { start: '2026-01-01', end: '2026-12-31' },
			date: '2026-06-30',
			days: -1,
			credit_entry_id: id(6)
		},
		{
			window: { start: '2026-01-01', end: '2026-12-31' },
			date: '2026-06-30',
			days: -0.5,
			credit_entry_id: null
		}
	];
	// One carried day at December 2025's 30,000 / 30 plus half a current day at May 2026's
	// 60,000 / 30 (the latest month due before the 30 June conversion).
	recordNormalWages(world, '2025-12', 30_000);
	recordNormalWages(world, '2026-05', 60_000);
	assert.equal(amount(world), 2000);
});

test('MY semi-monthly cash-out uses the monthly salary unit without doubling it', () => {
	assert.equal(
		amount(cashWorld('MY', 2601, '2026-06-30', '2026-06-2', 'SEMI_MONTHLY'), '2026-06-2'),
		150.06
	);
});

for (const code of ['MY', 'MY-nihon'] as const) {
	test(`${code}: encashment tax below RM10 is exempt independently of normal MTD`, () => {
		// LHDN MTD 2026, section E(3–5), pp.19–20: the RM10 minimum applies separately
		// to normal and additional remuneration. Normal annual tax is RM1,318.599:
		// 60,012 − 4,000 EPF − 35.35 SOCSO/EIS − 9,000 personal = 46,976.65.
		// Normal MTD = 109.90. Half a leave day = 5,001 / 26 / 2 = 96.17;
		// its additional tax is below RM10 and must not increase the deduction.
		const world = cashWorld(code, 5001, '2026-01-20', '2026-01');
		world.leave_entries[0]!.days = 0.5;
		world.leave_entries[0]!.encash_days = 0.5;
		const prepared = Effect.runSync(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
		);
		const slip = buildPayrollRun(prepared).payslip_payroll_run[0]!;
		assert.equal(
			slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')!.amount,
			96.17
		);
		assert.equal(slip.statutory.find((row) => row.scheme_code === 'PCB')!.employee_amount, 109.9);
	});
}
