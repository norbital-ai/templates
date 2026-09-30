/**
 * The expression kernel: stepped rounding, variadic min/max, list totals, date spans, and the
 * rate, obligation, filing and case sites. Every figure below is hand-computed; the fixtures name
 * no jurisdiction.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { compileExpression } from '../src/lib/expressions/compile.ts';
import { EXPRESSION_CONTEXTS } from '../src/lib/expressions/contexts.ts';
import {
	evaluateBoolean,
	evaluateDate,
	evaluateNumber,
	programFor,
	runtimeExpressionEngine
} from '../src/lib/expressions/evaluate.ts';
import { roundStep } from '../src/lib/payroll/run/rounding.ts';

const plain = runtimeExpressionEngine();
const run = (expression: string, context: Record<string, unknown> = {}) =>
	evaluateNumber(plain, expression, context);

test('round(value, step, mode): every mode, both signs, every step', () => {
	const cases: readonly (readonly [number, number, string, number])[] = [
		// HALF_UP takes a half away from zero
		[1.125, 0.01, 'HALF_UP', 1.13],
		[-1.125, 0.01, 'HALF_UP', -1.13],
		[2.5, 1, 'HALF_UP', 3],
		[-2.5, 1, 'HALF_UP', -3],
		[81.375, 0.01, 'HALF_UP', 81.38],
		// HALF_EVEN takes a half to the even multiple
		[1.125, 0.01, 'HALF_EVEN', 1.12],
		[1.135, 0.01, 'HALF_EVEN', 1.14],
		[2.5, 1, 'HALF_EVEN', 2],
		[3.5, 1, 'HALF_EVEN', 4],
		[-2.5, 1, 'HALF_EVEN', -2],
		[2.6, 1, 'HALF_EVEN', 3],
		// UP is toward +∞, DOWN toward −∞
		[1.21, 0.05, 'UP', 1.25],
		[-1.21, 0.05, 'UP', -1.2],
		[1.29, 0.05, 'DOWN', 1.25],
		[-1.21, 0.05, 'DOWN', -1.25],
		// an exact multiple stays where it is, float noise or not
		[1.15, 0.05, 'UP', 1.15],
		[1.15, 0.05, 'DOWN', 1.15],
		[0.3, 0.1, 'UP', 0.3],
		// TRUNCATE drops toward zero
		[1.29, 0.05, 'TRUNCATE', 1.25],
		[-1.29, 0.05, 'TRUNCATE', -1.25],
		[-0.004, 0.01, 'TRUNCATE', 0],
		// whole-unit and coarse steps
		[1234.5, 1, 'HALF_UP', 1235],
		[1234, 10, 'UP', 1240],
		[1235, 10, 'HALF_EVEN', 1240],
		[1225, 10, 'HALF_EVEN', 1220],
		[1234, 100, 'HALF_UP', 1200],
		[1250, 100, 'HALF_UP', 1300],
		[-1250, 100, 'DOWN', -1300]
	];
	for (const [value, step, mode, expected] of cases) {
		assert.equal(roundStep(value, step, mode as never), expected, `${value} ${step} ${mode}`);
		assert.equal(run(`round(v, s, '${mode}')`, { v: value, s: step }), expected);
	}
	assert.equal(Object.is(roundStep(-0.001, 0.01, 'HALF_UP'), -0), false);
	assert.throws(() => roundStep(1, 0, 'UP'), /positive step/);
});

test('round() refuses a mode that is not a literal, or not a mode', () => {
	assert.equal(
		compileExpression({
			site: 'work_day',
			type: 'money',
			expression: "round(worked_hours, 0.05, 'UP')"
		}),
		null
	);
	assert.match(
		compileExpression({
			site: 'work_day',
			type: 'money',
			expression: 'round(worked_hours, 0.05, day_type)'
		}) ?? '',
		/literal/
	);
	assert.match(
		compileExpression({
			site: 'work_day',
			type: 'money',
			expression: "round(worked_hours, 0.05, 'NEAREST')"
		}) ?? '',
		/literal/
	);
});

test('min, max and the list totals', () => {
	assert.equal(run('min(3, 1.5)'), 1.5);
	assert.equal(run('min(3, 1.5, 2, 0.5)'), 0.5);
	assert.equal(run('max(1, 2)'), 2);
	assert.equal(run('max(-1, -2, -3)'), -1);
	assert.equal(run('max(a, 0.0)', { a: -4 }), 0);
	assert.equal(run('sum([1, 2.5, 3])'), 6.5);
	assert.equal(run('sum([])'), 0);
	assert.equal(run('avg([2, 4, 9])'), 5);
	assert.equal(run('avg([])'), 0);
	assert.equal(run('count([7, 8, 9])'), 3);
	assert.equal(run('max_of([1, 9, 3])'), 9);
	assert.equal(run('min_of([4, 9, 3])'), 3);
	assert.equal(run('max_of([])'), 0);
	// the best six of eight monthly credits: 900+800+700+600+500+400
	assert.equal(run('sum(xs.top(6))', { xs: [100, 900, 200, 800, 700, 600, 500, 400] }), 3900);
	assert.equal(run('sum(xs.top(6)) / 6.0', { xs: [100, 900, 200, 800, 700, 600, 500, 400] }), 650);
	assert.equal(run('count(xs.top(10))', { xs: [1, 2] }), 2);
	assert.equal(
		compileExpression({ site: 'scheme', type: 'money', expression: 'max(base, 10.0, 20.0)' }),
		null
	);
});

/**
 * A calendar for the goldens: weekends are rest days, 1 March 2024 is a holiday, and every
 * ordinary day produced two units.
 */
