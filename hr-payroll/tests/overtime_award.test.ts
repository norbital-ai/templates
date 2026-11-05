import { assert, describe, it } from '@effect/vitest';
import { awardedMinutes } from '../src/lib/payroll_engine/attendance.js';

const at = (clock: string) => Date.parse(`2026-03-02T${clock}:00+08:00`);
const span = (from: string, to: string) => ({ start: at(from), end: at(to) });
const plan = [span('17:30', '19:30')];

describe('overtime award', () => {
	it('pays nothing the clock does not verify', () => {
		assert.equal(awardedMinutes(plan, [], 80), 0);
		assert.equal(awardedMinutes([], [span('08:30', '21:00')], 80), 0);
	});

	it('pays the plan once the clock covers the threshold, never more', () => {
		assert.equal(awardedMinutes(plan, [span('08:30', '21:00')], 100), 120);
		assert.equal(awardedMinutes(plan, [span('08:30', '19:15')], 80), 120);
	});

	it('pays clocked time rounded down to the half hour below the threshold', () => {
		assert.equal(awardedMinutes(plan, [span('08:30', '18:29')], 80), 30);
		assert.equal(awardedMinutes(plan, [span('08:30', '18:59')], 100), 60);
		assert.equal(awardedMinutes(plan, [span('08:30', '19:29')], 100), 90);
	});

	it('counts only the planned hours the clock overlaps', () => {
		assert.equal(awardedMinutes(plan, [span('06:00', '17:30')], 80), 0);
	});
});
