import assert from 'node:assert/strict';
import test from 'node:test';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import { approve, id, leaveContext, submission, timeOff } from './helpers/manual-leave-context.ts';
import { refusalMessage } from './fixtures/memory-payroll-api.ts';

/**
 * The leave grammar the statutory gaps needed, exercised through the planner: a grant per event
 * with a lifetime cap, a day that counts in two pools, a pool measured over a rolling window,
 * leave by the hour, and an entitlement ladder written as a number over the person.
 */
const refusalOf = (run: () => unknown): string => {
	try {
		run();
		return '';
	} catch (error) {
		return refusalMessage(error);
	}
};
const catalogue = (
	context: ReturnType<typeof leaveContext>,
	row: Partial<ReturnType<typeof leaveContext>['catalogues'][number]> & { id: string; code: string }
) => {
	context.catalogues.push({
		settings_id: id(6),
		name: row.code,
		is_npl: false,
		can_encash: false,
		evidence_after_days: null,
		eligibility: '',
		entitlement: { availability: 'UPFRONT', proration: 'NONE', year_start_month: 1, bands: [] },
		...row
	});
};

test('a PER_EVENT row grants its band per event, reads the event, and stops at the lifetime cap', () => {
	const context = leaveContext();
	catalogue(context, {
		id: id(20),
		code: 'PATERNITY',
		eligibility: 'event.kind == "BIRTH"',
		entitlement: {
			availability: 'PER_EVENT',
			proration: 'NONE',
			year_start_month: 1,
			lifetime_events: 2,
			bands: [
				{ eligibility: 'event.kind == "BIRTH" && event.relationship == "TWINS"', days: 10 },
				{ eligibility: '', days: 5 }
			]
		}
	});
	const birth = (from: string, to: string, extra: Record<string, unknown> = {}) => ({
		...timeOff(from, to),
		event_kind: 'BIRTH',
		event_date: from,
		...extra
	});
	const plan = planLeaveActivity(
		context,
		{ ...submission(birth('2026-03-02', '2026-03-06'), 'B1'), catalogue_id: id(20) },
		id(30)
	);
	assert.equal(plan.days, 5);
	assert.equal(plan.event_kind, 'BIRTH');
	// No annual pool: a per-event entry allocates nothing.
	assert.deepEqual(plan.allocations, []);
	// Six days for a single birth is over the band.
	assert.match(
		refusalOf(() =>
			planLeaveActivity(
				context,
				{ ...submission(birth('2026-03-02', '2026-03-07'), 'B2'), catalogue_id: id(20) },
				id(31)
			)
		),
		/grants 5 days for this event; 0 are already taken and this would add 6/
	);
	// The grant is the event's, not the entry's: a second entry for the same birth (the twin's,
	// or the rest of the five filed apart) draws on what the first left — MSF: multiple births
	// carry one entitlement.
	context.entries.push({ ...plan, id: id(30), approval_id: null });
	assert.match(
		refusalOf(() =>
			planLeaveActivity(
				context,
				{
					...submission(birth('2026-03-09', '2026-03-09', { event_date: '2026-03-02' }), 'B2b'),
					catalogue_id: id(20)
				},
				id(36)
			)
		),
		/grants 5 days for this event; 5 are already taken and this would add 1/
	);
	context.entries.pop();
	// Twins read the event: ten days.
	assert.equal(
		planLeaveActivity(
			context,
			{
				...submission(birth('2026-03-02', '2026-03-11', { event_relationship: 'TWINS' }), 'B3'),
				catalogue_id: id(20)
			},
			id(32)
		).days,
		10
	);
	// Two births taken; the third is over the lifetime.
	context.entries.push({ ...plan, id: id(30), approval_id: null });
	context.entries.push({
		...planLeaveActivity(
			context,
			{ ...submission(birth('2027-05-03', '2027-05-07'), 'B4'), catalogue_id: id(20) },
			id(33)
		),
		id: id(33),
		approval_id: null
	});
	assert.match(
		refusalOf(() =>
			planLeaveActivity(
				context,
				{ ...submission(birth('2028-05-01', '2028-05-05'), 'B5'), catalogue_id: id(20) },
				id(34)
			)
		),
		/granted for 2 events in a lifetime; this would be event 3/
	);
	// A row that needs an event refuses an entry without one.
	assert.match(
		refusalOf(() =>
			planLeaveActivity(
				context,
				{ ...submission(timeOff('2026-06-01', '2026-06-02'), 'B6'), catalogue_id: id(20) },
				id(35)
			)
		),
		/cannot be approved/
	);
});

