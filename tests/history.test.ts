/**
 * E4 history accessor goldens (docs/capability-plan.md §E4), hand-computed over jurisdiction-free
 * fixtures: the accessor lists saved rows in a window; the arithmetic below is what a stored
 * expression would write over them.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	historyAccess,
	openingsOf,
	slipsOf,
	type HistoryLeaveEntry,
	type HistoryPayslip,
	type HistorySlip,
	type HistoryWorkDay
} from '../src/lib/payroll/history.ts';
import {
	HISTORY_FUNCTIONS,
	daysBefore,
	historyReachDays,
	historyWindowFault,
	monthsBefore,
	rolling,
	serviceYearOf,
	yearOf
} from '../src/lib/expressions/functions/history.ts';
import { monthBounds } from '../src/lib/payroll/run/dates.ts';

const COMPONENTS = new Map([
	['BASIC', { direction: 'ADD' as const, counts_toward: ['WAGES', 'FUND'] }],
	['BACKPAY', { direction: 'ADD' as const, counts_toward: ['WAGES'] }],
	['BONUS', { direction: 'ADD' as const, counts_toward: [] }]
]);

/** A whole-month slip paying `amount` of BASIC, run `run-<month>`. */
function monthSlip(
	month: string,
	amount: number,
	extra: Partial<HistoryPayslip> = {}
): HistoryPayslip {
	const { start, end } = monthBounds(month);
	return {
		id: `slip-${month}`,
		payroll_run_id: `run-${month}`,
		status: 'PAID',
		paid_at: `${end}T10:00:00.000Z`,
		base: [{ component_code: 'BASIC', amount }],
		proration: [{ component_code: 'BASIC', from: start, to: end, prorated_amount: amount }],
		adjustments: [],
		statutory: [{ scheme_code: 'FUND', base_amount: amount }],
		...extra
	};
}

function slipsFor(payslips: readonly HistoryPayslip[], dates: Record<string, string> = {}) {
	return slipsOf({
		payslips,
		periodByRun: new Map(
			payslips.map((slip) => [slip.payroll_run_id, slip.payroll_run_id.slice(4)])
		),
		components: COMPONENTS,
		sourceDate: (_family, id) => dates[id] ?? null
	});
}

function access(options: {
	slips?: readonly HistorySlip[];
	workDays?: readonly HistoryWorkDay[];
	daysFrom?: string;
	leave?: readonly HistoryLeaveEntry[];
	external?: Parameters<typeof historyAccess>[0]['external'];
	terms?: Parameters<typeof historyAccess>[0]['terms'];
}) {
	return historyAccess({
		slips: options.slips ?? [],
		workDays: options.workDays ?? [],
		daysFrom: options.daysFrom ?? '2020-01-01',
		leave: options.leave ?? [],
		terms: options.terms ?? [],
		external: options.external ?? [],
		keys: {
			codes: ['BASIC', 'BACKPAY', 'BONUS'],
			classes: ['WAGES', 'FUND'],
			schemes: ['FUND'],
			leave: ['MAT', 'SICK']
		}
	});
}

const leaveDays = (
	id: string,
	code: string,
	dates: readonly string[],
	more: Partial<HistoryLeaveEntry> = {}
) => ({
	id,
	leave_code: code,
	activity: 'TIME_OFF',
	charges: dates.map((date) => ({ date, days: 1 })),
	...more
});

const workDay = (date: string, hours: number): HistoryWorkDay => ({
	work_date: date,
	worked_intervals: [
		{
			start: `${date}T00:00:00.000Z`,
			end: new Date(Date.parse(`${date}T00:00:00.000Z`) + hours * 3_600_000).toISOString()
		}
	]
});

const dayRange = (from: string, count: number) =>
	Array.from({ length: count }, (_, index) =>
		new Date(Date.parse(`${from}T00:00:00.000Z`) + index * 86_400_000).toISOString().slice(0, 10)
	);

