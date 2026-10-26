/**
 * The expression language every catalogue, scheme and rule record is written in: the template's own functions over
 * values stated here. A record is only as correct as these primitives.
 */
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { Result } from 'effect';
import { payrollRulesOf } from '../src/lib/payroll_engine/admit.ts';
import { evaluateConfigured, evaluateStrict } from '../src/lib/payroll_engine/expressions.ts';
import { Refusal } from '../src/lib/payroll_engine/foundation.ts';

const cel = (expression: string, context: Record<string, unknown> = {}) =>
	evaluateConfigured(expression, context);
const refusal = (error: unknown) => error instanceof Refusal;

it('validates configured payroll rule objects before CEL evaluation', () => {
	const rules = payrollRulesOf([{ code: 'example', rules: { value: 'synthetic' } }]);
	assert.ok(Result.isSuccess(rules));
	assert.deepEqual(rules.success, { example: { value: 'synthetic' } });
	for (const value of [null, [], 'not-an-object']) {
		const invalid = payrollRulesOf([{ code: 'example', rules: value }]);
		assert.ok(Result.isFailure(invalid));
		assert.ok(invalid.failure instanceof Refusal);
	}
});

describe('rate bands', () => {
	const bands = [
		{ up_to: 3000, rate: 0.05 },
		{ up_to: 6000, rate: 0.1 },
		{ up_to: null, rate: 0.2 }
	];
	const rate = (wage: number) => cel('bracket(wage, bands)', { wage, bands });

	it('a band covers up to its ceiling inclusive; a cent above is the next band', () => {
		assert.deepEqual(
			[0, 3000, 3000.01, 6000, 6000.01, 1e9].map(rate),
			[0.05, 0.05, 0.1, 0.1, 0.2, 0.2]
		);
	});

	it('pairs and amounts read the same way, and an empty table charges nothing', () => {
		assert.equal(cel('bracket(1000.0, [[1000.0, 1.0], [null, 2.0]])'), 1);
		assert.equal(cel('bracket(1000.01, [[1000.0, 1.0], [null, 2.0]])'), 2);
		assert.equal(cel('bracket(wage, bands)', { wage: 50, bands: [{ up_to: 100, amount: 7 }] }), 7);
		// above the last ceiling the last band governs
		assert.equal(cel('bracket(500.0, [[100.0, 1.0], [200.0, 2.0]])'), 2);
		assert.equal(cel('bracket(500.0, [])'), 0);
	});

	it('a progressive ladder charges each slice at its own band, never below zero', () => {
		const ladder = (amount: number) =>
			cel('ladder(amount, [[1000.0, 0.0], [5000.0, 0.1], [null, 0.2]])', { amount });
		assert.equal(ladder(1000), 0);
		assert.equal(ladder(3000), 200);
		// 1,000 at 0 %, 4,000 at 10 % and 1,000 at 20 %
		assert.equal(ladder(6000), 600);
		assert.equal(ladder(-50), 0);
		assert.equal(
			cel('ladder(amount, bands)', {
				amount: 6000,
				bands: [
					{ up_to: 1000, rate: 0 },
					{ up_to: 5000, rate: 0.1 },
					{ up_to: null, rate: 0.2 }
				]
			}),
			600
		);
	});
});

describe('rounding', () => {
	it('rounds to the step under each declared mode, half away from zero by default', () => {
		const cases: [string, number][] = [
			['round(2.345, 0.01, "HALF_UP")', 2.35],
			['round(2.345, 0.01)', 2.35],
			['round(-2.345, 0.01, "HALF_UP")', -2.35],
			['round(2.345, 0.01, "HALF_EVEN")', 2.34],
			['round(2.355, 0.01, "HALF_EVEN")', 2.36],
			['round(2.341, 0.01, "UP")', 2.35],
			['round(2.349, 0.01, "DOWN")', 2.34],
			['round(-2.349, 0.01, "TRUNCATE")', -2.34],
			['round(7.5)', 8],
			['round(1234.0, 100.0, "DOWN")', 1200],
			// whole × step carries binary noise; the result is the cent, not 3119.7000000000003
			['round(3119.7, 0.01)', 3119.7]
		];
		for (const [expression, expected] of cases) assert.equal(cel(expression), expected, expression);
	});

	it('refuses a step that is not positive and a mode it does not know', () => {
		assert.throws(() => cel('round(1.0, 0.0)'), refusal);
		assert.throws(() => cel('round(1.0, 0.01, "BANKERS")'), refusal);
	});
});