test('a row that consumes another draws on both pools, and the pool row shows what its consumers took', () => {
	const context = leaveContext();
	// Fourteen outpatient days inside sixty of hospitalisation: an outpatient day counts in both.
	catalogue(context, {
		id: id(21),
		code: 'HOSPITAL',
		entitlement: {
			availability: 'UPFRONT',
			proration: 'NONE',
			year_start_month: 1,
			bands: [{ eligibility: '', days: 60 }]
		}
	});
	catalogue(context, {
		id: id(22),
		code: 'OUTPATIENT',
		consumes_code: 'HOSPITAL',
		entitlement: {
			availability: 'UPFRONT',
			proration: 'NONE',
			year_start_month: 1,
			bands: [{ eligibility: '', days: 14 }]
		}
	});
	const plan = planLeaveActivity(
		context,
		{ ...submission(timeOff('2026-02-02', '2026-02-06'), 'O1'), catalogue_id: id(22) },
		id(40)
	);
	assert.equal(plan.days, 5);
	// One allocation per day per pool: five against its own row, five against the pool.
	const byPool = (pool: string | null) =>
		plan.allocations
			.filter((row) => (row.pool ?? null) === pool)
			.reduce((sum, row) => sum + row.days, 0);
	assert.equal(byPool(null), -5);
	assert.equal(byPool('HOSPITAL'), -5);
	context.entries.push({ ...plan, id: id(40), approval_id: null });
	const summaries = leaveBalanceSummaries(context, id(1), '2026-03-01');
	const balance = (code: string) => summaries.find((row) => row.code === code)!.balance;
	assert.equal(balance('OUTPATIENT'), 9);
	assert.equal(balance('HOSPITAL'), 55, 'the pool shows the outpatient days its consumer took');
	// Fifteen outpatient days are over the row's own fourteen even with fifty-five in the pool.
	assert.match(
		refusalOf(() =>
			planLeaveActivity(
				context,
				{ ...submission(timeOff('2026-03-02', '2026-03-13'), 'O2'), catalogue_id: id(22) },
				id(41)
			)
		),
		/Insufficient leave/
	);
});

test('a rolling-window row is measured over the months before each charge, not a leave year', () => {
	const context = leaveContext();
	// Three days in any three months.
	catalogue(context, {
		id: id(23),
		code: 'ROLLING',
		entitlement: {
			availability: 'UPFRONT',
			proration: 'NONE',
			year_start_month: 1,
			rolling_months: 3,
			bands: [{ eligibility: '', days: 3 }]
		}
	});
	const take = (from: string, to: string, n: number) =>
		planLeaveActivity(
			context,
			{ ...submission(timeOff(from, to), `R${n}`), catalogue_id: id(23) },
			id(n)
		);
	context.entries.push({ ...take('2026-01-05', '2026-01-07', 50), id: id(50), approval_id: null });
	// A fourth day inside the three months is refused; the same day three months on is not,
	// though it crosses no leave-year boundary.
	assert.match(
		refusalOf(() => take('2026-03-02', '2026-03-02', 51)),
		/allows 3 days in any 3 months/
	);
	assert.equal(take('2026-04-08', '2026-04-08', 52).days, 1);
});

