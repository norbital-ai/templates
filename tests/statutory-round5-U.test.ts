/**
 * Round 5, letter U — Taiwan: §32-1 補休 counted in hours, the deferred joiner's elected hours,
 * the §24-1 latest-month normal wage read from the payslips, and the earnings-history mark.
 *
 * Every expected figure is derived by hand in the comment beside it from the instrument named;
 * none was read off an engine run.
 *
 * 勞動基準法 §32-1: 補休 hour for hour; 補休期限屆期或契約終止未補休之時數，應依延長工作時間或休息日
 *   工作當日之工資計算標準發給工資。 https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=32-1
 * 施行細則 §22-2: 應依勞工延長工作時間或休息日工作事實發生時間先後順序補休。
 *
 * The fixture's day is 09:00–18:00 with a one-hour break (8 normal hours); Saturday is the 休息日.
 * 60,000 a month on TW's 30-day divisor is 2,000 a day and 250 an hour. §24(1): the first two
 * extended hours at 4/3 (333.33… an hour), the rest at 5/3 (416.66… an hour); §24(2) prices 休息日
 * work on the same ladder. Each band line is rounded to the cent.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	buildStatutory,
	createStatutoryWorld,
	COMPANY_ID,
	leaveCatalogue,
	settingsVersions,
	type BuiltPayslip,
	type Person
} from './fixtures/statutory-world.ts';
import { memoryPayrollApi, type PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { Effect } from 'effect';
import { gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { resolveExitFacts } from '../src/lib/declared-facts.ts';
import { preloadPayrollWorlds } from '../src/collections/payroll_runs/lib/preload.ts';
import { refuseUnknownMemberships } from '../src/lib/catalogue_rules.ts';

const KEY = 'TW-U';
/** The 2026 version (1 January 2026 onward) and its 補休 leave row. */
const COMP = leaveCatalogue('TW').find(
	(row) => row.code === 'COMPENSATORY_TIME_OFF' && row.settings_id.startsWith('1fcfa66f')
)!;
/** A six-hour roster code (09:00–15:00, no break), the day a half-day charge is three hours of. */
const SHORT_SHIFT = 'c0000000-0000-4000-8000-0000000000e6';

const employmentOf = (world: PayrollWorld) =>
	world.employments.find((row) => row.employee_number === KEY)!;

const elect = (world: PayrollWorld, date: string, start: string, end: string) => {
	world.work_days.push({
		id: `wd-${KEY}-${date}`,
		employment_id: employmentOf(world).id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		requested_by: null,
		emergency_cause: null,
		time_off_in_lieu: true,
		approval_id: null
	});
};

/** 補休 on `date`: `hours` when taken by the hour, else a `days` share of the named roster day. */
const takeCompTime = (
	world: PayrollWorld,
	date: string,
	charge: { readonly days: number; readonly hours: number | null; readonly shift: string | null }
) => {
	const employment = employmentOf(world);
	const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
	world.leave_entries.push({
		id: `e1000000-0000-4000-8000-${date.replaceAll('-', '').padStart(12, '0')}`,
		employment_id: employment.id,
		catalogue_id: COMP.id,
		leave_code: 'COMPENSATORY_TIME_OFF',
		reference: `COMP-${date}`,
		from_date: date,
		to_date: date,
		half_day_start: false,
		half_day_end: false,
		days: charge.days,
		hours: charge.hours,
		effective_on: date,
		reason: '補休',
		allocations: [],
		charges: [
			{
				date,
				days: charge.days,
				catalogue_id: COMP.id,
				employment_term_id: term.id,
				holiday_id: null,
				shift_definition_id: charge.shift,
				work_day_id: null
			}
		],
		approval_id: null,
		payslip_id: null
	} as never);
};

const shortShift = (world: PayrollWorld) =>
	world.shift_definitions.push({
		id: SHORT_SHIFT,
		company_id: COMPANY_ID,
		code: 'SHORT',
		name: 'Six hours',
		variant: { kind: 'WORK', start_time: '09:00', end_time: '15:00', break_minutes: 0 },
		effective_range: { start: '2000-01-01', end: null },
		approval_id: null
	} as never);

const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));

const THIRD = 'OT-1.3333333333333333X';
const TWO_THIRDS = 'OT-1.6666666666666667X';

/** Each period in turn, every earlier run and its payslips standing in the world as paid. */
const chain = (options: {
	readonly periods: readonly string[];
	readonly person: Person;
	readonly plant: (world: PayrollWorld, period: string) => void;
	readonly companyFacts?: Readonly<Record<string, number | boolean | string>>;
}) => {
	const settled: { run: object; slips: object[] }[] = [];
	let last: (ReturnType<typeof buildStatutory> & { world: PayrollWorld }) | null = null;
	let world: PayrollWorld | null = null;
	for (const period of options.periods) {
		const built = buildStatutory(
			{
				code: 'TW',
				period,
				riskClass: '1',
				companyFacts: options.companyFacts ?? {},
				people: [options.person]
			},
			(planted) => {
				planted.leave_catalogue.push(...(leaveCatalogue('TW') as never[]));
				options.plant(planted, period);
				for (const { run, slips } of settled) {
					planted.payroll_runs.push(run as never);
					planted.payslips.push(...(slips as never[]));
				}
				world = planted;
			}
		);
		const runId = `run-${period}`;
		settled.push({
			run: {
				id: runId,
				company_id: COMPANY_ID,
				period,
				lifecycle: 'PAID',
				calculation_trace: built.trace
			},
			slips: [...built.slips.values()].map((slip) => ({
				...slip,
				payroll_run_id: runId,
				status: 'PAID',
				paid_at: `${period.slice(0, 7)}-28T00:00:00.000Z`
			}))
		});
		last = { ...built, world: world! };
	}
	return last!;
};

// ── §32-1 補休 in hours ──────────────────────────────────────────────────────────────────────────

const LEAVER = {
	key: KEY,
	wage: 60_000,
	citizenship: 'CITIZEN',
	exit_date: '2026-01-20',
	exit_reason: 'RESIGNATION'
} as const;

