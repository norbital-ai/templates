// A monthly overtime cap counts every day, or only the day types its statute names: EA s.60A(4)(a) leaves rest-day
// work out of Malaysia's 104 hours.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { dayFindings, limits, type DayType } from '../src/lib/payroll_engine/roster_warnings.ts';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';

const HOUR = 3_600_000;
const day = (date: string, hours: number, type: DayType): JsonObject => {
	const start = Date.parse(`${date}T10:00:00.000Z`);
	return {
		work_date: date,
		type,
		planned_overtime_intervals: [
			{ start: new Date(start).toISOString(), end: new Date(start + hours * HOUR).toISOString() }
		]
	};
};
const typeOf = (entry: JsonObject): DayType => (entry.type === 'REST' ? 'REST' : 'WORK');
const days = [
	day('2026-03-02', 2, 'WORK'),
	day('2026-03-03', 2, 'WORK'),
	day('2026-03-08', 3, 'REST')
];
const monthly = (cap: JsonObject[string]) =>
	dayFindings(
		limits({ roster_warnings: { monthly_overtime_hours: cap } }),
		days,
		typeOf
	)(days[2]!).filter((finding) => finding.code === 'roster.monthly_overtime');

describe('monthly overtime cap', () => {
	it('a plain cap counts every day', () => {
		assert.equal(monthly(4).length, 1);
		assert.equal(monthly(7).length, 0);
	});
	it('a cap that names its day types counts only those days', () => {
		assert.equal(monthly({ hours: 4, day_types: ['WORK'] }).length, 0);
		assert.equal(monthly({ hours: 3, day_types: ['WORK'] }).length, 1);
		assert.equal(monthly({ hours: 4, day_types: ['WORK', 'REST'] }).length, 1);
	});
});
