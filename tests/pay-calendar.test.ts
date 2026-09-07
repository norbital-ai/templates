// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A company that pays some of its people twice a month, and the period grammar that says which run
 * is which.
 *
 * One company can hold both a `SEMI_MONTHLY` cadence and a monthly one, because Philippine law
 * requires payment at least twice a month for some people. The cadence is one fact on the company,
 * `pay_frequency`, and it decides the grammar of the company's run periods: months, `YYYY-MM`, for
 * a monthly company; halves, `YYYY-MM-1` and `YYYY-MM-2`, for a semi-monthly one. The property
 * that has to hold of the two halves is arithmetic rather than taste: **every day of the month is
 * paid by exactly one of them**, and a monthly employment at that company is paid once, in the
 * second.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	daysBetween,
	monthBounds,
	periodHalf,
	periodMonth,
	shiftPeriod
} from '../src/collections/payroll_runs/lib/dates.ts';
import {
	cadenceWindow,
	defaultPayPeriod,
	payPeriodsRemaining,
	payProjection,
	periodGrammarFault,
	resolveWindow,
	taxYearFirstPeriod,
	taxYearOf
} from '../src/collections/payroll_runs/lib/period.ts';

/** Monthly 21st→20th, plus semi-monthly 1–15 paid on the 15th and 16–end paid at the period end. */
const PH_SEMI = { name: 'Omni Plus PH', pay_cutoff_day: 21, pay_frequency: 'SEMI_MONTHLY' };

/** A monthly-only company — the shape every other entity in the workspace has. */
const MONTHLY_ONLY = { name: 'Norbital', pay_cutoff_day: 21, pay_frequency: 'MONTHLY' };

test('the period grammar: a month, or a half of one', () => {
	assert.equal(periodMonth('2026-02'), '2026-02');
	assert.equal(periodMonth('2026-02-1'), '2026-02');
	assert.equal(periodMonth('2026-02-2'), '2026-02');
	assert.equal(periodHalf('2026-02'), null);
	assert.equal(periodHalf('2026-02-1'), 1);
	assert.equal(periodHalf('2026-02-2'), 2);
	assert.throws(() => periodMonth('2026-02-3'), /YYYY-MM-1 \/ YYYY-MM-2/);
	assert.throws(() => periodMonth('2026-2'), /YYYY-MM/);
	// A shifted period keeps its half: the run before 2026-02-2 is 2026-01-2.
	assert.equal(shiftPeriod('2026-02-2', -1), '2026-01-2');
	assert.equal(shiftPeriod('2026-12-1', 1), '2027-01-1');
	assert.equal(shiftPeriod('2026-02', 1), '2026-03');
	// `monthBounds` stays strict: a run period reaches it through `periodMonth`.
	assert.throws(() => monthBounds('2026-02-1'), /YYYY-MM/);
	assert.deepEqual(monthBounds(periodMonth('2026-02-1')), {
		start: '2026-02-01',
		end: '2026-02-28'
	});
});

test('the grammar is the company: a monthly company refuses a half and a semi-monthly company refuses a month, by name', () => {
	assert.equal(periodGrammarFault('2026-02', MONTHLY_ONLY), null);
	assert.match(
		periodGrammarFault('2026-02-1', MONTHLY_ONLY),
		/Norbital pays MONTHLY.*months written YYYY-MM/
	);
	assert.equal(periodGrammarFault('2026-02-1', PH_SEMI), null);
	assert.equal(periodGrammarFault('2026-02-2', PH_SEMI), null);
	assert.match(
		periodGrammarFault('2026-02', PH_SEMI),
		/Omni Plus PH pays SEMI_MONTHLY.*YYYY-MM-1.*YYYY-MM-2.*names a whole month/
	);
	assert.throws(() => resolveWindow('2026-02-1', MONTHLY_ONLY), /pays MONTHLY/);
	assert.throws(() => resolveWindow('2026-02', PH_SEMI), /pays SEMI_MONTHLY/);
	assert.throws(() => cadenceWindow('2026-02', PH_SEMI, 'MONTHLY'), /pays SEMI_MONTHLY/);
});