test('a lifetime cap in days counts every leave year and the person’s other employments here', () => {
	const context = leaveContext();
	// GPCL: 42 days a child, as an expression over the person; the fixture's employee has one child.
	context.employees[0]!.children = [
		{ child_birthdate: '2024-01-01', relationship: 'CHILD', effective_range: null }
	];
	catalogue(context, {
		id: id(27),
		code: 'CHILDCARE',
		entitlement: {
			availability: 'UPFRONT',
			proration: 'NONE',
			year_start_month: 1,
			lifetime_days: '42.0 * children.count',
			bands: [{ eligibility: '', days: 6 }]
		}
	});
	// Forty days already taken under an earlier contract of the same person.
	const charges = Array.from({ length: 40 }, (_, index) => ({
		date: `2024-${String(1 + Math.floor(index / 20)).padStart(2, '0')}-${String(1 + (index % 20)).padStart(2, '0')}`,
		days: 1
	}));
	context.priorEntries = [
		{
			id: id(60),
			employment_id: id(61),
			employee_id: context.employees[0]!.id,
			leave_code: 'CHILDCARE',
			charges: charges as never,
			as_adjustment_entry: false,
			reversal_of_id: null,
			approval_id: null
		}
	];
	const take = (from: string, to: string, n: number) =>
		planLeaveActivity(
			context,
			{ ...submission(timeOff(from, to), `C${n}`), catalogue_id: id(27) },
			id(n)
		);
	// Two more days fit; a third is over the person's lifetime.
	assert.equal(take('2026-03-02', '2026-03-03', 62).days, 2);
	assert.match(
		refusalOf(() => take('2026-03-02', '2026-03-04', 63)),
		/granted for 42 days in a lifetime; 40 are already taken/
	);
	// The other contract's events count toward `lifetime_events` too.
	catalogue(context, {
		id: id(28),
		code: 'PATERNITY2',
		eligibility: 'event.kind == "BIRTH"',
		entitlement: {
			availability: 'PER_EVENT',
			proration: 'NONE',
			year_start_month: 1,
			lifetime_events: 1,
			bands: [{ eligibility: '', days: 2 }]
		}
	});
	context.priorEntries.push({
		id: id(64),
		employment_id: id(61),
		employee_id: context.employees[0]!.id,
		leave_code: 'PATERNITY2',
		charges: [{ date: '2024-05-06', days: 1 }] as never,
		as_adjustment_entry: false,
		reversal_of_id: null,
		approval_id: null
	});
	assert.match(
		refusalOf(() =>
			planLeaveActivity(
				context,
				{
					...submission({ ...timeOff('2026-06-01', '2026-06-02'), event_kind: 'BIRTH' }, 'P1'),
					catalogue_id: id(28)
				},
				id(65)
			)
		),
		/granted for 1 events in a lifetime; this would be event 2/
	);
});

test('a row drawing from a rolling-window pool is judged on that window, not a leave year', () => {
	const context = leaveContext();
	// TW: thirty days of sick leave a year, each counting inside a year of hospitalised sickness
	// leave measured over any two years.
	catalogue(context, {
		id: id(29),
		code: 'HOSPITALISED',
		entitlement: {
			availability: 'UPFRONT',
			proration: 'NONE',
			year_start_month: 1,
			rolling_months: 24,
			bands: [{ eligibility: '', days: 5 }]
		}
	});
	catalogue(context, {
		id: id(30),
		code: 'SICK2',
		consumes_code: 'HOSPITALISED',
		entitlement: {
			availability: 'UPFRONT',
			proration: 'NONE',
			year_start_month: 1,
			bands: [{ eligibility: '', days: 30 }]
		}
	});
	const take = (from: string, to: string, n: number) =>
		planLeaveActivity(
			context,
			{ ...submission(timeOff(from, to), `S${n}`), catalogue_id: id(30) },
			id(n)
		);
	// Four days of sick leave late in 2025 sit inside the pool's two-year window in 2026: one more
	// fits, two do not, though the sick row's own year has 26 left. Nothing is allocated on the
	// pool's leave year — the window is the judge.
	context.entries.push({ ...take('2025-11-03', '2025-11-06', 70), id: id(70), approval_id: null });
	const one = take('2026-03-02', '2026-03-02', 71);
	assert.equal(one.days, 1);
	assert.deepEqual(
		one.allocations.map((row) => row.pool ?? null),
		[null]
	);
	assert.match(
		refusalOf(() => take('2026-03-02', '2026-03-03', 72)),
		/HOSPITALISED allows 5 days in any 24 months, and SICK2 counts inside it; 4 are already taken/
	);
});