test('history: a 3-month calendar-day average leaves the maternity months out', () => {
	const history = access({
		slips: slipsFor([
			monthSlip('2026-01', 3100),
			monthSlip('2026-02', 1400),
			monthSlip('2026-03', 3100)
		]),
		leave: [leaveDays('mat-1', 'MAT', dayRange('2026-02-02', 5))]
	});
	const window = monthsBefore('2026-04-15', 3);
	assert.deepEqual(window, { from: '2026-01-01', to: '2026-03-31' });
	const slips = history.slips(window);
	assert.equal(slips.length, 3);
	assert.equal(slips[1]!.leave.MAT, 5);
	const kept = slips.filter((slip) => slip.leave.MAT === 0);
	// (3100 + 3100) / (31 + 31) calendar days = 100.
	const wages = kept.reduce((sum, slip) => sum + slip.classes.WAGES!, 0);
	const days = kept.reduce((sum, slip) => sum + slip.days.covered, 0);
	assert.equal(wages / days, 100);
});

test('history: the average-wage floor is max(total / calendar days, 0.6 × total / days worked)', () => {
	const history = access({
		slips: slipsFor([
			monthSlip('2026-01', 30000),
			monthSlip('2026-02', 30000),
			monthSlip('2026-03', 30000)
		]),
		workDays: dayRange('2026-01-05', 50).map((date) => workDay(date, 8)),
		daysFrom: '2026-01-01'
	});
	const window = monthsBefore('2026-04-01', 3);
	const total = history.slips(window).reduce((sum, slip) => sum + slip.classes.WAGES!, 0);
	const calendar = history.days(window).length;
	const worked = history.days(window).filter((day) => day.hours > 0).length;
	assert.deepEqual([total, calendar, worked], [90000, 90, 50]);
	// 90000 / 90 = 1000; 0.6 × 90000 / 50 = 1080: the floor wins.
	assert.equal(Math.max(total / calendar, (0.6 * total) / worked), 1080);
});

test('history: a rolling 7-day window across a month edge', () => {
	const dates = dayRange('2026-01-26', 14);
	const heavy = new Set(dayRange('2026-01-29', 7)); // 29 Jan – 4 Feb
	const history = access({
		workDays: dates.map((date) => workDay(date, heavy.has(date) ? 10 : 8)),
		daysFrom: '2026-01-01'
	});
	const hours = history.days({ from: '2026-01-26', to: '2026-02-08' }).map((day) => day.hours);
	const windows = rolling(hours, 7);
	assert.equal(windows.length, 8);
	const sums = windows.map((run) => (run as number[]).reduce((a, b) => a + b, 0));
	assert.equal(Math.max(...sums), 70);
	assert.equal(sums[0], 3 * 8 + 4 * 10);
});

test('history: a 12-month average over a shorter tenure divides by the months served', () => {
	const months = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];
	const history = access({ slips: slipsFor(months.map((month) => monthSlip(month, 2000))) });
	const window = monthsBefore('2026-04-01', 12);
	assert.deepEqual(window, { from: '2025-04-01', to: '2026-03-31' });
	const slips = history.slips(window);
	const served = new Set(slips.map((slip) => slip.wage_month)).size;
	// 12000 over the 6 months served, not over 12.
	assert.equal(
		slips.reduce((sum, slip) => sum + slip.classes.WAGES!, 0) / Math.min(12, served),
		2000
	);
});

test('history: arrears land in their wage month; the base stays in the pay month', () => {
	const march = monthSlip('2026-03', 3000, {
		adjustments: [
			{
				family: 'ADHOC',
				source_id: 'backpay-1',
				component_code: 'BACKPAY',
				bucket: 'EARNING',
				amount: 500
			}
		]
	});
	const slips = slipsFor([march], { 'backpay-1': '2026-01-15' });
	assert.equal(slips.length, 2);
	const history = access({ slips });
	const [january] = history.slips(monthsBefore('2026-02-10', 1));
	assert.equal(january!.wage_month, '2026-01');
	assert.equal(january!.pay_month, '2026-03');
	assert.equal(january!.lines.BACKPAY, 500);
	assert.equal(january!.lines.BASIC, 0);
	assert.equal(january!.bases.FUND, 0);
	const [own] = history.slips(monthsBefore('2026-04-10', 1));
	assert.equal(own!.lines.BASIC, 3000);
	assert.equal(own!.classes.FUND, 3000);
	assert.equal(own!.bases.FUND, 3000);
});

