/** L-TPL-hr-payroll-058 late arrival notices over rostered WORK shifts. */
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { lateArrivalNotices, shiftStartMs } from '../src/lib/payroll_engine/late_arrival.ts';
import { fixtureId, nativeId } from './fixture_values.ts';

const start = shiftStartMs('2026-03-02', '09:00', 'UTC');

describe('late arrival', () => {
	it('L-TPL-hr-payroll-058 reminds once when a WORK shift has no clock-in after grace, and skips leave and recorded attendance', () => {
		assert.ok(start != null);
		const candidate = {
			roster_entry_id: nativeId('roster_entry', fixtureId('r1')),
			employment_id: 'e1',
			work_date: '2026-03-02',
			worked_intervals: null,
			shift: { day_type: 'WORK', start_time: '09:00' },
			grace_minutes: 15,
			time_zone: 'UTC',
			employee_name: 'Kavriel Tan',
			employee_number: 'E-01',
			shift_code: 'DAY'
		};
		const due = start + 15 * 60_000;
		assert.equal(
			lateArrivalNotices({
				now_ms: due + 1,
				lookback_ms: 6 * 3_600_000,
				candidates: [candidate],
				leave: []
			}).length,
			1
		);
		assert.equal(
			lateArrivalNotices({
				now_ms: due - 1,
				lookback_ms: 6 * 3_600_000,
				candidates: [candidate],
				leave: []
			}).length,
			0
		);
		assert.equal(
			lateArrivalNotices({
				now_ms: due + 1,
				lookback_ms: 6 * 3_600_000,
				candidates: [{ ...candidate, worked_intervals: [] }],
				leave: []
			}).length,
			0
		);
		assert.equal(
			lateArrivalNotices({
				now_ms: due + 1,
				lookback_ms: 6 * 3_600_000,
				candidates: [candidate],
				leave: [
					{
						catalog_id: nativeId('leave_catalog', fixtureId('al')),
						employment_id: 'e1',
						activity: 'TIME_OFF',
						occurred_on: '2026-03-02',
						days: 1,
						from: '2026-03-02',
						to: '2026-03-02'
					}
				]
			}).length,
			0
		);
	});
});