test('a public holiday enclosed by no-pay leave is charged where the version says so (SG s.88(2))', () => {
	const holiday = {
		id: 'holiday-2026-04-16',
		company_id: '00000000-0000-4000-8000-000000000003',
		date: '2026-04-16',
		name: 'Observed holiday',
		replaces: null,
		published_at: '2025-01-01T00:00:00.000Z'
	};
	const unpaid = (context: ReturnType<typeof leaveContext>) =>
		catalogue(context, {
			id: id(31),
			code: 'NPL',
			is_npl: true,
			entitlement: { availability: 'UNLIMITED', proration: 'NONE', year_start_month: 1, bands: [] }
		});
	// Wednesday to Friday of a week with Thursday a holiday: two working days by default.
	const plain = leaveContext();
	plain.holidays.push(holiday);
	unpaid(plain);
	const kept = planLeaveActivity(
		plain,
		{ ...submission(timeOff('2026-04-15', '2026-04-17'), 'N1'), catalogue_id: id(31) },
		id(80)
	);
	assert.deepEqual(
		kept.charges.map((row) => row.date),
		['2026-04-15', '2026-04-17']
	);
	// Under s.88(2) the enclosed holiday is a day of no pay too, named by its holiday.
	const sg = leaveContext();
	sg.holidays.push(holiday);
	sg.versions[0]!.payroll = { ...sg.versions[0]!.payroll, holiday_in_no_pay_leave_unpaid: true };
	unpaid(sg);
	const charged = planLeaveActivity(
		sg,
		{ ...submission(timeOff('2026-04-15', '2026-04-17'), 'N2'), catalogue_id: id(31) },
		id(81)
	);
	assert.deepEqual(
		charged.charges.map((row) => [row.date, row.holiday_id]),
		[
			['2026-04-15', null],
			['2026-04-16', 'holiday-2026-04-16'],
			['2026-04-17', null]
		]
	);
	assert.equal(charged.days, 3);
	// A range that ends on the holiday does not enclose it: the leave must stand on both sides.
	const edge = planLeaveActivity(
		sg,
		{ ...submission(timeOff('2026-04-15', '2026-04-16'), 'N3'), catalogue_id: id(31) },
		id(82)
	);
	assert.deepEqual(
		edge.charges.map((row) => row.date),
		['2026-04-15']
	);
});

test('a consuming row keeps its first days a year outside the pool (`consumes_after_days`)', () => {
	const context = leaveContext();
	catalogue(context, {
		id: id(32),
		code: 'SICK3',
		entitlement: {
			availability: 'UPFRONT',
			proration: 'NONE',
			year_start_month: 1,
			bands: [{ eligibility: '', days: 30 }]
		}
	});
	// TW 性別平等工作法 §14: menstrual leave, three days a year outside the sick quota, more inside it.
	catalogue(context, {
		id: id(33),
		code: 'MENSTRUAL3',
		consumes_code: 'SICK3',
		entitlement: {
			availability: 'MONTHLY',
			proration: 'NONE',
			year_start_month: 1,
			consumes_after_days: 3,
			bands: [{ eligibility: '', days: 1 }]
		}
	});
	const take = (date: string, n: number) =>
		planLeaveActivity(
			context,
			{ ...submission(timeOff(date, date), `M${n}`), catalogue_id: id(33) },
			id(n)
		);
	for (const [date, n] of [
		['2026-01-05', 84],
		['2026-02-02', 85],
		['2026-03-02', 86]
	] as const) {
		const plan = take(date, n);
		assert.deepEqual(
			plan.allocations.map((row) => row.pool ?? null),
			[null],
			`${date} stays outside the pool`
		);
		context.entries.push({ ...plan, id: id(n), approval_id: null });
	}
	const fourth = take('2026-04-06', 87);
	assert.deepEqual(
		fourth.allocations.map((row) => [row.pool ?? null, row.days]),
		[
			[null, -1],
			['SICK3', -1]
		],
		'the fourth day of the year draws from the sick pool'
	);
});

