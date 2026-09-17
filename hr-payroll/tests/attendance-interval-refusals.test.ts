// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * What a work day will and will not accept as a record of the clock.
 *
 * `assertWorkedIntervals` holds three rules, the ones that keep overtime honest: the engine
 * unions these intervals to decide payable time, so an overlapping pair pays a minute twice, and
 * an open interval that is not the last one makes "still on the clock" ambiguous.
 *
 * Each rule is also driven with the write it must NOT refuse, because a validator that refuses
 * everything reads exactly like one that works — and one of these has a genuine zero case the
 * day sheet depends on: a day reviewed and found empty is `[]`, and must land.
 *
 * There is no stored break to validate. The break is derived from the shift's granted minutes
 * less the gaps the punches already show (`derivedBreakMinutes`), which is asserted last.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import workDays from '../src/collections/work_days/+collection.ts';
import { derivedBreakMinutes } from '../src/lib/scheduling/rest-break.ts';
import { transformOne } from './helpers/transform.ts';
import { workDayDb } from './helpers/work-day-db.ts';

// A complete jurisdiction calendar is required even when this fixture has no holidays or weekly
// rest rule. The transform must reach interval validation with legitimate inputs.
const db = workDayDb();

const at = (time) => `2026-07-01T${time}:00.000Z`;

const write = (overrides) => {
	const input = {
		employment_id: 'emp-1',
		work_date: '2026-07-01',
		shift_definition_id: null,
		worked_intervals: [{ start: at('01:00'), end: at('09:00') }],
		...overrides
	};
	return transformOne(workDays, input, undefined, db);
};

test('overlapping intervals are refused, so no minute can be paid twice', () => {
	assert.throws(
		() =>
			write({
				worked_intervals: [
					{ start: at('01:00'), end: at('09:00') },
					{ start: at('08:00'), end: at('12:00') }
				]
			}),
		/Worked intervals must be in time order and cannot overlap/
	);
	// Touching is not overlapping: a split shift resuming exactly when the first half ended is legal.
	assert.doesNotThrow(() =>
		write({
			worked_intervals: [
				{ start: at('01:00'), end: at('09:00') },
				{ start: at('09:00'), end: at('12:00') }
			]
		})
	);
});

test('only the final interval may still be open', () => {
	assert.throws(
		() =>
			write({
				worked_intervals: [
					{ start: at('01:00'), end: null },
					{ start: at('09:00'), end: at('12:00') }
				]
			}),
		/Only the final worked interval may still be open/
	);
	assert.doesNotThrow(() =>
		write({
			worked_intervals: [
				{ start: at('01:00'), end: at('09:00') },
				{ start: at('10:00'), end: null }
			]
		})
	);
});

test('an interval must end after it starts', () => {
	assert.throws(
		() => write({ worked_intervals: [{ start: at('09:00'), end: at('09:00') }] }),
		/Each worked interval must end after it starts/
	);
	assert.throws(
		() => write({ worked_intervals: [{ start: at('09:00'), end: at('08:00') }] }),
		/Each worked interval must end after it starts/
	);
});

test('a day reviewed and found empty is a legal statement', () => {
	// `[]` is not `null`: one says the day was read and produced no work, the other that no
	// attendance was recorded at all. The day sheet's "reviewed, nothing worked" action writes the
	// first; both land, and the row carries nothing but the clock it was given.
	const reviewed = write({ worked_intervals: [] });
	assert.deepEqual(reviewed.worked_intervals, []);
	assert.equal(reviewed.employment_id, 'emp-1');
	assert.doesNotThrow(() => write({ worked_intervals: null }));
});

test('the break is derived: the shift grants it, and a gap between punches already took it', () => {
	const one = [{ start: at('01:00'), end: at('09:00') }];
	const split = [
		{ start: at('01:00'), end: at('04:00') },
		{ start: at('05:00'), end: at('09:00') }
	];
	assert.equal(derivedBreakMinutes(one, 60), 60, 'one interval takes the whole granted break off');
	assert.equal(
		derivedBreakMinutes(split, 60),
		0,
		'an hour’s gap on an hour’s grant takes nothing more'
	);
	assert.equal(derivedBreakMinutes(split, 90), 30, 'only the grant the gap did not cover remains');
	assert.equal(derivedBreakMinutes(one, 0), 0, 'a shift granting no break derives none');
	assert.equal(derivedBreakMinutes(null, 60), 0, 'no punch, no break');
	assert.equal(derivedBreakMinutes([], 60), 0, 'a day read and found empty has no break either');
	assert.equal(
		derivedBreakMinutes([{ start: at('01:00'), end: null }], 60),
		60,
		'an open interval is not a gap; the grant still applies'
	);
});
