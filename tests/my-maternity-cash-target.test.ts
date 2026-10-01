/** Desired-behaviour reproductions; execution/certification belongs to the parent.
 * Act265 ss37(2)(a)–(c),60I(1)/(1C):
 * https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf
 * Reg2 prescribed daily minimum:
 * https://jtksm.mohr.gov.my/sites/default/files/2023-03/5.%20EMPLOYMENT%20%28MINIMUM%20RATE%20OF%20MATERNITY%20ALLOWANCE%29%20REGULATIONS%201976_0.pdf
 * Qualified female employee: continuously employed since2024, no surviving children,
 * confinement1Jan2026. January records the first31days of the98calendar-day episode.
 * No statutory configuration is overridden.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildStatutory,
	leaveCatalogue,
	settingsIdOn,
	type Person
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { previousWagePeriodOrdinaryRate } from '../src/lib/payroll/history.ts';

const person = (
	key: string,
	wage: number,
	pay_frequency: Person['pay_frequency'] = 'MONTHLY',
	extra: Partial<Person> = {}
): Person => ({
	key,
	wage,
	pay_frequency,
	gender: 'FEMALE',
	citizenship: 'CITIZEN',
	hire_date: '2024-01-01',
	children: 0,
	registrations: { EPF_NON_CITIZEN: { kind: 'NOT_REGISTERED' } },
	...extra
});
function history(world: PayrollWorld, ordinaryWages: number) {
	world.employment_wage_periods ??= [];
	world.employment_wage_periods.push({
		id: 'bb370000-0000-4000-8000-000000000001',
		employment_id: world.employments[0]!.id,
		period: { start: '2025-12-01T00:00:00.000Z', end: '2025-12-31T00:00:00.000Z' },
		currency: 'MYR',
		normal_wages: null,
		ordinary_wages: ordinaryWages,
		ordinary_days: 20,
		due_on: '2026-01-07',
		paid_on: '2026-01-07',
		reference:
			'Synthetic approved December wages:20 actual normal-work days; approved incentives/rest-day/holiday wages excluded',
		approval_id: null
	} as never);
}
function maternity(world: PayrollWorld) {
	const row = leaveCatalogue('MY').find(
		(item) =>
			item.settings_id === settingsIdOn('MY', '2026-01-01') && item.code === 'MATERNITY_LEAVE'
	)!;
	world.leave_catalogue.push(row as never);
	world.leave_entries.push({
		id: 'bb370000-0000-4000-8000-000000000002',
		employment_id: world.employments[0]!.id,
		catalogue_id: row.id,
		leave_code: row.code,
		reference: 'Synthetic maternity confinement1Jan2026',
		from_date: '2026-01-01',
		to_date: '2026-01-31',
		effective_on: '2026-01-01',
		facts: { event_kind: 'BIRTH', event_date: '2026-01-01' },
		half_day_start: false,
		half_day_end: false,
		days: 31,
		encash_days: null,
		allocations: [],
		approval_id: null,
		payslip_id: null,
		charges: Array.from({ length: 31 }, (_, index) => ({
			date: `2026-01-${String(index + 1).padStart(2, '0')}`,
			days: 1,
			catalogue_id: row.id,
			employment_term_id: world.employment_terms[0]!.id,
			holiday_id: null,
			shift_definition_id: null,
			work_day_id: null
		}))
	} as never);
}

test('MY maternity cash target — monthly RM2600 continues unabated without31×RM100 extra allowance', () => {
	const slip = buildStatutory(
		{ code: 'MY', period: '2026-01', people: [person('MONTHLY', 2600)] },
		maternity
	).slips.get('MONTHLY')!;
	// s37(2)(c): monthly wages continued = allowance; neither3100 substituted nor added.
	assert.equal(slip.gross, 2600);
});
for (const [frequency, wage] of [
	['DAILY', 100],
	['HOURLY', 12.5]
] as const) {
	test(`MY maternity cash target — ${frequency} preceding ORP RM100 pays31calendar days RM3100 including9nonrostered days`, () => {
		const slip = buildStatutory(
			{ code: 'MY', period: '2026-01', people: [person(frequency, wage, frequency)] },
			(world) => {
				history(world, 2000);
				maternity(world);
			}
		).slips.get(frequency)!;
		// s60I(1C):2000÷20=100. January31calendar days×100=3100.
		// Retained22Monday–Friday base2200 needs900 extra for9nonrostered days.
		assert.equal(slip.gross, 3100);
	});
}
test('MY maternity cash target — lawful hourly RM8.72 short roster ORP RM4.36 is floored to RM6 on31calendar days', () => {
	const employee = person('FLOOR', 8.72, 'HOURLY', {
		employment_type: 'PART_TIME',
		ordinary_hours_per_week: 2.5
	});
	const slip = buildStatutory({ code: 'MY', period: '2026-01', people: [employee] }, (world) => {
		// Meets hourly minimum8.72: five30-minute days; not an unlawful full-time daily4.36 contract.
		world.shift_definitions[0]!.variant = {
			kind: 'WORK',
			start_time: '09:00',
			end_time: '09:30',
			break_minutes: 0
		};
		history(world, 87.2);
		maternity(world);
	}).slips.get('FLOOR')!;
	//87.20÷20=4.36. Target31×max(4.36,6)=186; retained22×4.36=95.92.
	// Extra90.08 =22×1.64+9×6. No blanket salary minimum overridden.
	assert.equal(slip.gross, 186);
});
test('MY maternity cash target — approved historical ORP inputs produce100 and4.36 before any floor', () => {
	for (const [wages, expected] of [
		[2000, 100],
		[87.2, 4.36]
	] as const) {
		const rate = previousWagePeriodOrdinaryRate({
			currency: 'MYR',
			currentPeriodStart: '2026-01-01',
			periods: [
				{
					id: 'approved-history',
					period: { start: '2025-12-01T00:00:00.000Z', end: '2025-12-31T00:00:00.000Z' },
					currency: 'MYR',
					ordinary_wages: wages,
					ordinary_days: 20,
					approval_id: null
				} as never
			]
		});
		assert.equal(rate.ordinaryDay, expected);
	}
});

// The generic settlement contract is independent of the history/roster fixtures above.
import { calculateLeavePayroll, type PreparedLeavePayroll } from '../src/lib/leave/payroll.ts';
function cashTargetFixture(): PreparedLeavePayroll {
	const catalogue = {
		...leaveCatalogue('MY').find((row) => row.code === 'MATERNITY_LEAVE')!,
		pay_fraction: '',
		time_off_amount: 'max(ordinary_day, 6.0)'
	};
	const charges = ['2026-01-31', '2026-02-01'].map((date) => ({
		date,
		days: 1,
		catalogue_id: catalogue.id,
		employment_term_id: 'terms',
		holiday_id: null,
		shift_definition_id: null,
		work_day_id: null
	}));
	return {
		catalogues: [catalogue] as never,
		entries: [
			{
				id: 'episode',
				employment_id: 'employment',
				catalogue_id: catalogue.id,
				leave_code: catalogue.code,
				reference: 'Two consecutive calendar maternity days',
				from_date: '2026-01-31',
				to_date: '2026-02-01',
				days: 2,
				hours: null,
				charges,
				allocations: [],
				approval_id: null,
				payslip_id: null,
				as_adjustment_entry: false,
				reversal_of_id: null,
				encash_days: null,
				encash_hours: null,
				due_on: null,
				facts: {}
			}
		] as never,
		captures: [],
		deductionEligibility: {},
		targetContexts: { 'episode/2026-01-31': {} as never, 'episode/2026-02-01': {} as never }
	};
}
const targetOptions = (prepared: PreparedLeavePayroll, start: string, end: string) => ({
	prepared,
	window: { start, end },
	dueThrough: end,
	currency: 'MYR',
	absenceRate: () => 0,
	encashmentRate: () => 0,
	ordinaryDayRate: () => 100,
	retainedCash: () => 10
});
test('MY maternity cash target — dated retained wage allowance reduces target once; continued period uses its dated ORP', () => {
	const prepared = cashTargetFixture();
	const january = calculateLeavePayroll(targetOptions(prepared, '2026-01-01', '2026-01-31'));
	assert.equal(
		january.adjustments.reduce((sum, row) => sum + row.amount, 0),
		90
	);
	const february = calculateLeavePayroll({
		...targetOptions(
			{
				...prepared,
				captures: january.captures.map((capture) => ({
					...capture,
					through: '2026-01-31',
					paid: true
				}))
			},
			'2026-02-01',
			'2026-02-28'
		),
		ordinaryDayRate: () => 120,
		retainedCash: () => 15,
		includeMonetary: false
	});
	assert.equal(
		february.adjustments.reduce((sum, row) => sum + row.amount, 0),
		105
	);
	assert.equal(february.captures[0]!.continued, true);
	assert.deepEqual(
		february.captures[0]!.pay_items.map((item) => item.date),
		['2026-02-01']
	);
});
test('MY maternity cash target — reversal negates frozen earnings from both settled periods without repricing', () => {
	const prepared = cashTargetFixture();
	const january = calculateLeavePayroll(targetOptions(prepared, '2026-01-01', '2026-01-31'));
	const february = calculateLeavePayroll({
		...targetOptions(prepared, '2026-02-01', '2026-02-28'),
		ordinaryDayRate: () => 120,
		retainedCash: () => 15
	});
	const reversed = calculateLeavePayroll({
		...targetOptions(
			{
				...prepared,
				entries: [
					{
						...prepared.entries[0]!,
						id: 'reversal',
						as_adjustment_entry: true,
						reversal_of_id: 'episode',
						due_on: '2026-03-01',
						charges: [],
						days: null
					}
				],
				captures: [...january.captures, ...february.captures].map((capture) => ({
					...capture,
					paid: true
				}))
			},
			'2026-03-01',
			'2026-03-31'
		),
		ordinaryDayRate: () => {
			throw new Error('Frozen reversal must not reprice history');
		},
		retainedCash: () => {
			throw new Error('Frozen reversal must not reread retained cash');
		}
	});
	assert.equal(
		reversed.adjustments.reduce((sum, row) => sum + row.amount, 0),
		-195
	);
	assert.deepEqual(
		reversed.captures[0]!.pay_items.map((item) => item.amount),
		[-90, -105]
	);
});

test('MY maternity cash target — cutoff21 selects calendar salary dates without repricing preceding attendance wages', () => {
	const fixture = cashTargetFixture();
	const dates = ['2025-12-21', '2026-01-21', '2026-02-01'];
	const prepared = {
		...fixture,
		entries: [
			{
				...fixture.entries[0]!,
				from_date: dates[0]!,
				to_date: dates[2]!,
				days: 3,
				charges: dates.map((date) => ({ ...fixture.entries[0]!.charges[0]!, date }))
			}
		],
		targetContexts: Object.fromEntries(dates.map((date) => [`episode/${date}`, {} as never]))
	};
	const january = calculateLeavePayroll({
		...targetOptions(prepared, '2025-12-21', '2026-01-20'),
		targetWindow: { start: '2026-01-01', end: '2026-01-31' },
		retainedCash: (charge) => {
			assert.equal(charge.date, '2026-01-21');
			return 100;
		}
	});
	assert.equal(january.adjustments.length, 0);
	assert.deepEqual(
		january.captures[0]!.charges.map((charge) => charge.date),
		['2026-01-21']
	);
	const february = calculateLeavePayroll({
		...targetOptions(
			{
				...prepared,
				captures: january.captures.map((capture) => ({
					...capture,
					through: '2026-01-31',
					paid: true
				}))
			},
			'2026-01-21',
			'2026-02-20'
		),
		targetWindow: { start: '2026-02-01', end: '2026-02-28' },
		retainedCash: (charge) => {
			assert.equal(charge.date, '2026-02-01');
			return 0;
		}
	});
	assert.equal(
		february.adjustments.reduce((sum, row) => sum + row.amount, 0),
		100
	);
	assert.deepEqual(
		february.captures[0]!.charges.map((charge) => charge.date),
		['2026-02-01']
	);
});

import { prepareLeavePayroll } from '../src/lib/leave/payroll.ts';
test('MY maternity cash target — frozen zero-cash continuation survives company calendar change and reverses only frozen cash', () => {
	const fixture = cashTargetFixture();
	const january = calculateLeavePayroll(targetOptions(fixture, '2026-01-01', '2026-01-31'));
	const february = calculateLeavePayroll({
		...targetOptions(fixture, '2026-02-01', '2026-02-28'),
		retainedCash: () => 100
	});
	assert.equal(february.captures[0]!.pay_items.length, 0);
	const entry = { ...fixture.entries[0]!, payslip_id: 'january-slip' };
	const world = {
		leave_entries: [entry],
		leave_catalogue: fixture.catalogues,
		statutory_contributions: [],
		companies: [{ id: 'company', pay_frequency: 'WEEKLY', pay_cutoff_day: 1 }],
		payroll_runs: [],
		payslips: [
			{
				id: 'january-slip',
				employment_id: 'employment',
				payroll_run_id: 'january-run',
				currency: 'MYR',
				paid_at: '2026-01-31',
				adjustments: [],
				salary_from: '2026-01-01',
				salary_to: '2026-01-31',
				leave_settlements: january.captures
			},
			{
				id: 'february-slip',
				employment_id: 'employment',
				payroll_run_id: 'february-run',
				currency: 'MYR',
				paid_at: '2026-02-28',
				adjustments: [],
				salary_from: '2026-02-01',
				salary_to: '2026-02-28',
				leave_settlements: february.captures
			}
		]
	} as unknown as PayrollWorld;
	const read = () =>
		prepareLeavePayroll({
			world,
			employments: [{ id: 'employment' }],
			versions: [{ id: fixture.catalogues[0]!.settings_id }],
			currency: 'MYR'
		}).get('employment')!;
	const frozen = { ...fixture, ...read() };
	assert.equal(frozen.captures.length, 2);
	assert.equal(frozen.captures[1]!.pay_items.length, 0);
	assert.equal(
		calculateLeavePayroll(targetOptions(frozen, '2026-02-01', '2026-02-28')).captures.length,
		0
	);
	world.leave_entries.push({
		...entry,
		id: 'reversal',
		payslip_id: null,
		as_adjustment_entry: true,
		reversal_of_id: 'episode',
		due_on: '2026-03-01',
		charges: [],
		days: null
	} as never);
	const reversal = calculateLeavePayroll({
		...targetOptions({ ...fixture, ...read() }, '2026-03-01', '2026-03-31'),
		ordinaryDayRate: () => {
			throw new Error('Frozen cash cannot reprice after calendar change');
		}
	});
	assert.equal(
		reversal.adjustments.reduce((sum, row) => sum + row.amount, 0),
		-90
	);
});

test('MY maternity cash target — mixed legacy pin and exact zero continuation preserve both captures and frozen reversal', () => {
	const fixture = cashTargetFixture();
	const zero = calculateLeavePayroll({
		...targetOptions(fixture, '2026-02-01', '2026-02-28'),
		retainedCash: () => 100
	});
	const entry = { ...fixture.entries[0]!, payslip_id: 'legacy-slip' };
	const world = {
		leave_entries: [entry],
		leave_catalogue: fixture.catalogues,
		statutory_contributions: [],
		payroll_runs: [],
		payslips: [
			{
				id: 'legacy-slip',
				employment_id: 'employment',
				payroll_run_id: 'legacy-run',
				currency: 'MYR',
				paid_at: '2026-01-31',
				salary_from: '2026-01-01',
				salary_to: '2026-01-31',
				adjustments: [
					{
						family: 'LEAVE',
						source_id: 'episode',
						component_code: fixture.catalogues[0]!.code,
						bucket: 'EARNING',
						amount: 90,
						quantity: 1,
						rate: 100
					}
				]
			},
			{
				id: 'continued-slip',
				employment_id: 'employment',
				payroll_run_id: 'continued-run',
				currency: 'MYR',
				paid_at: '2026-02-28',
				adjustments: [],
				leave_settlements: zero.captures
			}
		]
	} as unknown as PayrollWorld;
	const read = () =>
		prepareLeavePayroll({
			world,
			employments: [{ id: 'employment' }],
			versions: [{ id: fixture.catalogues[0]!.settings_id }],
			currency: 'MYR'
		}).get('employment')!;
	const captured = read();
	assert.equal(captured.captures.length, 2);
	assert.equal(captured.captures[0]!.gross_amount.value, 90);
	assert.equal(captured.captures[0]!.through, '2026-01-31');
	assert.equal(captured.captures[1]!.exact_charges, true);
	assert.equal(
		calculateLeavePayroll(targetOptions({ ...fixture, ...captured }, '2026-02-01', '2026-02-28'))
			.captures.length,
		0
	);
	world.leave_entries.push({
		...entry,
		id: 'reversal',
		payslip_id: null,
		as_adjustment_entry: true,
		reversal_of_id: 'episode',
		due_on: '2026-03-01',
		charges: [],
		days: null
	} as never);
	const reversed = calculateLeavePayroll(
		targetOptions({ ...fixture, ...read() }, '2026-03-01', '2026-03-31')
	);
	assert.equal(
		reversed.adjustments.reduce((sum, row) => sum + row.amount, 0),
		-90
	);
});