/** Six elected hours (Monday 5 and Saturday 10 January), three of them taken on 15 January. */
const sixElectedThreeTaken =
	(charge: Parameters<typeof takeCompTime>[2]) => (world: PayrollWorld) => {
		shortShift(world);
		elect(world, '2026-01-05', '09:00', '21:00');
		elect(world, '2026-01-10', '09:00', '12:00');
		takeCompTime(world, '2026-01-15', charge);
	};

test('TW round 5 — §32-1: hourly 補休 takes its own hours, not an eighth of a day per hour', () => {
	// Monday 5 January, 09:00–21:00: 3 extended hours, elected — 2 h at 4/3, 1 h at 5/3.
	// Saturday 10 January (休息日), 09:00–12:00: 3 hours, elected — 2 h at 4/3, 1 h at 5/3.
	// 15 January is a six-hour day; 3 hours of 補休 there is a half-day charge (3 / 6), and it
	// takes three hours, oldest first (細則 §22-2): all of Monday's. Counting the half day as
	// 0.5 × 8 = 4 hours would also take Saturday's first 4/3 hour.
	// The contract ends on 20 January, so Saturday's three untaken hours are paid (§32-1(2)):
	//   2 h × 250 × 4/3 = 666.67; 1 h × 250 × 5/3 = 416.67.
	const built = chain({
		periods: ['2026-01'],
		person: LEAVER,
		plant: sixElectedThreeTaken({ days: 0.5, hours: 3, shift: SHORT_SHIFT })
	});
	assert.deepEqual(workLines(built.slips.get(KEY)!), [
		['2026-01-10', THIRD, 2, 666.67],
		['2026-01-10', TWO_THIRDS, 1, 416.67]
	]);
});

test('TW round 5 — §32-1: a half day of 補休 is half of that day’s own normal hours', () => {
	// The same six elected hours; 補休 recorded as a half day (no hours) on the six-hour roster day
	// takes 0.5 × 6 = 3 hours — Monday's three — and Saturday's three are paid on termination:
	//   666.67 + 416.67, exactly as when the three hours are recorded by the hour.
	const built = chain({
		periods: ['2026-01'],
		person: LEAVER,
		plant: sixElectedThreeTaken({ days: 0.5, hours: null, shift: SHORT_SHIFT })
	});
	assert.deepEqual(workLines(built.slips.get(KEY)!), [
		['2026-01-10', THIRD, 2, 666.67],
		['2026-01-10', TWO_THIRDS, 1, 416.67]
	]);
});

test('TW round 5 — §32-1: a day of 補休 with no roster day to measure it refuses by name', () => {
	assert.throws(
		() =>
			chain({
				periods: ['2026-01'],
				person: LEAVER,
				plant: sixElectedThreeTaken({ days: 0.5, hours: null, shift: null })
			}),
		/COMPENSATORY_TIME_OFF leave on 2026-01-15 names no working roster code/
	);
});

test('TW round 5 — §32-1: a deferred joiner’s elected hours are credited by the run that settles those days', () => {
	// Hired Sunday 25 January 2026, after January's attendance window closed (21 December –
	// 20 January), so January's wages are deferred to February. Monday 26 January, 09:00–21:00:
	// 3 extended hours, elected. That day is in February's window (21 January – 20 February), so
	// February credits them: January's deferred slip carries none, and February pays none while
	// the credit stands (it expires with the 2026 annual-leave year).
	// The contract then ends on 20 February: the three untaken hours are paid at that day's rates,
	//   2 h × 250 × 4/3 = 666.67; 1 h × 250 × 5/3 = 416.67.
	const joiner = { key: KEY, wage: 60_000, citizenship: 'CITIZEN', hire_date: '2026-01-25' };
	const plant = (world: PayrollWorld) => elect(world, '2026-01-26', '09:00', '21:00');
	const january = chain({ periods: ['2026-01'], person: joiner, plant });
	assert.deepEqual(workLines(january.slips.get(KEY)!), []);
	assert.deepEqual(
		january.trace.flatMap((entry) => entry.time_off_in_lieu ?? []),
		[],
		'January is deferred and has no day of the employment to credit.'
	);
	const february = chain({ periods: ['2026-01', '2026-02'], person: joiner, plant });
	assert.deepEqual(workLines(february.slips.get(KEY)!), []);
	assert.deepEqual(
		february.trace
			.flatMap((entry) => entry.time_off_in_lieu ?? [])
			.map((slice) => [slice.date, slice.label, slice.hours, slice.paid]),
		[
			['2026-01-26', THIRD, 2, false],
			['2026-01-26', TWO_THIRDS, 1, false]
		]
	);
	const leaving = chain({
		periods: ['2026-01', '2026-02'],
		person: { ...joiner, exit_date: '2026-02-20', exit_reason: 'RESIGNATION' },
		plant
	});
	assert.deepEqual(workLines(leaving.slips.get(KEY)!), [
		['2026-01-26', THIRD, 2, 666.67],
		['2026-01-26', TWO_THIRDS, 1, 416.67]
	]);
});

// ── §24-1: the latest month's normal-hours wage, read from its payslips ─────────────────────────

/** The 2026 version (1 January 2026 – 31 December 2026). */
const TW_2026 = '1fcfa66f-40da-5792-b925-7c2fcaa8f92c';
const COMMISSION = 'd5000000-0000-4000-8000-000000000c01';