test('leave by the hour is a share of the shift, to the eighth, one day at a time', () => {
	const context = leaveContext();
	catalogue(context, {
		id: id(24),
		code: 'HOURLY',
		unit: 'HOUR',
		entitlement: {
			availability: 'UPFRONT',
			proration: 'NONE',
			year_start_month: 1,
			bands: [{ eligibility: '', days: 7 }]
		}
	});
	// Two hours of an eight-hour day (09:00–18:00 with an hour's break) is a quarter of it.
	const plan = planLeaveActivity(
		context,
		{ ...submission({ ...timeOff('2026-02-03'), hours: 2 }, 'H1'), catalogue_id: id(24) },
		id(60)
	);
	assert.equal(plan.days, 0.25);
	assert.deepEqual(
		plan.charges.map((row) => row.days),
		[0.25]
	);
	assert.match(
		refusalOf(() =>
			planLeaveActivity(
				context,
				{
					...submission({ ...timeOff('2026-02-03', '2026-02-04'), hours: 2 }, 'H2'),
					catalogue_id: id(24)
				},
				id(61)
			)
		),
		/one day at a time/
	);
});

test('an entitlement band may be a number over the person: a seniority ladder with no top', () => {
	const context = leaveContext();
	// Twelve days, one more for every five years of service; the fixture's contract began 2025-01-01.
	catalogue(context, {
		id: id(25),
		code: 'LADDER',
		entitlement: {
			availability: 'UPFRONT',
			proration: 'NONE',
			year_start_month: 1,
			bands: [{ eligibility: '', days: '12.0 + floor_unit(employment.service_months / 60.0)' }]
		}
	});
	context.employments[0]!.effective_range = { start: '2010-01-01', end: null };
	context.terms[0]!.effective_range = { start: '2010-01-01', end: null };
	const summaries = leaveBalanceSummaries(context, id(1), '2026-06-01');
	assert.equal(summaries.find((row) => row.code === 'LADDER')!.entitlement, 15);
});