const calendar = runtimeExpressionEngine({
	calendar: (date) => {
		if (date === '2024-03-01') return { kind: 'PUBLIC_HOLIDAY' };
		const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
		return weekday === 0 || weekday === 6
			? { kind: 'REST_DAY' }
			: { kind: 'ORDINARY', facts: { output: 2 } };
	}
});
const onCalendar = (expression: string) => evaluateNumber(calendar, expression, {});

test('span: a leap day, a month edge, a rest day and a holiday', () => {
	// Wed 28 Feb 2024 → Mon 4 Mar 2024: 28, 29 (leap day), 1 Mar (holiday), 2–3 (weekend), 4.
	const week = "span('2024-02-28', '2024-03-04')";
	assert.equal(onCalendar(`${week}.calendar_days()`), 6);
	assert.equal(onCalendar(`${week}.working_days()`), 3);
	assert.equal(onCalendar(`${week}.rest_days()`), 2);
	assert.equal(onCalendar(`${week}.holidays()`), 1);
	assert.equal(onCalendar(`${week}.days().filter(d, d.weekday == 'SAT').size()`), 1);
	assert.equal(
		onCalendar(`sum(${week}.days().filter(d, d.kind == 'ORDINARY').map(d, d.facts.output))`),
		6
	);
	// no calendar bound: the calendar count stays exact, the kind counts are 0
	assert.equal(run(`${week}.calendar_days()`), 6);
	assert.equal(run(`${week}.working_days()`), 0);
	assert.equal(run("span('2023-02-28', '2023-03-01').calendar_days()"), 2);
	assert.equal(run("span('2024-01-15', '2024-02-14').months()"), 1);
	assert.equal(run("span('2024-01-01', '2024-12-31').months()"), 12);
	assert.equal(run("span('2024-03-05', '2024-03-01').calendar_days()"), 0);
	assert.equal(run("span('', '2024-03-01').calendar_days()"), 0);
});