/** A 60,000 contract raised to 66,000 from 16 June, a June commission and a June overtime day. */
const raisedInJune =
	(options: { readonly marked: boolean }) => (world: PayrollWorld, period: string) => {
		const employment = employmentOf(world);
		const terms = world.employment_terms.find((row) => row.employment_id === employment.id)!;
		terms.effective_range = { start: '2015-01-01', end: '2026-06-15' };
		world.employment_terms.push({
			...terms,
			id: 'b0000000-0000-4000-8000-0000000000u1',
			base_salary: { ...terms.base_salary, value: 66_000 },
			effective_range: { start: '2026-06-16', end: world.employments[0]!.effective_range.end }
		});
		// 勞基法 §2(3): commission paid regularly for the work is 經常性給與 — wages. The class is
		// the tenant's own; `WAGES` in its `counts_toward` is what files it into the earnings history.
		world.adhoc_catalogue!.push({
			id: COMMISSION,
			settings_id: TW_2026,
			code: 'COMMISSION',
			name: '業績獎金 (commission)',
			authority: null,
			eligibility: '',
			evidence: 'NONE',
			destination: 'PAY',
			direction: 'ADD',
			bands: [{ when: '', amount: 'entry.amount', limit: null }],
			counts_toward: options.marked ? ['WAGES'] : [],
			raised_by: 'MANUAL',
			approval_id: null
		} as never);
		world.adhoc_requests!.push({
			id: 'd5000000-0000-4000-8000-000000000c02',
			employment_id: employment.id,
			catalogue_id: COMMISSION,
			amount: 3_000,
			event_date: '2026-06-10',
			pay_period: null,
			payslip_id: null,
			reason: 'June commission',
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		} as never);
		// Wednesday 3 June, 09:00–21:00: three extended hours, paid — overtime, not normal hours.
		if (period === '2026-06')
			world.work_days.push({
				id: `wd-${KEY}-2026-06-03`,
				employment_id: employment.id,
				work_date: '2026-06-03',
				shift_definition_id: null,
				worked_intervals: [
					{ start: '2026-06-03T09:00:00+08:00', end: '2026-06-03T21:00:00+08:00' }
				],
				requested_by: null,
				emergency_cause: null,
				time_off_in_lieu: null,
				approval_id: null
			});
		// Resigning on 20 July with 1.5 days of 特別休假 unused: §38(4) pays them (§24-1(2)(1)(1)).
		const annual = world.leave_catalogue.find(
			(row) => row.code === 'ANNUAL_LEAVE' && row.settings_id === TW_2026
		)!;
		world.leave_entries.push({
			id: 'e1000000-0000-4000-8000-00000000u0a1',
			employment_id: employment.id,
			catalogue_id: annual.id,
			leave_code: 'ANNUAL_LEAVE',
			reference: 'TW-U-EXIT',
			from_date: '2026-01-01',
			to_date: '2026-12-31',
			half_day_start: false,
			half_day_end: false,
			days: 1.5,
			encash_days: 1.5,
			effective_on: '2026-07-20',
			due_on: '2026-07-31',
			reason: 'Unused on termination',
			allocations: [],
			charges: [],
			approval_id: null,
			payslip_id: null,
			as_adjustment_entry: false
		} as never);
	};

const RAISED = {
	key: KEY,
	wage: 60_000,
	citizenship: 'CITIZEN',
	exit_date: '2026-07-20',
	exit_reason: 'RESIGNATION'
} as const;

const cashOut = (slip: BuiltPayslip) =>
	slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')?.amount;

for (const marked of [true, false])
	test(`TW round 5 — §24-1: ${marked ? 'a mid-June raise and a regular commission are' : 'a mid-June raise is'} June’s own normal wage, read from its payslip`, () => {
		// 勞動基準法施行細則 §24-1(2)(1)(2): 其為計月者，為年度終結或契約終止前最近一個月正常工作時間
		// 所得之工資除以三十所得之金額. The contract ends on 20 July; June's payslip (paid 28 June)
		// is the latest month received. June on its 30 calendar days:
		//   60,000 × 15/30 = 30,000 (1–15 June) + 66,000 × 15/30 = 33,000 (16–30 June) = 63,000;
		//   the commission marked WAGES, 3,000, is normal-hours pay too: 66,000.
		//   The overtime of 3 June (2 × 333.33 + 416.67) is not normal-hours pay and stays out.
		// 1.5 days × 66,000 / 30 = 3,300 (marked); 1.5 × 63,000 / 30 = 3,150 (unmarked class).
		// Valued on the contract, June's raise refused the cash-out outright.
		const periods = ['2026-06', '2026-07'];
		const july = chain({ periods, person: RAISED, plant: raisedInJune({ marked }) });
		assert.equal(cashOut(july.slips.get(KEY)!), marked ? 3_300 : 3_150);
	});

test('TW round 5 — §24-1: with no payslip and no record of the latest month the cash-out stops by name', () => {
	assert.throws(
		() => chain({ periods: ['2026-07'], person: RAISED, plant: raisedInJune({ marked: true }) }),
		/complete monthly wage period received or due before 2026-07-20: no earlier payslip settles a whole month then/
	);
});

test('TW round 5 — a class marked WAGES enters the earnings history the average wage reads (勞基法 §2(3))', () => {
	// June's payslip: 63,000 of salary, 1,083.34 of overtime (666.67 + 416.67, each band line
	// rounded) and 3,000 of commission. Filed under WAGES: 67,083.34 with the mark, 64,083.34
	// without — an unmarked ad hoc class (a year-end bonus) is not wages (施行細則 §10(2)).
	for (const marked of [true, false]) {
		const { world } = chain({
			periods: ['2026-06', '2026-07'],
			person: RAISED,
			plant: raisedInJune({ marked })
		});
		const prepared = Effect.runSync(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-07' })
		);
		const june = prepared.gathered.earnedByMonth
			.get(employmentOf(world).employee_id)!
			.get('2026-06')!;
		assert.equal(Math.round(june.get('WAGES')! * 100) / 100, marked ? 67_083.34 : 64_083.34);
	}
});

// ── 勞基法 §2(4) and 施行細則 §2: the days left out, with what they were paid ─────────────────────

/**
 * 施行細則 §2: 依本法第二條第四款計算平均工資時，下列各款期日或期間均不計入：…二、因職業災害尚在醫療中
 * 者。三、依本法第五十條第二項減半發給工資者。…五、依勞工請假規則請普通傷病假者。六、依性別平等工作法
 * 請生理假、產假、家庭照顧假或安胎休養，致減少工資者。七、留職停薪者。
 * https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=2
 *
 * Every case: hired 1 February 2019, laid off 31 January 2026 (REDUNDANCY): 84 months → 勞退條例
 * §12(1) 0.5 × 7 = 3.5 months' average wage. The six months before January 2026 — July 31,
 * August 31, September 30, October 31, November 30, December 31 — are 184 days, 184 / 6 =
 * 30.666… a month (台(83)勞動二字第25564號). 60,000 a month, the contract line priced by its segment.
 */
