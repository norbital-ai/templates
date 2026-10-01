import assert from 'node:assert/strict';
import test from 'node:test';
import { nightWindowHours } from '../src/lib/payroll/run/overtime.ts';

const entry = (start: string, end: string) => ({
	id: 'morning',
	work_date: '2026-06-15',
	break_minutes: 0,
	worked_intervals: [{ start: `2026-06-15T${start}:00+09:00`, end: `2026-06-15T${end}:00+09:00` }]
});
test('night premium includes the morning portion of the preceding overnight window', () => {
	assert.deepEqual(
		nightWindowHours(entry('03:00', '06:00'), { from: '22:00', to: '05:00' }, null, 540),
		{ ordinary: 2, overtime: 0 }
	);
});
test('night premium ends at05:00 on the recorded morning date', () => {
	assert.deepEqual(
		nightWindowHours(entry('04:59', '05:01'), { from: '22:00', to: '05:00' }, null, 540),
		{ ordinary: 1 / 60, overtime: 0 }
	);
});
