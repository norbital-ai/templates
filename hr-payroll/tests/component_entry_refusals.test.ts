// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	COMPONENT_ENTRY_EVENT_MISMATCH,
	componentEntryEventIssues,
	componentEntryEventMismatchMessage
} from '../src/lib/component_entry_refusals.js';

/**
 * The arm rule the columns cannot state, held as a named refusal and asserted as a boundary set.
 * The same pure function decides for the write hook, an import pipeline and the form, so these
 * cases are the whole rule and not one caller's reading of it. An event that fails the union's own
 * schema decode is one issue — the shape itself is the first fact — so the per-column clauses are
 * asserted over candidates the schema accepts.
 */

const RANGE = { start: '2020-01-01T00:00:00.000Z', end: null };

test('a claim states its incurred day and nothing an allowance would carry', () => {
	assert.deepEqual(
		componentEntryEventIssues({
			event: { kind: 'CLAIM', incurred_on: '2026-04-02', description: null },
			amount: 48
		}),
		[]
	);
	const issues = componentEntryEventIssues({
		event: { kind: 'CLAIM', incurred_on: '2026-04-02', description: null },
		amount: 48,
		effective_range: RANGE
	});
	assert.ok(issues.some((issue) => issue.match(/Only a standing allowance/) !== null));
});

test('a claim whose incurred day is not a calendar day is refused as an unknown event', () => {
	// The union's schema enforces the incurred day, so a payload without one does not decode into
	// any arm — the single issue is the decode refusal, not the per-column clause.
	const issues = componentEntryEventIssues({
		event: { kind: 'CLAIM', incurred_on: '', description: null },
		amount: 48
	});
	assert.ok(issues.some((issue) => issue.match(/is not one of CLAIM/) !== null));
});

test('a standing allowance requires its range, and the range is refused elsewhere', () => {
	assert.deepEqual(
		componentEntryEventIssues({
			event: { kind: 'ALLOWANCE' },
			amount: 310,
			effective_range: RANGE
		}),
		[]
	);
	assert.ok(
		componentEntryEventIssues({ event: { kind: 'ALLOWANCE' }, amount: 310 }).some(
			(issue) => issue.match(/must state the range/) !== null
		)
	);
	assert.ok(
		componentEntryEventIssues({
			event: { kind: 'BONUS', note: null },
			amount: 310,
			effective_range: RANGE
		}).some((issue) => issue.match(/Only a standing allowance/) !== null)
	);
});

test('arrears name YYYY-MM periods, and a correction names its output', () => {
	assert.deepEqual(
		componentEntryEventIssues({
			event: { kind: 'ARREARS', covers_periods: ['2026-01', '2026-02'], reason: 'late start' },
			amount: 500
		}),
		[]
	);
	assert.ok(
		componentEntryEventIssues({
			event: { kind: 'ARREARS', covers_periods: ['2026-1'], reason: 'late start' },
			amount: 500
		}).some((issue) => issue.match(/YYYY-MM/) !== null)
	);
	assert.ok(
		componentEntryEventIssues({
			event: { kind: 'MANUAL_ADJUSTMENT', operation: 'CORRECTION', reason: 'wrong rate' },
			amount: 75
		}).some((issue) => issue.match(/must name the settled adjustment/) !== null)
	);
});

test('the amount is a positive magnitude; direction is the component policy', () => {
	assert.ok(
		componentEntryEventIssues({ event: { kind: 'BONUS', note: null }, amount: 0 }).some(
			(issue) => issue.match(/positive magnitude/) !== null
		)
	);
	assert.ok(
		componentEntryEventIssues({ event: { kind: 'BONUS', note: null }, amount: -5 }).some(
			(issue) => issue.match(/positive magnitude/) !== null
		)
	);
});

test('the refusal sentence leads with the named refusal and carries every issue', () => {
	const candidate = {
		event: { kind: 'CLAIM', incurred_on: '2026-04-02', description: null },
		amount: -1,
		effective_range: RANGE
	};
	const message = componentEntryEventMismatchMessage(candidate);
	assert.match(message, new RegExp(COMPONENT_ENTRY_EVENT_MISMATCH));
	assert.ok(componentEntryEventIssues(candidate).length >= 2, 'every issue, not the first');
});