const SEVERANCE_LEAVER = {
	key: KEY,
	wage: 60_000,
	citizenship: 'CITIZEN',
	hire_date: '2019-02-01',
	exit_date: '2026-01-31',
	exit_reason: 'REDUNDANCY'
} as const;
const MONTHS = ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'] as const;
const monthEnd = (month: string) =>
	new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
		.toISOString()
		.slice(0, 10);

/** The six earlier payslips: the contract segment, then `lines[month]` on top. */
const priorPayslips = (
	world: PayrollWorld,
	lines: Readonly<
		Record<
			string,
			ReadonlyArray<{ code: string; bucket: string; amount: number; quantity?: number }>
		>
	>
) => {
	const employment = employmentOf(world);
	for (const month of MONTHS) {
		const runId = `prior-${month}`;
		world.payroll_runs.push({ id: runId, company_id: COMPANY_ID, period: month } as never);
		const extra = lines[month] ?? [];
		world.payslips.push({
			id: `${runId}-slip`,
			payroll_run_id: runId,
			employment_id: employment.id,
			status: 'PAID',
			paid_at: `${month}-28T00:00:00.000Z`,
			base: [{ component_code: 'BASIC', amount: 60_000 }],
			proration: [
				{
					component_code: 'BASIC',
					term_key: 'Fixture',
					from: `${month}-01`,
					to: monthEnd(month),
					basis: { by: 'CALENDAR_DAYS' },
					days: Number(monthEnd(month).slice(8)),
					denominator: Number(monthEnd(month).slice(8)),
					unpaid_days: 0,
					contract_amount: 60_000,
					prorated_amount: 60_000
				}
			],
			adjustments: extra.map((line, index) => ({
				family: line.bucket === 'ABSENCE' ? 'LEAVE' : 'WORK_DAY',
				source_id: `d9100000-0000-4000-8000-${month.replace('-', '')}0000${index}`,
				component_code: line.code,
				label: line.code,
				bucket: line.bucket,
				amount: line.amount,
				quantity: line.quantity ?? null,
				rate: null,
				statutory_rule_key: null
			})),
			statutory: []
		} as never);
	}
};

/** Approved time off of `code` over `from`–`to`, charged on its weekdays. */
const timeOff = (world: PayrollWorld, code: string, from: string, to: string) => {
	const row = leaveCatalogue('TW').find(
		(entry) => entry.code === code && entry.settings_id.startsWith('99d794f9')
	)!;
	if (!world.leave_catalogue.some((entry) => entry.id === row.id))
		world.leave_catalogue.push({ ...row, approval_id: null } as never);
	const charges = [];
	for (let day = from; day <= to;) {
		const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
		if (weekday !== 0 && weekday !== 6)
			charges.push({
				date: day,
				days: 1,
				catalogue_id: row.id,
				employment_term_id: world.employment_terms[0]!.id,
				holiday_id: null,
				shift_definition_id: null,
				work_day_id: null
			});
		day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
	}
	world.leave_entries.push({
		id: `d9200000-0000-4000-8000-${from.replaceAll('-', '')}${code.length.toString().padStart(4, '0')}`,
		employment_id: employmentOf(world).id,
		catalogue_id: row.id,
		leave_code: code,
		reference: `${code}-${from}`,
		from_date: from,
		to_date: to,
		half_day_start: false,
		half_day_end: false,
		days: charges.length,
		encash_days: null,
		as_adjustment_entry: false,
		reversal_of_id: null,
		effective_on: from,
		charges,
		allocations: [],
		approval_id: null,
		payslip_id: 'settled'
	} as never);
};

/** The severance line of a 31 January 2026 lay-off with the history `plant` writes. */
const severance = (plant: (world: PayrollWorld) => void) => {
	const { slips } = buildStatutory(
		{ code: 'TW', period: '2026-01', riskClass: '1', people: [SEVERANCE_LEAVER] },
		(world) => {
			world.leave_catalogue.push(...(leaveCatalogue('TW') as never[]));
			plant(world);
			const row = world.adhoc_catalogue!.find(
				(entry) => entry.code === 'SEVERANCE_PAY' && entry.settings_id === TW_2026
			)!;
			world.adhoc_requests!.push({
				id: 'd9300000-0000-4000-8000-000000000001',
				employment_id: employmentOf(world).id,
				catalogue_id: row.id,
				amount: 0,
				event_date: '2026-01-31',
				pay_period: '2026-01',
				payslip_id: null,
				reason: 'SEVERANCE_PAY',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			} as never);
		}
	);
	return slips.get(KEY)!.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')?.amount;
};

test('TW round 5 — 施行細則 §2(2): fully paid 公傷病假 days leave the average with the contract day they were paid', () => {
	// Monday 13 – Friday 17 October 2025, occupational injury leave on full pay (勞基法 §59(2)), no
	// deduction line; 6,200 of overtime worked on other October days. October paid 66,200.
	// The five days go, each with the contract's day, 60,000 / 31 = 1,935.483871: October keeps
	// 66,200 − 9,677.419355 = 56,522.580645 over 26 days. The other five months 300,000 / 153 days.
	// Day: 356,522.580645 / 179 = 1,991.746261; month × 30.666667 = 61,080.2187;
	// severance × 3.5 = 213,780.77 → 213,781.
	// Counted only where pay was cut, the days stayed in: 366,200 / 6 × 3.5 = 213,616.67 → 213,617.
	assert.equal(
		severance((world) => {
			priorPayslips(world, {
				'2025-10': [{ code: 'OVERTIME', bucket: 'EARNING', amount: 6_200 }]
			});
			timeOff(world, 'OCCUPATIONAL_INJURY_LEAVE', '2025-10-13', '2025-10-17');
		}),
		213_781
	);
});