test('history: an unpaid day is a negative line and counts as unpaid', () => {
	const slip = monthSlip('2026-05', 3100, {
		adjustments: [
			{
				family: 'LEAVE',
				source_id: 'npl',
				component_code: 'BASIC',
				bucket: 'ABSENCE',
				amount: 200,
				quantity: 2
			}
		]
	});
	const [may] = slipsFor([slip], { npl: '2026-05-12' });
	assert.equal(may!.lines.BASIC, 2900);
	assert.equal(may!.classes.WAGES, 2900);
	assert.equal(may!.days.unpaid, 2);
});

test('history: a year to date runs across tax years from any start month', () => {
	assert.deepEqual(yearOf('2026-05-10', 4), { from: '2026-04-01', to: '2027-03-31' });
	assert.deepEqual(yearOf('2026-02-10', 4), { from: '2025-04-01', to: '2026-03-31' });
	assert.deepEqual(yearOf('2026-02-10'), { from: '2026-01-01', to: '2026-12-31' });
	const history = access({
		slips: slipsFor(
			['2025-03', '2025-04', '2025-12', '2026-01', '2026-02'].map((m) => monthSlip(m, 1000))
		)
	});
	// The April tax year holding 10 Mar 2026, to the day before: April 2025 – February 2026.
	const ytd = { from: yearOf('2026-03-10', 4).from, to: '2026-03-09' };
	assert.equal(
		history.slips(ytd).reduce((sum, slip) => sum + slip.lines.BASIC!, 0),
		4000
	);
});

test('history: a prior employer’s opening is read from recorded history, clipped to the window', () => {
	const history = access({
		external: [
			{
				kind: 'PRIOR_EMPLOYER',
				effective_range: { from: '2026-01-01', to: '2026-02-28' },
				facts: { gross: 8000 }
			},
			{
				kind: 'PRIOR_EMPLOYER',
				effective_range: { from: '2025-01-01', to: '2025-06-30' },
				facts: { gross: 9000 }
			},
			{ kind: 'INSURED', effective_range: { from: '2026-01-01', to: null }, facts: {} }
		]
	});
	const rows = history.external('PRIOR_EMPLOYER', yearOf('2026-06-15'));
	assert.equal(rows.length, 1);
	assert.equal(rows[0]!.days, 59);
	assert.equal(rows[0]!.facts.gross, 8000);
});

test('history: opening pay recorded before the workspace is an opening slip', () => {
	const [opening] = openingsOf([
		{
			id: 'wp-1',
			period: { from: '2025-12-01', to: '2025-12-31' },
			currency: 'XXX',
			normal_wages: 2400,
			ordinary_wages: 2600,
			ordinary_days: 26,
			due_on: '2026-01-07',
			paid_on: '2026-01-07',
			reference: 'opening'
		}
	]);
	assert.equal(opening!.opening, true);
	assert.equal(opening!.wage_month, '2025-12');
	assert.equal(opening!.pay_month, '2026-01');
	assert.deepEqual(opening!.recorded, {
		normal_wages: 2400,
		ordinary_wages: 2600,
		ordinary_days: 26
	});
	assert.equal(access({ slips: [opening!] }).slips(monthsBefore('2026-01-05', 1)).length, 1);
});

