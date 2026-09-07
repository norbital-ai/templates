// @ts-nocheck
/**
 * The weekly rest day, judged against a roster at write time.
 *
 * The requirement was "a roster breaking statutory law — seven days a week — must be refused".
 * Nothing refused it: the month rule counts WORK days against the pattern's total and is blind to
 * how they are ordered, so thirteen consecutive days and thirteen spread across a month with two
 * rest days in them were the same write.
 *
 * `assertRunHasRestDay` is the pure decision. Everything below drives it directly, because the
 * arithmetic — where a run starts, what ends it, and whether this write is responsible for it — is
 * the whole rule; the hook around it only supplies rows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRunHasRestDay } from '../src/collections/work_days/+hooks.ts';
import { addDays } from '../src/lib/period.ts';

const WORK = 'code-work';
const REST = 'code-rest';
const OFF = 'code-off';

const codeKindById = new Map([
	[WORK, 'WORK'],
	[REST, 'REST'],
	[OFF, 'OFF']
]);

const rule = (over = {}) => ({
	max_consecutive_work_days: 6,
	discharged_by: 'REST_OR_OFF',
	on_exceed: 'BLOCK',
	authority: 'Fixture s.1',
	...over
});

/**
 * A roster written as one string, one character per day from `start`: `W` work, `R` rest, `O` off,
 * `.` no code at all. Upper case marks a day this write touched — which is what decides whether a
 * run that is already unlawful is this write's problem.
 */
function judge(shape: string, start: string, options = {}) {
	const plannedByDate = new Map();
	const changedDates = new Set();
	for (const [index, cell] of [...shape].entries()) {
		const date = addDays(start, index);
		const code = cell === '.' ? null : cell === 'W' ? WORK : cell === 'R' ? REST : OFF;
		if (code != null) plannedByDate.set(date, code);
		changedDates.add(date);
	}
	return () =>
		assertRunHasRestDay({
			employeeNumber: 'PUB-EMP-0001',
			rule: rule(options.rule),
			window: { start, end: addDays(start, shape.length - 1) },
			plannedByDate,
			changedDates: options.changedDates?.(start) ?? changedDates,
			// No terms and no patterns: a rostered-as-assigned employment, which is exactly where
			// explicit rows stack up and where the month rule returns early without looking.
			terms: [],
			patternById: new Map(),
			codeKindById
		});
}

test('a run longer than the jurisdiction allows is refused, and names what to do about it', () => {
	assert.throws(judge('WWWWWWW', '2026-03-02'), (error) => {
		const message = String(error?.message ?? error);
		assert.match(message, /PUB-EMP-0001/);
		assert.match(message, /2026-03-02 to 2026-03-08/);
		assert.match(message, /7 consecutive worked day\(s\)/);
		assert.match(message, /allows 6 \(Fixture s\.1\)/);
		assert.match(message, /REST or OFF/);
		return true;
	});
});

test('the same run under a jurisdiction that allows twelve passes', () => {
	judge('WWWWWWW', '2026-03-02', { rule: { max_consecutive_work_days: 12 } })();
});

test('a rest day inside the run breaks it, however long the roster is', () => {
	judge('WWWWWWRWWWWWW', '2026-03-02')();
	// …and without it, the same thirteen days are one run.
	assert.throws(judge('WWWWWWWWWWWWW', '2026-03-02'), /13 consecutive worked/);
});

test('an OFF day discharges the duty only where the jurisdiction says it substitutes', () => {
	judge('WWWWWWOWWWWWW', '2026-03-02')();
	assert.throws(
		judge('WWWWWWOWWWWWW', '2026-03-02', { rule: { discharged_by: 'REST' } }),
		/12 consecutive worked/
	);
});

/**
 * A day with no code at all is neither work nor rest: it carries the run rather than resetting it.
 * Resetting on it would let a roster launder an unlawful run through a single cleared cell.
 */
test('a day with no roster code neither counts as work nor releases the run', () => {
	assert.throws(judge('WWW.WWWW', '2026-03-02'), /7 consecutive worked/);
});

test('a run this write does not touch is left alone', () => {
	// Thirteen days of work already rostered; the write touches only the last, which is REST.
	const start = '2026-03-02';
	assert.throws(judge('WWWWWWWWWWWWW', start), /13 consecutive/);
	judge('WWWWWWWWWWWWW', start, { changedDates: () => new Set(['2026-04-01']) })();
});

/**
 * The run that straddles the first of the month is the seam the month-keyed rule cannot see, and
 * the reason the hook's read is padded rather than bounded by the touched months.
 */
test('a run across a month boundary is one run', () => {
	assert.throws(judge('WWWWWWWWW', '2026-02-26'), (error) => {
		assert.match(String(error?.message ?? error), /2026-02-26 to 2026-03-06/);
		return true;
	});
});

test('WARN refuses nothing at write time', () => {
	judge('WWWWWWWWWWWWW', '2026-03-02', { rule: { on_exceed: 'WARN' } })();
});

test('exactly the limit is lawful; one more is not', () => {
	judge('WWWWWW', '2026-03-02')();
	assert.throws(judge('WWWWWWW', '2026-03-02'), /7 consecutive/);
});
