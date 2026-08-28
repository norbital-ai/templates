// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { personDayMutations } from './person-day-mutations.ts';

const keyOf = (employmentId: string, workDate: string) => `${employmentId}\t${workDate}`;

test('returns one mixed mutation list and keeps full person-day identity on updates', () => {
	const existing = new Map([[keyOf('employment-1', '2026-05-04'), { id: 'existing-day' }]]);

	assert.deepEqual(
		personDayMutations(
			existing,
			[
				{
					employment_id: 'employment-1',
					work_date: '2026-05-04',
					values: { worked_intervals: [{ start: '2026-05-04T01:00:00Z', end: null }] }
				},
				{
					employment_id: 'employment-2',
					work_date: '2026-05-05',
					values: { shift_definition_id: 'day-shift', planned_origin: 'IMPORT' }
				}
			],
			keyOf
		),
		[
			{
				id: 'existing-day',
				employment_id: 'employment-1',
				work_date: '2026-05-04',
				worked_intervals: [{ start: '2026-05-04T01:00:00Z', end: null }]
			},
			{
				employment_id: 'employment-2',
				work_date: '2026-05-05',
				shift_definition_id: 'day-shift',
				planned_origin: 'IMPORT'
			}
		]
	);
});