test('a WHOLE_DAY row rounds a part-year grant to the day, a half or more up; the default keeps the half', () => {
	// MY EA s.60E(1) and SG EA s.88A(3): a fraction under a half is disregarded, a half or more is
	// a day. A contract begun on 1 August with a 16-day grant prorated on calendar months earns
	// 16 × 5/12 = 6.67 days: 6.5 on the half-day default, 7 on the whole-day rule.
	for (const [rounding, expected] of [
		[undefined, 6.5],
		['HALF_DAY', 6.5],
		['WHOLE_DAY', 7]
	] as const) {
		const context = leaveContext();
		catalogue(context, {
			id: id(26),
			code: 'ROUNDED',
			entitlement: {
				availability: 'UPFRONT',
				proration: 'CALENDAR_MONTHS',
				year_start_month: 1,
				...(rounding == null ? {} : { rounding }),
				bands: [{ eligibility: '', days: 16 }]
			}
		});
		context.employments[0]!.effective_range = { start: '2026-08-01', end: null };
		context.terms[0]!.effective_range = { start: '2026-08-01', end: null };
		const summaries = leaveBalanceSummaries(context, id(1), '2026-12-31');
		assert.equal(summaries.find((row) => row.code === 'ROUNDED')!.entitlement, expected);
	}
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The deducted share of a charged day: `pay_fraction`, `paid_by: FUND`, and what counts unpaid.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import {
	withLeaveDeductionEligibility,
	calculateLeavePayroll,
	unpaidLeaveDays
} from '../src/lib/leave/payroll.ts';

test('a part-paid row deducts the unpaid share, a fund-paid row the whole day, and both count as unpaid days', () => {
	const context = leaveContext();
	const employee = { ...context.employees[0]!, children: [] };
	const term = context.terms[0]!;
	const rows = {
		SICK: {
			...context.catalogues[0]!,
			id: id(70),
			code: 'SICK',
			is_npl: false,
			paid_by: 'EMPLOYER',
			pay_fraction: 'leave.month_index <= 1 ? 1.0 : 0.75'
		},
		FUND: {
			...context.catalogues[0]!,
			id: id(71),
			code: 'FUND',
			is_npl: false,
			paid_by: 'FUND',
			pay_fraction: ''
		},
		PAID: {
			...context.catalogues[0]!,
			id: id(72),
			code: 'PAID',
			is_npl: false,
			paid_by: 'EMPLOYER',
			pay_fraction: ''
		}
	} as const;
	const entry = (n: number, row: (typeof rows)[keyof typeof rows], dates: readonly string[]) => ({
		id: id(n),
		employment_id: id(1),
		catalogue_id: row.id,
		leave_code: row.code,
		reference: `E${n}`,
		from_date: dates[0]!,
		to_date: dates.at(-1)!,
		half_day_start: false,
		half_day_end: false,
		days: dates.length,
		hours: null,
		encash_days: null,
		as_adjustment_entry: false,
		reversal_of_id: null,
		effective_on: dates[0]!,
		due_on: null,
		destination_from: null,
		destination_to: null,
		available_from: null,
		expires_on: null,
		reason: null,
		event_kind: null,
		event_relationship: null,
		event_child_index: null,
		event_date: null,
		charges: dates.map((date) => ({
			date,
			days: 1,
			catalogue_id: row.id,
			employment_term_id: term.id,
			holiday_id: null,
			shift_definition_id: id(8),
			work_day_id: null
		})),
		allocations: [],
		approval_id: null,
		payslip_id: null
	});
	// A sick spell from 2 February into March: the February days are in month one, the March
	// ones in month two, at 75%; the run reads the March window.
	const gathered = {
		entries: [
			entry(80, rows.SICK, ['2026-03-02', '2026-03-03', '2026-04-01']),
			entry(81, rows.FUND, ['2026-04-02']),
			entry(82, rows.PAID, ['2026-04-03'])
		],
		catalogues: Object.values(rows),
		captures: []
	};
	const prepared = withLeaveDeductionEligibility(gathered, {
		employment: context.employments[0]!,
		employee: employee as never,
		company: {
			id: id(3),
			name: 'Fixture',
			settings_code: 'TEST',
			region: null,
			facts: {}
		} as never,
		terms: [term as never]
	});
	assert.deepEqual(prepared.deductionShare, {
		[`${id(80)}/2026-03-02`]: 0,
		[`${id(80)}/2026-03-03`]: 0,
		[`${id(80)}/2026-04-01`]: 0.25,
		[`${id(81)}/2026-04-02`]: 1
	});
	// The whole spell settles in the window that holds all of it.
	const window = { start: '2026-03-01', end: '2026-04-30' };
	const settled = calculateLeavePayroll({
		prepared,
		window,
		dueThrough: '2026-04-30',
		currency: 'MYR',
		absenceRate: () => 100,
		ordinaryDayRate: () => 100
	});
	const items = settled.captures.flatMap((capture) =>
		capture.pay_items.map((item) => [item.code, item.amount])
	);
	// A quarter of the second-month sick day, the whole fund-paid day, nothing for the paid one.
	assert.deepEqual(items, [
		['SICK', 25],
		['FUND', 100]
	]);
	// The unpaid days a jurisdiction counts (VN art.33(5)): the shares, not the calendar days.
	assert.equal(unpaidLeaveDays(prepared, { start: '2026-04-01', end: '2026-04-30' }), 1.25);
});