test('TW round 5 — 施行細則 §2(7): 留職停薪 leaves out every calendar day it spans, rest days too', () => {
	// 育嬰留職停薪 16 August – 15 September 2025. August: 16 of 31 days unpaid, deduction
	// 60,000 × 16/31 = 30,967.74 (paid 29,032.26); September: 15 of 30, deduction 30,000.
	// August keeps 29,032.26 + 30,967.74 − 16 × 60,000/31 (30,967.741935) = 29,032.258065 over 15
	// days; September 30,000 + 30,000 − 15 × 2,000 = 30,000 over 15 days. The other four months
	// 240,000 over 123 days. Day: 299,032.258065 / 153 = 1,954.459203; month × 30.666667 =
	// 59,936.7489; × 3.5 = 209,778.62 → 209,779. Counting only the charged weekdays (12 in
	// August, 11 in September), the leave's weekends stayed in as full-pay days.
	assert.equal(
		severance((world) => {
			priorPayslips(world, {
				'2025-08': [{ code: 'PARENTAL_LEAVE', bucket: 'ABSENCE', amount: 30_967.74, quantity: 11 }],
				'2025-09': [{ code: 'PARENTAL_LEAVE', bucket: 'ABSENCE', amount: 30_000, quantity: 11 }]
			});
			timeOff(world, 'PARENTAL_LEAVE', '2025-08-16', '2025-09-15');
		}),
		209_779
	);
});

test('TW round 5 — 施行細則 §2(6): family-care leave that cut the wage goes, fully paid maternity leave stays', () => {
	// Tuesday 4 November 2025, one day of unpaid 家庭照顧假: deduction 60,000 / 30 = 2,000; it cut
	// the wage, so it goes (§2(6) 致減少工資者): November 58,000 + 2,000 − 2,000 = 58,000 over 29
	// days. 1–10 December 2025, 產假 on full pay (勞基法 §50(2), six months' service): nothing cut,
	// so December stays whole. Day: (300,000 + 58,000) / (154 + 29) = 1,956.284153; month ×
	// 30.666667 = 59,992.7140; × 3.5 = 209,974.50 (209,974.4991) → 209,974.
	assert.equal(
		severance((world) => {
			priorPayslips(world, {
				'2025-11': [{ code: 'FAMILY_CARE_LEAVE', bucket: 'ABSENCE', amount: 2_000, quantity: 1 }]
			});
			timeOff(world, 'FAMILY_CARE_LEAVE', '2025-11-04', '2025-11-04');
			timeOff(world, 'MATERNITY_LEAVE', '2025-12-01', '2025-12-10');
		}),
		209_974
	);
});

// ── G15b: 勞基法 §56(1) — the reserve rate an old-system entity must record ───────────────────────

const OLD_SYSTEM = {
	key: 'TW-OLD',
	wage: 50_000,
	citizenship: 'CITIZEN',
	hire_date: '1998-03-01',
	registrations: { LABOR_PENSION: { kind: 'NOT_REGISTERED' } }
} as const;

test('TW round 5 — §56(1): an old-system worker with no recorded reserve rate stops the run by name', () => {
	// 勞基法 §56(1): 雇主應依勞工每月薪資總額百分之二至百分之十五範圍內，按月提撥勞工退休準備金.
	// Unrecorded, the rate read 0 and the reserve was silently nothing; 1% and 16% are outside the
	// band the Act allows and are refused at the declaration.
	assert.throws(
		() => buildStatutory({ code: 'TW', period: '2026-01', riskClass: '1', people: [OLD_SYSTEM] }),
		/§56\(1\).*Record it as the entity fact pension_reserve_rate/
	);
	for (const rate of [1, 16])
		assert.throws(
			() =>
				buildStatutory({
					code: 'TW',
					period: '2026-01',
					riskClass: '1',
					companyFacts: { pension_reserve_rate: rate },
					people: [OLD_SYSTEM]
				}),
			rate === 1 ? /must be at least 2/ : /must be at most 15/
		);
	// Recorded at 2%: 50,000 × 2% = 1,000, an employer cost.
	const { slips } = buildStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		companyFacts: { pension_reserve_rate: 2 },
		people: [OLD_SYSTEM]
	});
	const reserve = slips
		.get('TW-OLD')!
		.statutory.find((row) => row.scheme_code === 'LABOR_PENSION_RESERVE')!;
	assert.deepEqual(
		[reserve.base_amount, reserve.employee_amount, reserve.employer_amount],
		[50_000, 0, 1_000]
	);
});

test('TW round 5 — §56(1): an entity with only new-system workers needs no reserve rate', () => {
	// No old-system worker: the reserve's base is 0 for everyone and the fact stays optional.
	const { slips } = buildStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [{ key: 'TW-NEW', wage: 50_000, citizenship: 'CITIZEN' }]
	});
	assert.equal(
		slips.get('TW-NEW')!.statutory.find((row) => row.scheme_code === 'LABOR_PENSION_RESERVE')
			?.employer_amount ?? 0,
		0
	);
});

// ── D31 / D36: coverage that changes inside a month ─────────────────────────────────────────────

/**
 * Every scheme registered on 34,800, from 1 January 2015. BLI prices LI, EI, 職災 and 勞退 on a
 * thirty-day month by insured days (勞工保險條例施行細則; 勞退條例 §14–15): 34,800 × 11.5% LI ×
 * 20% = 800.4 a month for the worker, × 70% = 2,801.4 for the employer; EI 1%: 69.6 and 243.6;
 * 職災 class-1 0.25%: 87; 勞退 6%: 2,088. NHI (全民健康保險法 §30(2)): 投保當月繳納全月保險費，
 * 退保當月免繳保險費 — the unit enrolled at month end pays the whole month, 540 / 1,684.
 */
const INSURED = ['LI', 'EI', 'NHI', 'OCC_INJURY', 'LABOR_PENSION', 'WAGE_ARREARS_BASE'] as const;
const insured = (): NonNullable<Person['registrations']> =>
	Object.fromEntries(
		INSURED.map((code) => [
			code,
			{
				kind: 'REGISTERED',
				elections: {
					insured_amount: 34_800,
					...(code === 'NHI' ? { enrolled_dependants: 0 } : {}),
					...(code === 'LABOR_PENSION' ? { voluntary_rate: 0 } : {})
				}
			}
		])
	);

