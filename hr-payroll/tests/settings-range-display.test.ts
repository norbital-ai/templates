// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The seam an operator sees: a settings range prints the last day it governs. A 0.0.1 period's `to` is that day; a
 * bank row's half-open end is the successor's start, which printed raw made two adjacent snapshots read as overlapping.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSettingsRange } from '../src/lib/ui/display-formatters.ts';

test('a settings range prints the last day it governs, and the open tail as open', () => {
	assert.equal(
		formatSettingsRange({ start: '2026-01-01T00:00:00.000Z', end: '2026-04-01T00:00:00.000Z' }),
		'01 Jan 2026 – 31 Mar 2026'
	);
	assert.equal(
		formatSettingsRange({ start: '2026-04-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' }),
		'01 Apr 2026 – 31 Dec 2026'
	);
	assert.equal(
		formatSettingsRange({ start: '2026-03-01T00:00:00.000Z', end: '9999-12-31T00:00:00.000Z' }),
		'01 Mar 2026 – open'
	);
	assert.equal(
		formatSettingsRange({ from: '2026-01-01', to: '2026-03-31' }),
		'01 Jan 2026 – 31 Mar 2026'
	);
	assert.equal(formatSettingsRange(null), '—');
});
