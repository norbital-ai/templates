import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { intervalsFrom } from '../../src/lib/ui/roster/month_board.js';

describe('work-day interval editor', () => {
	it('leaves blank editor rows unrecorded and keeps a final open clock-in', () => {
		assert.deepEqual(intervalsFrom('2026-10-17', [{ start: null, end: null }], 'Asia/Singapore'), {
			intervals: []
		});
		assert.deepEqual(
			intervalsFrom(
				'2026-10-17',
				[
					{ start: '09:00', end: null },
					{ start: null, end: null }
				],
				'Asia/Singapore'
			),
			{ intervals: [{ start: '2026-10-17T01:00:00.000Z', end: null }] }
		);
	});

	it('preserves overnight intervals and refuses an end without a clock-in', () => {
		assert.deepEqual(
			intervalsFrom('2026-10-17', [{ start: '22:00', end: '06:00' }], 'Asia/Singapore'),
			{
				intervals: [{ start: '2026-10-17T14:00:00.000Z', end: '2026-10-17T22:00:00.000Z' }]
			}
		);
		assert.deepEqual(
			intervalsFrom('2026-10-17', [{ start: null, end: '18:00' }], 'Asia/Singapore'),
			{ problem: 'roster.day_sheet_problem_missing_start' }
		);
	});
});
