import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { createStatutoryWorld, COMPANY_ID, leaveCatalogue } from './fixtures/statutory-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { prepareWorkContext } from '../src/lib/payroll/work.ts';
import { leaveEncashmentRate } from '../src/lib/leave/encashment-rate.ts';
import {
	previousWagePeriodOrdinaryRate,
	type ReferenceWagePeriod
} from '../src/lib/payroll/reference-wages.ts';

const id = (n: number) => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERIOD_ID = id(900);

/** A MY daily-rated world whose version refers to dated wage history for the ordinary rate. */
function referenceWorld(options: { withPeriod?: boolean } = {}) {
	const world = createStatutoryWorld({
		code: 'MY',
		period: '2026-06',
		payFrequency: 'MONTHLY',
		riskClass: '1',
		region: null,
		people: [{ key: 'REF-WAGE', wage: 100, pay_frequency: 'DAILY' }]
	});
	const version = world.jurisdiction_settings.find(
		(row) =>
			String(row.effective_range.start).slice(0, 10) <= '2026-06-30' &&
			String(row.effective_range.end).slice(0, 10) > '2026-06-30'
	)!;
	world.leave_catalogue.push(...leaveCatalogue('MY').map((row) => ({ ...row, approval_id: null })));
	const catalogue = world.leave_catalogue.find(
		(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
	)!;
	world.leave_entries.push({
		id: id(1),
		employment_id: world.employments[0]!.id,
		catalogue_id: catalogue.id,
		leave_code: catalogue.code,
		reference: 'REFERENCE-WAGE',
		from_date: '2026-01-01',
		to_date: '2026-12-31',
		days: 1.5,
		encash_days: 1.5,
		effective_on: '2026-06-30',
		due_on: '2026-06-30',
		charges: [],
		allocations: [],
		approval_id: null,
		payslip_id: null,
		as_adjustment_entry: false
	} as never);
	// The mechanism test declares its own profile: the sealed MY profile still refuses DAILY until
	// the statutory basis is verified for production.
	const workRules = version.work_rules as Record<string, any>;
	workRules.ordinary_rate_reference = {
		reference: 'PREVIOUS_WAGE_PERIOD',
		pay_frequencies: ['DAILY', 'HOURLY'],
		authority: 'Employment Act 1955 s.60I(1C) (mechanism test)'
	};
	workRules.encashment.pay_frequencies = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'];
	world.employment_wage_periods = [];
	if (options.withPeriod !== false)
		world.employment_wage_periods.push({
			id: PERIOD_ID,
			employment_id: world.employments[0]!.id,
			period: { start: '2026-05-01', end: '2026-05-31T00:00:00.000Z' },
			normal_wages: null,
			ordinary_wages: { currency: 'MYR', value: 2310 },
			ordinary_days: 21,
			due_on: '2026-06-07',
			paid_on: '2026-06-07',
			reference: 'PAYSLIP 2026-05',
			approval_id: null
		} as never);
	return world;
}

function preparedRun(world: ReturnType<typeof referenceWorld>) {
	return Effect.runSync(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-06' })
	);
}

test('MY daily cash-out prices from the preceding wage period, not the current contract', () => {
	const world = referenceWorld();
	const prepared = preparedRun(world);
	const bundle = prepared.gathered.bundles[0]!;
	const consumed = new Set<string>();
	const rate = leaveEncashmentRate({
		bundle,
		configuration: prepared.configuration,
		entry: bundle.leave.entries.find((entry) => entry.id === id(1))!,
		referenceWageIds: consumed
	});
	// 2,310 / 21 qualifying days, not the contract's MYR 100.
	assert.equal(rate, 110);
	assert.deepEqual([...consumed], [PERIOD_ID]);
});

test('MY daily cash-out refuses a missing adjacent wage period by name', () => {
	const world = referenceWorld({ withPeriod: false });
	const prepared = preparedRun(world);
	const bundle = prepared.gathered.bundles[0]!;
	assert.throws(
		() =>
			leaveEncashmentRate({
				bundle,
				configuration: prepared.configuration,
				entry: bundle.leave.entries.find((entry) => entry.id === id(1))!
			}),
		/Ordinary rate requires the wage period ending 2026-05-31/
	);
});

test('the work context prices the ordinary day from the same record', () => {
	const world = referenceWorld();
	const prepared = preparedRun(world);
	const consumed = new Set<string>();
	const work = prepareWorkContext({
		bundle: prepared.gathered.bundles[0]!,
		configuration: prepared.configuration,
		salary: prepared.window.salary,
		employed: prepared.window.salary,
		referenceWageIds: consumed
	});
	assert.equal(work.ratesOn('2026-06-15').dayWage, 110);
	assert.deepEqual([...consumed], [PERIOD_ID]);
});

test('the selector rejects non-adjacent and ambiguous periods', () => {
	const row = (id: string, end: string, value: number): ReferenceWagePeriod => ({
		id,
		period: { start: '2026-05-01', end },
		normal_wages: null,
		ordinary_wages: { currency: 'MYR', value },
		ordinary_days: 21,
		due_on: '2026-06-07',
		paid_on: null,
		reference: 'PAYSLIP',
		approval_id: null
	});
	assert.throws(
		() =>
			previousWagePeriodOrdinaryRate({
				periods: [row('row-30', '2026-05-30T00:00:00.000Z', 1000)],
				currentPeriodStart: '2026-06-01',
				currency: 'MYR'
			}),
		/requires the wage period ending 2026-05-31/
	);
	assert.throws(
		() =>
			previousWagePeriodOrdinaryRate({
				periods: [
					row('row-a', '2026-05-31T00:00:00.000Z', 1000),
					row('row-b', '2026-05-31T00:00:00.000Z', 2000)
				],
				currentPeriodStart: '2026-06-01',
				currency: 'MYR'
			}),
		/ambiguous wage periods ending 2026-05-31/
	);
	assert.equal(
		previousWagePeriodOrdinaryRate({
			periods: [row('row-31', '2026-05-31T00:00:00.000Z', 2310)],
			currentPeriodStart: '2026-06-01',
			currency: 'MYR'
		}).ordinaryDay,
		110
	);
});

/** A TW monthly world whose version refers to the latest received or matured normal-wage month. */
function normalWageWorld(periods: readonly ReferenceWagePeriod[]) {
	const world = createStatutoryWorld({
		code: 'TW',
		period: '2026-07',
		payFrequency: 'MONTHLY',
		riskClass: '1',
		region: null,
		people: [{ key: 'TW-NORMAL', wage: 90_000, pay_frequency: 'MONTHLY' }]
	});
	const version = world.jurisdiction_settings.find(
		(row) =>
			String(row.effective_range.start).slice(0, 10) <= '2026-07-20' &&
			String(row.effective_range.end).slice(0, 10) > '2026-07-20'
	)!;
	world.leave_catalogue.push(...leaveCatalogue('TW').map((row) => ({ ...row, approval_id: null })));
	const catalogue = world.leave_catalogue.find(
		(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
	)!;
	world.leave_entries.push({
		id: id(2),
		employment_id: world.employments[0]!.id,
		catalogue_id: catalogue.id,
		leave_code: catalogue.code,
		reference: 'TW-NORMAL-WAGE',
		from_date: '2026-01-01',
		to_date: '2026-12-31',
		days: 1,
		encash_days: 1,
		effective_on: '2026-07-20',
		due_on: '2026-07-31',
		charges: [],
		allocations: [],
		approval_id: null,
		payslip_id: null,
		as_adjustment_entry: false
	} as never);
	const workRules = version.work_rules as Record<string, any>;
	workRules.ordinary_rate_reference = {
		reference: 'LATEST_DUE_MONTH',
		pay_frequencies: ['MONTHLY'],
		authority: 'Enforcement Rules art. 24-1 (mechanism test)'
	};
	world.employment_wage_periods = periods.map((row) => ({
		...row,
		employment_id: world.employments[0]!.id
	})) as never;
	return world;
}

function twCashOut(world: ReturnType<typeof normalWageWorld>) {
	const prepared = Effect.runSync(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-07' })
	);
	const bundle = prepared.gathered.bundles[0]!;
	return leaveEncashmentRate({
		bundle,
		configuration: prepared.configuration,
		entry: bundle.leave.entries.find((entry) => entry.id === id(2))!
	});
}

test('TW cash-out selects the latest month received or matured before the boundary', () => {
	const june: ReferenceWagePeriod = {
		id: 'tw-june',
		period: { start: '2026-06-01T00:00:00.000Z', end: '2026-06-30T00:00:00.000Z' },
		normal_wages: { currency: 'TWD', value: 30_000 },
		ordinary_wages: null,
		ordinary_days: null,
		due_on: '2026-07-07',
		paid_on: null,
		reference: 'PAYSLIP 2026-06',
		approval_id: null
	};
	assert.equal(twCashOut(normalWageWorld([june])), 1000);
	// An advance paid before the month's contractual due date is already received.
	const july: ReferenceWagePeriod = {
		...june,
		id: 'tw-july',
		period: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-31T00:00:00.000Z' },
		normal_wages: { currency: 'TWD', value: 60_000 },
		due_on: '2026-08-07',
		paid_on: '2026-07-10'
	};
	assert.equal(twCashOut(normalWageWorld([june, july])), 2000);
});

test('TW cash-out refuses normal wages that have neither matured nor been received', () => {
	const future: ReferenceWagePeriod = {
		id: 'tw-future',
		period: { start: '2026-06-01T00:00:00.000Z', end: '2026-06-30T00:00:00.000Z' },
		normal_wages: { currency: 'TWD', value: 30_000 },
		ordinary_wages: null,
		ordinary_days: null,
		due_on: '2026-07-25',
		paid_on: null,
		reference: 'PAYSLIP 2026-06',
		approval_id: null
	};
	assert.throws(
		() => twCashOut(normalWageWorld([future])),
		/Normal-wage rate requires a complete monthly wage period received or due before 2026-07-20/
	);
});
