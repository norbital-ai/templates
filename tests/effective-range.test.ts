// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Every effective-dated collection is read **inclusively** (`coversDate`, the date periods' `noOverlap`): both bounds
 * belong to the range. (A bank settings row's half-open end is read by `governed`.)
 *
 * Day membership is resolved through the payroll zone (`dateKey`), never by slicing the instant: a
 * day picked in a viewer east of UTC is stored at the viewer's local day boundary, so a slice
 * names the day before.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { coversDate, readRange } from '../src/lib/payroll/run/effective.ts';

test('an inclusive range resolves each bound in the payroll zone, not by slicing the instant', () => {
	// 1 Sep 2026, 00:00 in Kuala Lumpur is 2026-08-31T16:00:00.000Z.
	assert.equal(coversDate({ start: '2026-08-31T16:00:00.000Z', end: null }, '2026-08-31'), false);
	assert.equal(coversDate({ start: '2026-08-31T16:00:00.000Z', end: null }, '2026-09-01'), true);
	// An inclusive end day belongs to the range; the day after does not.
	const closed = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T15:59:59.999Z' };
	assert.equal(coversDate(closed, '2026-09-30'), true);
	assert.equal(coversDate(closed, '2026-10-01'), false);
	assert.equal(coversDate(null, '2026-09-01'), false);
});

test('statutory facts block overlaps per person, scheme and employment, a null employment being the personal row', async () => {
	const model = (await import('../src/data/model/employment_statutory_facts/+model.ts')).default;
	assert.deepEqual(model.noOverlap, [
		{
			key: ['employee_id', 'statutory_contribution_id', 'employment_id'],
			period: 'effective_range',
			name: 'employment_statutory_facts_no_overlap'
		}
	]);
	assert.equal(model.fields.effective_range.of, 'date');
});

test('a year-9999 end is read as an open contract', () => {
	assert.equal(
		readRange({ start: '2019-12-02T00:00:00.000Z', end: '9999-12-31T23:59:59.999Z' })?.end,
		null
	);
	assert.equal(
		readRange({ start: '2019-12-02', end: '2026-02-10T15:59:59.999Z' })?.end,
		'2026-02-10T15:59:59.999Z'
	);
});