test('span intersect, contains and add_days', () => {
	assert.deepEqual(
		programFor("span('2024-01-01', '2024-01-31').intersect(span('2024-01-20', '2024-02-10'))")({}),
		{ from: '2024-01-20', to: '2024-01-31' }
	);
	assert.equal(
		run(
			"span('2024-01-01', '2024-01-10').intersect(span('2024-02-01', '2024-02-10')).calendar_days()"
		),
		0
	);
	assert.equal(
		evaluateBoolean(plain, "span('2024-01-01', '2024-01-31').contains('2024-01-31')", {}),
		true
	);
	assert.equal(
		evaluateBoolean(plain, "span('2024-01-01', '2024-01-31').contains('2024-02-01')", {}),
		false
	);
	assert.equal(programFor("add_days('2024-02-28', 1)")({}), '2024-02-29');
	assert.equal(programFor("add_days('2023-02-28', 1)")({}), '2023-03-01');
	assert.equal(programFor("add_days('2024-03-01', -1)")({}), '2024-02-29');
	assert.equal(programFor("add_days('', 3)")({}), '');
});

test('the rate, obligation, filing and case sites compile what their fields state', () => {
	const cases = [
		['rate', 'money', '(terms.basic_salary + contract.classes.FIXED) / 26.0'],
		['rate', 'money', "round(terms.monthly_wage * 12.0 / 52.0 / 40.0, 0.01, 'HALF_UP')"],
		['obligation', 'date', 'add_days(trigger.date, 15)'],
		['obligation', 'date', 'add_days(add_months(period.start, 1), 14)'],
		['obligation', 'date', 'month_end(add_months(period.start, 1))'],
		['obligation', 'money', 'run.remittances.X + run.remittances.Y'],
		['obligation', 'money', 'obligation.amount_due * 0.001 * obligation.days_late'],
		['obligation', 'boolean', "trigger.on == 'EXIT' && employment.exit_facts.k != 0"],
		['filing', 'text', 'person.employee.birth_date'],
		['filing', 'money', 'sum(slips.map(s, s.gross))'],
		['filing', 'money', 'totals.employee.X + totals.lines.Y'],
		['filing', 'text', 'filing.code'],
		['case', 'money', 'sum(credits.map(c, c.amount).top(6)) / 6.0'],
		['case', 'boolean', 'previous.filter(p, p.kind == case.kind).size() < 2'],
		['case', 'days', 'phase.days - case.facts.days_taken'],
		['person', 'days', 'span(employment.service_start, employment.rule_date).calendar_days()']
	] as const;
	for (const [site, type, expression] of cases)
		assert.equal(compileExpression({ site, type, expression }), null, `${site}: ${expression}`);
	assert.match(
		compileExpression({ site: 'obligation', type: 'date', expression: 'trigger.date + 1' }) ?? '',
		/does not compile|must produce/
	);
	assert.match(
		compileExpression({ site: 'case', type: 'money', expression: 'case.salary' }) ?? '',
		/does not carry/
	);
	assert.match(
		compileExpression({ site: 'obligation', type: 'date', expression: 'run.gross' }) ?? '',
		/must produce a `YYYY-MM-DD` date/
	);
	assert.equal(programFor("month_end('2024-02-10')")({}), '2024-02-29');
	assert.equal(programFor("month_end(add_months('2025-01-31', 1))")({}), '2025-02-28');
	assert.equal(
		evaluateDate(plain, 'add_days(add_months(period.start, 1), 14)', {
			period: { start: '2025-01-01' }
		}),
		'2025-02-15'
	);
	assert.throws(() => evaluateDate(plain, "add_days('', 1)", {}), /not a YYYY-MM-DD day/);
	for (const site of ['rate', 'obligation', 'filing', 'case'] as const)
		assert.equal(EXPRESSION_CONTEXTS[site].site, site);
});

test('a macro variable is an item of its list, not an undeclared name', () => {
	assert.equal(
		compileExpression({
			site: 'filing',
			type: 'money',
			expression: 'sum(slips.map(s, s.employee.X))'
		}),
		null
	);
	assert.match(
		compileExpression({ site: 'filing', type: 'money', expression: 's.gross' }) ?? '',
		/does not carry|does not declare/
	);
});