test('history: leave groups by episode across a period edge; a reversed entry is gone', () => {
	const history = access({
		leave: [
			leaveDays('ep-open', 'MAT', dayRange('2026-02-23', 6)),
			leaveDays('ep-more', 'MAT', dayRange('2026-03-01', 4), { episode_id: 'ep-open' }),
			leaveDays('sick', 'SICK', ['2026-03-10']),
			leaveDays('undo', 'SICK', ['2026-03-10'], { activity: 'REVERSAL', reversal_of_id: 'sick' })
		]
	});
	const episodes = history.leave({ from: '2026-03-01', to: '2026-03-31' });
	assert.deepEqual(episodes, [
		{
			episode: 'ep-open',
			code: 'MAT',
			from: '2026-02-23',
			to: '2026-03-04',
			days: 4,
			total_days: 10
		}
	]);
});

test('history: terms touching the window, with their fields', () => {
	const history = access({
		terms: [
			{ effective_range: { from: '2025-01-01', to: '2025-12-31' }, wage: 2000, kind: 'FIXED' },
			{ effective_range: { from: '2026-01-01', to: null }, wage: 2500, kind: 'FIXED' },
			{ effective_range: { from: '2024-01-01', to: '2024-12-31' }, wage: 1800, kind: 'FIXED' }
		]
	});
	const terms = history.terms({ from: '2025-06-01', to: '2026-03-31' });
	assert.deepEqual(
		terms.map((row) => [row.from, row.to, row.wage]),
		[
			['2025-01-01', '2025-12-31', 2000],
			['2026-01-01', '', 2500]
		]
	);
});

test('history: days before the loaded work days refuse instead of reading blank', () => {
	const history = access({ daysFrom: '2026-01-01' });
	assert.throws(
		() => history.days({ from: '2025-12-31', to: '2026-01-02' }),
		/before the work days/
	);
	assert.equal(
		history.days({ from: '2026-01-01', to: '2026-01-02' }).every((day) => !day.recorded),
		true
	);
});

test('history: window functions', () => {
	assert.deepEqual(monthsBefore('2026-03-31', 3, 1), { from: '2025-11-01', to: '2026-01-31' });
	assert.deepEqual(monthsBefore('2026-03-31', 0), { from: '', to: '' });
	assert.deepEqual(daysBefore('2026-03-01', 7), { from: '2026-02-22', to: '2026-02-28' });
	assert.deepEqual(serviceYearOf('2026-03-01', '2024-02-29'), {
		from: '2026-02-28',
		to: '2027-02-27'
	});
	assert.deepEqual(serviceYearOf('2026-01-10', '2024-06-15'), {
		from: '2025-06-15',
		to: '2026-06-14'
	});
	assert.deepEqual(serviceYearOf('2024-01-10', '2024-06-15'), { from: '', to: '' });
	assert.deepEqual(rolling([1, 2, 3], 4), []);
});

test('history: a window count must be a literal, and the literals size the days load', () => {
	assert.match(historyWindowFault('months_before(period.start, scheme.facts.n)') ?? '', /literal/);
	assert.equal(
		historyWindowFault(
			'sum(history.slips(months_before(period.start, 3, 1)).map(s, s.lines.BASIC))'
		),
		null
	);
	assert.match(historyWindowFault('rolling(xs, n)') ?? '', /literal/);
	assert.equal(
		historyReachDays(['sum(history.days(months_before(period.start, 3)).map(d, d.hours))']),
		124
	);
	assert.equal(historyReachDays(['history.days(days_before(period.start, 200)).size()']), 200);
	assert.equal(
		historyReachDays(['sum(history.slips(months_before(period.start, 12)).map(s, s.lines.BASIC))']),
		0
	);
});

test('history: a site with no history bound refuses', () => {
	const slips = HISTORY_FUNCTIONS.find((entry) => entry.signature === 'map.slips(map): list')!;
	assert.throws(
		() => slips.handler({ minimumWage: () => 0 }, {}, { from: '2026-01-01', to: '2026-01-31' }),
		/no history bound/
	);
	const history = access({ slips: slipsFor([monthSlip('2026-01', 100)]) });
	assert.equal(
		(
			slips.handler(
				{ minimumWage: () => 0, history } as never,
				{},
				{ from: '2026-01-01', to: '2026-01-31' }
			) as unknown[]
		).length,
		1
	);
});