test('a monthly company runs the calendar its cutoff already stated, paid at the period end', () => {
	const window = resolveWindow('2026-01', MONTHLY_ONLY);
	assert.equal(window.payFrequency, 'MONTHLY');
	assert.deepEqual(window.salary, { start: '2026-01-01', end: '2026-01-31' });
	assert.deepEqual(window.attendance, { start: '2025-12-21', end: '2026-01-20' });
	assert.equal(window.payDate, '2026-01-31');
	assert.equal(window.instalments.length, 1, 'one pay event, and it is the window itself');
	assert.deepEqual(window.instalments[0], {
		sequence: 1,
		salary: window.salary,
		attendance: window.attendance,
		payDate: window.payDate
	});
	assert.deepEqual(cadenceWindow('2026-01', MONTHLY_ONLY, 'MONTHLY'), window);
});

test('a half period pays the semi-monthly cadence exactly the instalment it names', () => {
	const first = cadenceWindow('2026-01-1', PH_SEMI, 'SEMI_MONTHLY');
	assert.equal(first.payFrequency, 'SEMI_MONTHLY');
	assert.deepEqual(first.instalments, [
		{
			sequence: 1,
			salary: { start: '2026-01-01', end: '2026-01-15' },
			attendance: { start: '2026-01-01', end: '2026-01-15' },
			payDate: '2026-01-15'
		}
	]);
	assert.deepEqual(first.salary, { start: '2026-01-01', end: '2026-01-15' });
	assert.equal(first.payDate, '2026-01-15');
	const second = cadenceWindow('2026-01-2', PH_SEMI, 'SEMI_MONTHLY');
	assert.deepEqual(second.instalments, [
		{
			sequence: 2,
			salary: { start: '2026-01-16', end: '2026-01-31' },
			attendance: { start: '2026-01-16', end: '2026-01-31' },
			payDate: '2026-01-31'
		}
	]);
});

test('the monthly cadence at a semi-monthly company exists only in the second half', () => {
	assert.equal(cadenceWindow('2026-02-1', PH_SEMI, 'MONTHLY'), null, 'nothing to pay in half 1');
	assert.equal(
		cadenceWindow('2026-02-1', PH_SEMI, 'DAILY'),
		null,
		'earned units settle monthly too'
	);
	const monthly = cadenceWindow('2026-02-2', PH_SEMI, 'MONTHLY');
	assert.deepEqual(monthly.salary, { start: '2026-02-01', end: '2026-02-28' });
	assert.deepEqual(
		monthly.attendance,
		{ start: '2026-01-21', end: '2026-02-20' },
		'the cutoff window'
	);
	assert.equal(monthly.payDate, '2026-02-28');
});

test('the run window is the envelope of every instalment the company pays in the period', () => {
	const first = resolveWindow('2026-02-1', PH_SEMI);
	assert.equal(first.instalments.length, 1, 'half 1 is the semi-monthly instalment alone');
	assert.deepEqual(first.attendance, { start: '2026-02-01', end: '2026-02-15' });
	assert.equal(first.payDate, '2026-02-15');
	const second = resolveWindow('2026-02-2', PH_SEMI);
	assert.equal(second.instalments.length, 2, 'half 2 settles both cadences');
	assert.deepEqual(second.salary, { start: '2026-02-01', end: '2026-02-28' });
	assert.deepEqual(
		second.attendance,
		{ start: '2026-01-21', end: '2026-02-28' },
		'from the monthly cutoff to the end of the semi-monthly instalment'
	);
	assert.equal(second.payDate, '2026-02-28');
});

