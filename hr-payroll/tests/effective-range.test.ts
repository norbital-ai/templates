// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Day ranges have two readings in this workspace, and each is pinned here:
 *
 * - `jurisdiction_settings` is read **half-open** (`coversDay`, the sealed-version exclusion), so
 *   the stored end is the first day the successor governs.
 * - Every other effective-dated collection is read **inclusively** (`coversDate`, the models'
 *   `[]` exclusions), and both bounds belong to the range.
 *
 * Day membership is resolved through the payroll zone (`dateKey`), never by slicing the instant: a
 * day picked in a viewer east of UTC is stored at the viewer's local day boundary, so a slice
 * names the day before.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inForceOnDay } from '../src/lib/effective_range.ts';

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

test('an inclusive range resolves each bound in the payroll zone, not by slicing the instant', () => {
	// 1 Sep 2026, 00:00 in Kuala Lumpur is 2026-08-31T16:00:00.000Z.
	assert.equal(inForceOnDay({ start: '2026-08-31T16:00:00.000Z', end: null }, '2026-08-31'), false);
	assert.equal(inForceOnDay({ start: '2026-08-31T16:00:00.000Z', end: null }, '2026-09-01'), true);
	// An inclusive end day belongs to the range; the day after does not.
	const closed = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T15:59:59.999Z' };
	assert.equal(inForceOnDay(closed, '2026-09-30'), true);
	assert.equal(inForceOnDay(closed, '2026-10-01'), false);
	assert.equal(inForceOnDay(null, '2026-09-01'), false);
});

test('statutory facts block overlaps inclusively and close the predecessor the day before', () => {
	const model = source('../src/collections/employment_statutory_facts/+model.ts');
	assert.match(
		model,
		/daterange\(lower\(bolt_daterange\(effective_range - 'end'\)\), upper\(bolt_daterange\(effective_range - 'start'\)\), '\[\]'\)/,
		'a half-open constraint would let a successor begin on its predecessor’s last day'
	);
	const hooks = source('../src/collections/employment_statutory_facts/+hooks.ts');
	assert.match(
		hooks,
		/Date\.parse\(successorRange\.start\) - 86_400_000/,
		'the predecessor closes on the day before the successor begins'
	);
});
