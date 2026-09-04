// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A company that pays some of its people twice a month.
 *
 * One company can hold both a `SEMI_MONTHLY` cadence and a monthly one, because Philippine law
 * requires payment at least twice a month for some people. One company, two cadences, and the
 * property that has to hold of the pair is arithmetic rather than taste:
 * **every day of the month is paid by exactly one instalment**. A day covered twice is a day paid
 * twice, a day covered by none is a day nobody is ever paid for, and both look like an ordinary
 * payslip until a year-end reconciliation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { daysBetween, monthBounds } from '../src/collections/payroll_runs/lib/dates.ts';
import { payPeriodsRemaining, resolveWindow } from '../src/collections/payroll_runs/lib/period.ts';

/** Monthly 21st→20th paid on the 30th, plus semi-monthly 1–15 and 16–end. */
const PH_SEMI = {
	pay_cutoff_day: 21,
	pay_day: 30,
	pay_calendar: [
		{
			pay_frequency: 'SEMI_MONTHLY',
			instalments: [
				{ start_day: 1, end_day: 15, pay_day: 15 },
				{ start_day: 16, end_day: 31, pay_day: 30 }
			]
		}
	]
};

/** A monthly-only company — the shape every other entity in the workspace has. */
const MONTHLY_ONLY = { pay_cutoff_day: 21, pay_day: 28, pay_calendar: null };

test('a monthly cadence is the calendar the company columns already stated', () => {
	const window = resolveWindow('2026-01', MONTHLY_ONLY);
	assert.equal(window.payFrequency, 'MONTHLY');
	assert.deepEqual(window.salary, { start: '2026-01-01', end: '2026-01-31' });
	assert.deepEqual(window.attendance, { start: '2025-12-21', end: '2026-01-20' });
	assert.equal(window.payDate, '2026-01-28');
	assert.equal(window.instalments.length, 1, 'one pay event, and it is the window itself');
	assert.deepEqual(window.instalments[0], {
		sequence: 1,
		salary: window.salary,
		attendance: window.attendance,
		payDate: window.payDate
	});
});

test('a semi-monthly cadence resolves to two pay events with their own window and pay date', () => {
	const window = resolveWindow('2026-01', PH_SEMI, 'SEMI_MONTHLY');
	assert.equal(window.payFrequency, 'SEMI_MONTHLY');
	assert.equal(window.instalments.length, 2);
	assert.deepEqual(window.instalments[0], {
		sequence: 1,
		salary: { start: '2026-01-01', end: '2026-01-15' },
		attendance: { start: '2026-01-01', end: '2026-01-15' },
		payDate: '2026-01-15'
	});
	assert.deepEqual(window.instalments[1], {
		sequence: 2,
		salary: { start: '2026-01-16', end: '2026-01-31' },
		attendance: { start: '2026-01-16', end: '2026-01-31' },
		payDate: '2026-01-30'
	});
	// The window itself is the envelope of its instalments: a run settles all of them together.
	assert.deepEqual(window.salary, { start: '2026-01-01', end: '2026-01-31' });
	assert.equal(window.payDate, '2026-01-30', 'the last pay date of the period');
});

test('the two windows are disjoint and together cover the month, in every month of the year', () => {
	for (let month = 1; month <= 12; month += 1) {
		const period = `2026-${String(month).padStart(2, '0')}`;
		const window = resolveWindow(period, PH_SEMI, 'SEMI_MONTHLY');
		const paidBy = new Map();
		for (const instalment of window.instalments)
			for (const day of daysBetween(instalment.salary.start, instalment.salary.end)) {
				assert.equal(
					paidBy.has(day),
					false,
					`${day} is paid by instalment ${paidBy.get(day)} and instalment ${instalment.sequence}`
				);
				paidBy.set(day, instalment.sequence);
			}
		const month_ = monthBounds(period);
		for (const day of daysBetween(month_.start, month_.end))
			assert.equal(paidBy.has(day), true, `${day} is paid by no instalment of ${period}`);
		assert.equal(
			paidBy.size,
			daysBetween(month_.start, month_.end).length,
			`${period} has instalment days outside the month`
		);
	}
});