test('the two halves are disjoint and together cover the month, in every month of the year', () => {
	for (let month = 1; month <= 12; month += 1) {
		const period = `2026-${String(month).padStart(2, '0')}`;
		const paidBy = new Map();
		for (const half of [1, 2]) {
			const window = cadenceWindow(`${period}-${half}`, PH_SEMI, 'SEMI_MONTHLY');
			for (const day of daysBetween(window.salary.start, window.salary.end)) {
				assert.equal(
					paidBy.has(day),
					false,
					`${day} is paid by half ${paidBy.get(day)} and half ${half}`
				);
				paidBy.set(day, half);
			}
		}
		const bounds = monthBounds(period);
		for (const day of daysBetween(bounds.start, bounds.end))
			assert.equal(paidBy.has(day), true, `${day} is paid by no half of ${period}`);
		assert.equal(paidBy.size, daysBetween(bounds.start, bounds.end).length);
	}
});

test('the second half closes and pays on the last day February has', () => {
	const window = cadenceWindow('2026-02-2', PH_SEMI, 'SEMI_MONTHLY');
	assert.deepEqual(window.salary, { start: '2026-02-16', end: '2026-02-28' });
	assert.equal(window.payDate, '2026-02-28');
});

/**
 * The previous-run-paid rule, the year-to-date filter and the "a later payroll exists" refusal all
 * compare period text. That is only right if the text orders chronologically, within one company's
 * grammar and across the whole year: `2026-01-2 < 2026-02-1`, and `2026-12 < 2027-01`.
 */
test('lexicographic order of the grammar is chronological within a company', () => {
	const halves = [];
	const months = [];
	for (let month = 1; month <= 12; month += 1) {
		for (const year of [2026, 2027]) {
			const key = `${year}-${String(month).padStart(2, '0')}`;
			months.push(key);
			halves.push(`${key}-1`, `${key}-2`);
		}
	}
	const byDate = (period) => cadenceWindow(period, PH_SEMI, 'SEMI_MONTHLY').payDate;
	const chronological = halves.toSorted((a, b) => byDate(a).localeCompare(byDate(b)));
	assert.deepEqual(halves.toSorted(), chronological);
	const monthlyByDate = (period) => resolveWindow(period, MONTHLY_ONLY).payDate;
	assert.deepEqual(
		months.toSorted(),
		months.toSorted((a, b) => monthlyByDate(a).localeCompare(monthlyByDate(b)))
	);
	// The tax-year helpers read the month off a half period.
	assert.equal(taxYearOf('2026-02-2', 1), '2026');
	assert.equal(taxYearOf('2026-02-2', 4), '2025');
	assert.equal(taxYearFirstPeriod('2026-02-2', 1), '2026-01');
	assert.ok('2026-01-1' >= taxYearFirstPeriod('2026-02-2', 1), 'a January half is inside the year');
});

test('a component entry defaults to the run its cadence pays it in', () => {
	// A monthly company: the money cutoff, as before.
	assert.equal(defaultPayPeriod('2026-02-21', 21), '2026-02');
	assert.equal(defaultPayPeriod('2026-02-22', 21), '2026-03');
	// Semi-monthly terms at a semi-monthly company: the half the day falls in, the 15th in the first.
	const semi = { company: PH_SEMI, payFrequency: 'SEMI_MONTHLY' };
	assert.equal(defaultPayPeriod('2026-02-15', 21, semi), '2026-02-1');
	assert.equal(defaultPayPeriod('2026-02-16', 21, semi), '2026-02-2');
	assert.equal(defaultPayPeriod('2026-02-28', 21, semi), '2026-02-2');
	// Monthly terms at a semi-monthly company: the cutoff names the month, and the second half is
	// the only run that pays them.
	const monthlyThere = { company: PH_SEMI, payFrequency: 'MONTHLY' };
	assert.equal(defaultPayPeriod('2026-02-10', 21, monthlyThere), '2026-02-2');
	assert.equal(defaultPayPeriod('2026-02-21', 21, monthlyThere), '2026-02-2');
	assert.equal(defaultPayPeriod('2026-02-22', 21, monthlyThere), '2026-03-2');
	// A monthly company ignores the cadence.
	assert.equal(
		defaultPayPeriod('2026-02-10', 21, { company: MONTHLY_ONLY, payFrequency: 'MONTHLY' }),
		'2026-02'
	);
});