describe('calendar', () => {
	it('counts days, months and ages on calendar dates', () => {
		assert.equal(cel('add_days("2026-02-27", 2)'), '2026-03-01');
		assert.equal(cel('add_months("2026-01-15", 1)'), '2026-02-15');
		assert.equal(cel('add_years("2024-03-01", 2)'), '2026-03-01');
		assert.equal(cel('month_start("2026-03-17")'), '2026-03-01');
		assert.equal(cel('month_end("2024-02-10")'), '2024-02-29');
		assert.equal(cel('calendar_distance_days("2026-03-01", "2026-03-31")'), 30);
		assert.equal(cel('calendar_distance_days("2026-03-31", "2026-03-01")'), -30);
		// a month completes on the same day of the month
		assert.equal(cel('calendar_completed_months("2025-01-31", "2026-01-30")'), 11);
		assert.equal(cel('months_through("2025-11-15", "2026-02-01")'), 4);
		assert.equal(cel('age_on("2000-02-29", "2026-02-28")'), 25);
	});

	it('steps over weekend days and listed holidays, as dates or holiday rows', () => {
		const weekend = ['SATURDAY', 'SUNDAY'];
		// Saturday 7 March 2026; Monday the 9th is a holiday
		assert.equal(
			cel('next_working_day(day, holidays, weekend)', {
				day: '2026-03-07',
				holidays: ['2026-03-09'],
				weekend
			}),
			'2026-03-10'
		);
		assert.equal(
			cel('add_working_days("2026-03-06", 1, holidays, weekend)', { holidays: [], weekend }),
			'2026-03-09'
		);
		assert.equal(
			cel('add_working_days("2026-03-06", 1, holidays, weekend)', {
				holidays: [{ date: '2026-03-09', name: 'Founders Day' }],
				weekend
			}),
			'2026-03-10'
		);
		assert.equal(
			cel('add_working_days("2026-03-09", -1, holidays, weekend)', { holidays: [], weekend }),
			'2026-03-06'
		);
		assert.throws(() => cel('next_working_day("2026-03-07", [], ["FUNDAY"])'), refusal);
		assert.throws(() => cel('add_days("not a date", 1)'), refusal);
	});
});

describe('lists and clocks', () => {
	it('sums, picks and counts within a sorted window, both ends inclusive', () => {
		assert.equal(cel('sum([1.5, 2.5])'), 4);
		assert.equal(cel('min(2.0, 3.0) + max(2.0, 3.0)'), 5);
		assert.deepEqual(cel('top([3.0, 9.0, 5.0], 2)'), [9, 5]);
		assert.equal(cel('first([])'), null);
		const separations = ['2025-12-31', '2026-01-01', '2026-03-31', '2026-04-01'].map(
			(exit_date) => ({ exit_date })
		);
		assert.equal(
			cel('count_within(separations, "exit_date", "2026-01-01", "2026-03-31")', { separations }),
			2
		);
	});

	it('measures hours inside a daily window across midnight, and work between real breaks', () => {
		assert.equal(
			cel('hours_between(days, "22:00", "06:00")', {
				days: [{ start: '2026-03-02T21:00', end: '2026-03-03T07:00' }]
			}),
			8
		);
		// an open interval has no measured duration
		assert.equal(
			cel('hours_between(days, "00:00", "23:59")', {
				days: [{ start: '2026-03-02T09:00', end: null }]
			}),
			0
		);
		const spans = [
			{ start: '2026-03-02T08:00', end: '2026-03-02T12:00' },
			// a 15-minute gap is no break: the work runs on
			{ start: '2026-03-02T12:15', end: '2026-03-02T14:15' },
			// a 30-minute gap is
			{ start: '2026-03-02T14:45', end: '2026-03-02T16:45' }
		];
		assert.equal(cel('max_work_hours_between_breaks(spans, 30.0)', { spans }), 6);
	});
});

describe('configured evaluation', () => {
	it('evaluates only over the roots its context declares, and never a blank expression', () => {
		assert.equal(cel('wage * 2.0', { wage: 1500 }), 3000);
		assert.throws(() => cel('salary * 2.0', { wage: 1500 }), refusal);
		assert.throws(() => cel('   ', {}), refusal);
	});

	it('a record expression failing where && absorbs it still fails the strict evaluation, naming it', () => {
		const context = { rule: 'missing.flag == true' };
		assert.equal(cel('configured_eval(rule, {}) && false', context), false);
		assert.throws(
			() => evaluateStrict('configured_eval(rule, {}) && false', context),
			(error) => error instanceof Refusal && error.detail === 'missing.flag == true'
		);
		assert.equal(evaluateStrict('configured_eval(rule, {"flag": true})', { rule: 'flag' }), true);
	});
});