test('an instalment stated to the 31st closes on the last day February has', () => {
	const window = resolveWindow('2026-02', PH_SEMI, 'SEMI_MONTHLY');
	assert.deepEqual(window.instalments[1].salary, { start: '2026-02-16', end: '2026-02-28' });
	assert.equal(window.instalments[1].payDate, '2026-02-28', 'a 30th pay day clamps with the month');
});

/**
 * The pay events and the payslips are different counts, and only one of them may be projected.
 *
 * CONTRIBUTE projects `year-to-date + this payslip's base × periods remaining` and spreads the tax
 * back over the same number. A run settles every instalment of its period in one payslip carrying
 * the whole month's wages, so twelve payslips remain to a semi-monthly employment in January
 * exactly as they do to a monthly one. Its twenty-four pay events are a real fact about it and are
 * derived from the window, not from this function.
 */
test('the projection counts payslips, and a semi-monthly employment still receives twelve', () => {
	assert.equal(payPeriodsRemaining('2026-01', 1), 12);
	assert.equal(payPeriodsRemaining('2026-12', 1), 1);
	const semiMonthly = resolveWindow('2026-01', PH_SEMI, 'SEMI_MONTHLY');
	const monthly = resolveWindow('2026-01', PH_SEMI);
	assert.equal(monthly.instalments.length, 1);
	assert.equal(semiMonthly.instalments.length, 2);
	// Both cadences are settled by the same run over the same calendar month, so both are projected
	// over the same twelve payslips — the envelope of a semi-monthly period is the month itself.
	assert.deepEqual(semiMonthly.salary, monthly.salary);
	assert.equal(
		payPeriodsRemaining('2026-01', 1) * semiMonthly.instalments.length,
		24,
		'twenty-four pay events remain to them, which is not what the projection multiplies'
	);
	assert.equal(payPeriodsRemaining('2026-07', 1) * semiMonthly.instalments.length, 12);
});

test('a cadence the company never wrote a calendar for has no window to run on', () => {
	assert.throws(
		() => resolveWindow('2026-01', MONTHLY_ONLY, 'SEMI_MONTHLY'),
		/states no SEMI_MONTHLY pay calendar/
	);
});

test('a calendar that leaves a day to nobody, or pays one twice, is refused on read', () => {
	const gap = {
		pay_cutoff_day: 21,
		pay_day: 30,
		pay_calendar: [
			{
				pay_frequency: 'SEMI_MONTHLY',
				instalments: [
					{ start_day: 1, end_day: 15, pay_day: 15 },
					{ start_day: 17, end_day: 31, pay_day: 30 }
				]
			}
		]
	};
	assert.throws(
		() => resolveWindow('2026-01', gap, 'SEMI_MONTHLY'),
		/paid twice or paid by nobody/
	);

	const overlap = {
		pay_cutoff_day: 21,
		pay_day: 30,
		pay_calendar: [
			{
				pay_frequency: 'SEMI_MONTHLY',
				instalments: [
					{ start_day: 1, end_day: 16, pay_day: 15 },
					{ start_day: 16, end_day: 31, pay_day: 30 }
				]
			}
		]
	};
	assert.throws(
		() => resolveWindow('2026-01', overlap, 'SEMI_MONTHLY'),
		/paid twice or paid by nobody/
	);

	const short = {
		pay_cutoff_day: 21,
		pay_day: 30,
		pay_calendar: [
			{
				pay_frequency: 'SEMI_MONTHLY',
				instalments: [
					{ start_day: 1, end_day: 15, pay_day: 15 },
					{ start_day: 16, end_day: 30, pay_day: 30 }
				]
			}
		]
	};
	assert.throws(
		() => resolveWindow('2026-01', short, 'SEMI_MONTHLY'),
		/paid by no instalment of 2026-01/
	);
});