/** Replace a scheme's declaration with dated pieces: `[start, end, kind, extra elections]`. */
const redeclare = (
	world: PayrollWorld,
	code: string,
	pieces: ReadonlyArray<
		readonly [string, string | null, 'REGISTERED' | 'NOT_REGISTERED', Record<string, unknown>?]
	>
) => {
	const ids = new Set(
		world.statutory_contributions.filter((row) => row.code === code).map((row) => row.id)
	);
	const [fact] = world.employment_statutory_facts.filter((row) =>
		ids.has(row.statutory_contribution_id)
	);
	world.employment_statutory_facts = world.employment_statutory_facts.filter(
		(row) => !ids.has(row.statutory_contribution_id)
	);
	pieces.forEach(([start, end, kind, elections], index) =>
		world.employment_statutory_facts.push({
			...fact!,
			id: `${fact!.id}-${index}`,
			effective_range: { start, end },
			status:
				kind === 'REGISTERED'
					? {
							...fact!.status,
							since: start < '2015-01-01' ? fact!.status.since : start,
							elections: { ...fact!.status.elections, ...elections }
						}
					: { kind: 'NOT_REGISTERED', reason: 'Withdrawn' }
		})
	);
};

const INSURED_PERSON = {
	key: 'TW-COVER',
	wage: 34_800,
	citizenship: 'CITIZEN',
	registrations: insured()
} as const;

const february = (plant: (world: PayrollWorld) => void) =>
	assessStatutory(
		{ code: 'TW', period: '2026-02', riskClass: '1', people: [INSURED_PERSON] },
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
			plant(world);
		}
	).get('TW-COVER')!;

const shares = (book: ReturnType<typeof february>) =>
	Object.fromEntries(
		INSURED.filter((code) => code !== 'WAGE_ARREARS_BASE').map((code) => [
			code,
			book.get(code) == null ? null : [book.get(code)!.employee, book.get(code)!.employer]
		])
	);

test('TW round 5 — D31 性平法 §16(2): 育嬰留職停薪 from 16 February waives the employer share for the leave days and bills the worker directly', () => {
	// 性別平等工作法 §16(2): 得繼續參加原有之社會保險，原由雇主負擔之保險費，免予繳納；原由受僱者負擔
	// 之保險費，得遞延三年繳納. BLI (https://www.bli.gov.tw/0006915.html): continuation is LI and EI
	// only, not 職災; the 70% employer share is borne by the government; the insurer bills the
	// worker's 20% to the worker (https://www.mol.gov.tw/1607/1632/1640/20250/). 勞退條例 §20: the
	// pension stops. NHI: the worker is billed by 健保署, and on the leave at month end.
	// February on the thirty-day month: 1–15 February (15 days) as before, 16–30 on the leave.
	//   LI  800.4 × 15/30 = 400.2 → 400; 2,801.4 × 15/30 = 1,400.7 → 1,401; the leave days 0 / 0.
	//   EI  69.6 × 15/30 = 34.8 → 35;    243.6 × 15/30 = 121.8 → 122.
	//   職災 withdrawn from 16th: 87 × 15/30 = 43.5 → 44 (rounded half up).
	//   勞退 stopped from 16th: 2,088 × 15/30 = 1,044.
	//   NHI on the leave at month end: nothing through payroll.
	// DEFERRED on LI and CONTINUED on EI price the same: the choice is the insurer's bill.
	const book = february((world) => {
		redeclare(world, 'LI', [
			['2000-01-01', '2026-02-15', 'REGISTERED'],
			['2026-02-16', null, 'REGISTERED', { parental_leave: 'DEFERRED' }]
		]);
		redeclare(world, 'EI', [
			['2000-01-01', '2026-02-15', 'REGISTERED'],
			['2026-02-16', null, 'REGISTERED', { parental_leave: 'CONTINUED' }]
		]);
		redeclare(world, 'NHI', [
			['2000-01-01', '2026-02-15', 'REGISTERED'],
			['2026-02-16', null, 'REGISTERED', { parental_leave: 'CONTINUED' }]
		]);
		for (const code of ['OCC_INJURY', 'LABOR_PENSION'])
			redeclare(world, code, [
				['2000-01-01', '2026-02-15', 'REGISTERED'],
				['2026-02-16', null, 'NOT_REGISTERED']
			]);
	});
	assert.deepEqual(shares(book), {
		LI: [400, 1401],
		EI: [35, 122],
		NHI: [0, 0],
		OCC_INJURY: [0, 44],
		LABOR_PENSION: [0, 1044]
	});
});

test('TW round 5 — D31: a whole month on 育嬰留職停薪 charges nothing through payroll; 職災 or 勞退 left registered stops the run', () => {
	const onLeave = (world: PayrollWorld) => {
		for (const code of ['LI', 'EI', 'NHI'])
			redeclare(world, code, [
				['2000-01-01', '2026-01-31', 'REGISTERED'],
				['2026-02-01', null, 'REGISTERED', { parental_leave: 'CONTINUED' }]
			]);
	};
	// LI, EI and NHI continued: the employer's share is not payable and the worker is billed by
	// the insurer, so every share is 0; 職災 and 勞退 are withdrawn for the leave.
	const book = february((world) => {
		onLeave(world);
		for (const code of ['OCC_INJURY', 'LABOR_PENSION'])
			redeclare(world, code, [
				['2000-01-01', '2026-01-31', 'REGISTERED'],
				['2026-02-01', null, 'NOT_REGISTERED']
			]);
	});
	assert.deepEqual(shares(book), {
		LI: [0, 0],
		EI: [0, 0],
		NHI: [0, 0],
		OCC_INJURY: [0, 0],
		LABOR_PENSION: null
	});
	assert.throws(
		() =>
			february((world) => {
				onLeave(world);
				redeclare(world, 'OCC_INJURY', [
					['2000-01-01', '2026-01-31', 'REGISTERED'],
					['2026-02-01', null, 'NOT_REGISTERED']
				]);
			}),
		/勞工退休金條例 §20.*record LABOR_PENSION NOT_REGISTERED/
	);
	assert.throws(
		() =>
			february((world) => {
				onLeave(world);
				redeclare(world, 'LABOR_PENSION', [
					['2000-01-01', '2026-01-31', 'REGISTERED'],
					['2026-02-01', null, 'NOT_REGISTERED']
				]);
			}),
		/not 勞工職業災害保險.*record OCC_INJURY NOT_REGISTERED/
	);
});

