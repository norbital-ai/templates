// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { employmentScheduleOn } from './employment-schedule.ts';

const DAY = '00000000-0000-4000-8000-000000000001';

function patterned(start: string, end: string | null, days = 7) {
	return {
		effective_range: { start, end },
		work_pattern: {
			type: 'PATTERNED',
			anchor_date: '2026-01-01',
			phases: [
				{
					duration: { kind: 'CONTINUOUS' },
					day_cycle: Array.from({ length: days }, () => ({ roster_code_id: DAY }))
				}
			]
		}
	};
}

test('employment profile selects the one term effective today, not an expired term', () => {
	const schedule = employmentScheduleOn(
		[
			patterned('2025-01-01T00:00:00.000Z', '2025-12-31T23:59:59.999Z', 5),
			patterned('2026-01-01T00:00:00.000Z', null, 7)
		],
		'2026-08-13'
	);
	assert.equal(schedule.state, 'current');
	assert.equal(schedule.summary, 'Patterned · 7-day cycle · starts 2026-01-01');
});

test('employment profile identifies a scheduled successor without calling it current', () => {
	const schedule = employmentScheduleOn(
		[patterned('2026-10-01T00:00:00.000Z', null, 5)],
		'2026-08-13'
	);
	assert.equal(schedule.state, 'next');
	assert.equal(schedule.summary, 'Patterned · 5-day cycle · starts 2026-01-01');
});

test('employment profile does not fabricate a schedule for a missing or malformed term', () => {
	assert.deepEqual(
		employmentScheduleOn(
			[
				{ effective_range: { start: '2026-01-01T00:00:00.000Z', end: null }, work_pattern: null },
				{ effective_range: null, work_pattern: { type: 'ROSTERED' } }
			],
			'2026-08-13'
		),
		{ state: 'missing' }
	);
});

test('employee profile presents terms inline instead of mounting a separate terms table', async () => {
	const representation = await readFile(
		new URL('../../collections/employees/+representation.svelte', import.meta.url),
		'utf8'
	);

	assert.match(representation, /employmentScheduleOn\(\s*termsByEmployment\.get\(/);
	assert.match(representation, /contentPadding=\{false\}/);
	assert.doesNotMatch(representation, /collection="employment_terms"/);
	assert.doesNotMatch(representation, /\{@render terms\(\)\}/);
});