/**
 * The projection counts payslips, per cadence, and knows how much of a year each one stands for.
 *
 * CONTRIBUTE projects `year-to-date + this payslip's base × (1 + future equivalents)` and spreads
 * the tax still to withhold over the payslips remaining. A semi-monthly employment now receives a
 * payslip per half, so twenty-four remain to it in January; a monthly employment at the same
 * company still receives twelve. A half-month payslip is smaller than a month, so the year after
 * it holds more than twenty-three of them: the projection of twenty-four halves lands on the same
 * annual wage as twelve months.
 */
test('the projection counts payslips per cadence and projects the same annual wage from halves as from months', () => {
	assert.equal(payPeriodsRemaining('2026-01', 1), 12);
	assert.equal(payPeriodsRemaining('2026-12', 1), 1);
	assert.equal(payPeriodsRemaining('2026-01-1', 1, 'SEMI_MONTHLY'), 24);
	assert.equal(payPeriodsRemaining('2026-01-2', 1, 'SEMI_MONTHLY'), 23);
	assert.equal(payPeriodsRemaining('2026-12-2', 1, 'SEMI_MONTHLY'), 1);
	assert.equal(payPeriodsRemaining('2026-01-2', 1, 'MONTHLY'), 12, 'a monthly employment there');
	assert.equal(payPeriodsRemaining('2026-07-1', 1, 'SEMI_MONTHLY'), 12);

	const wage = 4100;
	const monthly = payProjection('2026-01', 1, resolveWindow('2026-01', MONTHLY_ONLY));
	assert.deepEqual(monthly, { payslipsRemaining: 12, futurePayslipEquivalents: 11 });
	assert.equal(wage * (1 + monthly.futurePayslipEquivalents), 12 * wage);

	const first = payProjection('2026-01-1', 1, cadenceWindow('2026-01-1', PH_SEMI, 'SEMI_MONTHLY'));
	const second = payProjection('2026-01-2', 1, cadenceWindow('2026-01-2', PH_SEMI, 'SEMI_MONTHLY'));
	assert.equal(first.payslipsRemaining, 24);
	assert.equal(second.payslipsRemaining, 23);
	const firstBase = wage * (15 / 31);
	const secondBase = wage * (16 / 31);
	const annualFromFirst = firstBase * (1 + first.futurePayslipEquivalents);
	const annualFromSecond = firstBase + secondBase * (1 + second.futurePayslipEquivalents);
	assert.ok(Math.abs(annualFromFirst - 12 * wage) < 1e-6, `half 1 projects ${annualFromFirst}`);
	assert.ok(Math.abs(annualFromSecond - 12 * wage) < 1e-6, `half 2 projects ${annualFromSecond}`);
	// The spread: a twenty-fourth of the annual tax in half 1, then a twenty-third of what is left
	// in half 2, which is again a twenty-fourth; the month withholds a twelfth, as it did.
	const annualTax = 576;
	const firstSpread = annualTax / first.payslipsRemaining;
	const secondSpread = (annualTax - firstSpread) / second.payslipsRemaining;
	assert.ok(Math.abs(firstSpread + secondSpread - annualTax / 12) < 1e-9);

	// A monthly employment at the semi-monthly company is projected exactly as at a monthly one.
	const monthlyThere = payProjection(
		'2026-01-2',
		1,
		cadenceWindow('2026-01-2', PH_SEMI, 'MONTHLY')
	);
	assert.deepEqual(monthlyThere, { payslipsRemaining: 12, futurePayslipEquivalents: 11 });
});

test('a monthly company has no semi-monthly window to run anyone on', () => {
	assert.throws(
		() => cadenceWindow('2026-01', MONTHLY_ONLY, 'SEMI_MONTHLY'),
		/pays MONTHLY, so there is no SEMI_MONTHLY window/
	);
});