test('TW round 5 — D36: withdrawn on 10 February and re-enrolled on 20th — insured days for LI/EI/職災/勞退, the whole month for NHI', () => {
	// Covered 1–10 and 20–30 February: 10 + 11 = 21 of the thirty days.
	//   LI  800.4 × 21/30 = 560.28 → 560; 2,801.4 × 21/30 = 1,960.98 → 1,961.
	//   EI  69.6 × 21/30 = 48.72 → 49;    243.6 × 21/30 = 170.52 → 171.
	//   職災 87 × 21/30 = 60.9 → 61.     勞退 2,088 × 21/30 = 1,461.6 → 1,462.
	//   NHI enrolled at month end (§30(2)): the whole month, 540 / 1,684.
	const book = february((world) => {
		for (const code of INSURED)
			redeclare(world, code, [
				['2000-01-01', '2026-02-10', 'REGISTERED'],
				['2026-02-11', '2026-02-19', 'NOT_REGISTERED'],
				['2026-02-20', null, 'REGISTERED']
			]);
	});
	assert.deepEqual(shares(book), {
		LI: [560, 1961],
		EI: [49, 171],
		NHI: [540, 1684],
		OCC_INJURY: [0, 61],
		LABOR_PENSION: [0, 1462]
	});
});

test('TW round 5 — D36: re-enrolled on another grade after a gap, each enrolment is priced on its own grade and days', () => {
	// Covered 1–10 February on 34,800 and, after withdrawal, from 20th on 40,100: a re-enrolment
	// states its own grade (勞保 加保 at the wage then paid).
	//   LI  34,800: 800.4 × 10/30 = 266.8 → 267; 2,801.4 × 10/30 = 933.8 → 934.
	//       40,100 × 11.5% = 4,611.5: × 20% = 922.3 × 11/30 = 338.18 → 338; × 70% = 3,228.05 ×
	//       11/30 = 1,183.62 → 1,184. LI: 267 + 338 = 605; 934 + 1,184 = 2,118.
	//   EI  34,800: 69.6 × 10/30 = 23.2 → 23; 243.6 × 10/30 = 81.2 → 81.
	//       40,100: 80.2 × 11/30 = 29.41 → 29; 280.7 × 11/30 = 102.92 → 103. EI: 52; 184.
	//   NHI at month end on 40,100 (grade 40,100: 40,100 × 5.17% = 2,073.17; × 30% = 621.95 →
	//       622; employer × 60% × 1.56 = 1,940.49 → 1,940).
	const regrade = (world: PayrollWorld) => {
		for (const code of ['LI', 'EI', 'NHI'])
			redeclare(world, code, [
				['2000-01-01', '2026-02-10', 'REGISTERED'],
				['2026-02-11', '2026-02-19', 'NOT_REGISTERED'],
				['2026-02-20', null, 'REGISTERED', { insured_amount: 40_100 }]
			]);
	};
	const book = february(regrade);
	assert.deepEqual([book.get('LI')!.employee, book.get('LI')!.employer], [605, 2118]);
	assert.deepEqual([book.get('EI')!.employee, book.get('EI')!.employer], [52, 184]);
	assert.deepEqual([book.get('NHI')!.employee, book.get('NHI')!.employer], [622, 1940]);
});

test('TW round 5 — D36: a grade change inside continuous cover is refused — it takes effect from the first of a month (勞保條例 §14(2))', () => {
	// 勞工保險條例 §14(2): 其調整均自通知之次月一日生效 (https://www.bli.gov.tw/0005472.html); 勞退條例
	// §15(2) the same. A declaration raising the grade on 16 February without a gap cannot stand.
	assert.throws(
		() =>
			february((world) =>
				redeclare(world, 'LI', [
					['2000-01-01', '2026-02-15', 'REGISTERED'],
					['2026-02-16', null, 'REGISTERED', { insured_amount: 40_100 }]
				])
			),
		/LI: Labour insurance salary changes on 2026-02-16, inside continuous cover/
	);
	// Dated from 1 March it is the March grade: February stays 800 / 2,801.
	const book = february((world) =>
		redeclare(world, 'LI', [
			['2000-01-01', '2026-02-28', 'REGISTERED'],
			['2026-03-01', null, 'REGISTERED', { insured_amount: 40_100 }]
		])
	);
	assert.deepEqual([book.get('LI')!.employee, book.get('LI')!.employer], [800, 2801]);
});

// ── D15: the declarations TW rules read, unknown never a favourable election ────────────────────

test('TW round 5 — D15: a resignation or dismissal must state its 勞基法 article; the exit reason cannot tell §14 from §15', () => {
	// §14 (the worker ends the contract for the employer's breach) owes severance (§14(4) → §17 /
	// 勞退條例 §12); §15 (a plain resignation) does not; §11 dismissal owes it, §12 does not. The
	// departure is resolved against the version's exit declarations when separation pay is raised.
	const fields = settingsVersions('TW')[1]!.exit_facts;
	const leaver = (exit_reason: string) =>
		personContext({
			employee: null,
			employment: { service_start: '2020-01-01', exit_date: '2026-01-20', exit_reason },
			terms: null,
			asOf: '2026-01-20'
		});
	for (const reason of ['RESIGNATION', 'DISMISSAL', 'UNILATERAL', 'MUTUAL'])
		assert.throws(
			() => resolveExitFacts(fields, {}, leaver(reason)),
			/勞基法 termination ground is required before calculation/,
			reason
		);
	// A redundancy is §11 by its reason; a stated article resolves.
	assert.equal(
		resolveExitFacts(fields, {}, leaver('REDUNDANCY')).employment.exit_facts.lsa_termination_ground,
		''
	);
	assert.equal(
		resolveExitFacts(fields, { lsa_termination_ground: 'OTHER' }, leaver('RESIGNATION')).employment
			.exit_facts.lsa_termination_ground,
		'OTHER'
	);
});

test('TW round 5 — D16: an unrecorded birth date, nationality, foreign pass or industry class stops the run by name', () => {
	// 勞保條例 §6 and 就業保險法 §5 turn on age (15–65) and nationality; 勞退條例 §7 on nationality
	// and, for a foreigner, the pass (a migrant worker is outside it); 災保法 §16 on the industry
	// class. Unrecorded, each read as the favourable blank — EI dropped for want of an age, 職災
	// charged nothing for want of a class.
	const run = (
		person: Person,
		plant?: (world: PayrollWorld) => void,
		riskClass: string | null = '1'
	) => buildStatutory({ code: 'TW', period: '2026-01', riskClass, people: [person] }, plant);
	const base = { key: 'TW-D16', wage: 40_000 } as const;
	assert.throws(
		() =>
			run(base, (world) => {
				world.employees[0]!.date_of_birth = null as never;
			}),
		/(勞工保險條例 §6\(1\)|就業保險法 §5\(1\)).*Record the date of birth/
	);
	assert.throws(
		() =>
			run(base, (world) => {
				world.employment_terms[0]!.residency_status = null as never;
			}),
		/就業保險法 §5\(1\).*residency status/
	);
	assert.throws(
		() =>
			run({ ...base, citizenship: 'FOREIGNER' }, (world) => {
				world.employment_terms[0]!.pass_type = null as never;
			}),
		/勞工退休金條例 §7.*pass type/
	);
	assert.throws(() => run(base, undefined, null), /災害費率表.*risk class/);
});

test('TW round 5 — D15: unrecorded entity declarations read as the statute’s own rule, never its exception', () => {
	// overtime_consent, shift_or_continuous_work and responsibility_system default to false:
	// 勞基法 §32(2)'s 46-hour month, §35's unpaid break, and §30–§32 hours (no §84-1 approval).
	for (const field of settingsVersions('TW').flatMap((version) => version.facts))
		if (
			['overtime_consent', 'shift_or_continuous_work', 'responsibility_system'].includes(field.key)
		)
			assert.equal(field.default_value, false, field.key);
});

test('TW round 5 — D22: the hosted read keeps dated entity facts and wage periods apart', () => {
	// The hosted run preloads its world in one wave; the company's dated fact revisions and the
	// employment's wage periods were read into each other's slot, so a dated revision (the
	// January reserve rate) never governed a hosted run and a wage record was never found.
	const world = createStatutoryWorld({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [{ key: 'TW-PRELOAD', wage: 50_000 }]
	});
	world.company_facts = [
		{
			id: 'd9400000-0000-4000-8000-000000000001',
			company_id: COMPANY_ID,
			facts: { pension_reserve_rate: 6 },
			effective_range: { start: '2026-01-01', end: '2026-01-31' },
			approval_id: null
		}
	] as never;
	world.employment_wage_periods = [
		{
			id: 'd9400000-0000-4000-8000-000000000002',
			employment_id: world.employments[0]!.id,
			period: { start: '2025-12-01', end: '2025-12-31' },
			normal_wages: { currency: 'TWD', value: 50_000 },
			ordinary_wages: null,
			ordinary_days: null,
			due_on: '2025-12-31',
			paid_on: '2025-12-31',
			reference: 'December 2025',
			approval_id: null
		}
	] as never;
	const worlds = Effect.runSync(
		preloadPayrollWorlds(memoryPayrollApi(world).db as never, [
			{ company_id: COMPANY_ID, period: '2026-01' }
		])
	);
	const loaded = worlds.get(`${COMPANY_ID}:2026-01`)!;
	assert.deepEqual(
		loaded.company_facts.map((row) => row.id),
		['d9400000-0000-4000-8000-000000000001']
	);
	assert.deepEqual(
		loaded.employment_wage_periods.map((row) => row.id),
		['d9400000-0000-4000-8000-000000000002']
	);
});

// ── D28 / G16: the 2027 version ─────────────────────────────────────────────────────────────────

test('TW round 5 — D28: 勞保條例 §13(2) steps the ordinary rate to its 13% cap on 1 January 2027 (12% net of 就保)', () => {
	// §13(2): 保險費率定為百分之七點五 (the 2009 commencement), 施行後第三年調高百分之零點五，其後每年
	// 調高百分之零點五至百分之十，並自百分之十當年起，每兩年調高百分之零點五至上限百分之十三 — MOL's
	// announced steps: 11.5% from 1 January 2021 (勞動部 110年公告, https://www.mol.gov.tw/announcement/2099/46792/),
	// 12% from 2023, 12.5% from 2025; the next two-yearly step is 13%, the cap, on 1 January 2027,
	// unless the fund could pay twenty years of benefits (§13(2) 但書; it cannot). 就業保險法 §41(2)
	// takes the 1% employment-insurance rate out of it: LI 12%. Grade 34,800 (January 2027 still
	// on the 115年 ladder): worker 34,800 × 12% × 20% = 835.20 → 835; employer × 70% = 2,923.20 →
	// 2,923. EI stays 1%: 69.60 → 70 and 243.60 → 244.
	const book = assessStatutory({
		code: 'TW',
		period: '2027-01',
		riskClass: '1',
		people: [INSURED_PERSON]
	}).get('TW-COVER')!;
	assert.deepEqual([book.get('LI')!.employee, book.get('LI')!.employer], [835, 2923]);
	assert.deepEqual([book.get('EI')!.employee, book.get('EI')!.employer], [70, 244]);
});

test('TW round 5 — G16: the 2027 version keeps the 115年 minimum wage until the 116年 figure is published', () => {
	// 最低工資法 §9–§10: the 審議會 meets in the third quarter and the Executive Yuan approves; the
	// 116年 meeting is 24 September 2026 and nothing is published on 23 September 2026. The version
	// sealed from 1 January 2027 therefore carries 115年's NT$29,500 a month (勞動部 114年9月 公告;
	// NT$196 an hour), and the drift automation reads MOL's announcement feeds, the BLI grade and
	// premium tables and the gazette monthly to propose the 116年 figures when they appear.
	const version = settingsVersions('TW').find((row) =>
		String(row.effective_range.start).startsWith('2027-01-01')
	)!;
	assert.equal(version.work_rules.wages.by_region.Taiwan, 29_500);
});

test('TW round 5 — WAGES is a reserved counts_toward mark, not a scheme the version must declare', () => {
	const schemes = new Map([['INCOME_TAX', [] as string[]]]);
	assert.doesNotThrow(() =>
		refuseUnknownMemberships(schemes, ['WAGES', 'INCOME_TAX'], 'Ad hoc COMMISSION')
	);
	assert.throws(
		() => refuseUnknownMemberships(schemes, ['WAGE'], 'Ad hoc COMMISSION'),
		/has no scheme WAGE/
	);
});
