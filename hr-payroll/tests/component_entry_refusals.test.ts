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
	// `effective_range` is not a column any more — an allowance's window is payload of its own arm
	// — so the clause that refused one on a claim has nothing left to refuse and is deleted. What
	// still holds is the other direction: a claim may carry evidence, and nothing else may.
	const issues = componentEntryEventIssues({
		event: { kind: 'BONUS', note: null },
		amount: 48,
		evidence_file: {
			storage_key: 'k',
			file_name: 'r.pdf',
			mime_type: 'application/pdf',
			file_size: 1
		}
	});
	assert.ok(issues.some((issue) => issue.match(/Only a claim carries an evidence file/) !== null));
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

/**
 * An allowance carries its own window, and the two refusals that used to police it are gone.
 *
 * The window was a nullable `effective_range` **column** that only this arm was permitted to set,
 * so two illegal states were representable and each cost a sentence to forbid: a range on a bonus,
 * and an allowance with no range. The window lives in the arm now, as a closed union, and neither
 * state can be written down — so this test asserts the type does the work the refusals used to,
 * which is a stronger guarantee than the sentences it replaces.
 */
test('an allowance states its own recurrence, and no other arm can carry one', () => {
	const recurring = {
		event: {
			kind: 'ALLOWANCE',
			recurrence: { kind: 'RECURRING', from: '2026-01-01', to: '2026-03-31' }
		},
		amount: 310
	};
	assert.deepEqual(componentEntryEventIssues(recurring), []);
	assert.deepEqual(
		componentEntryEventIssues({
			event: { kind: 'ALLOWANCE', recurrence: { kind: 'ONE_OFF', period: '2026-02' } },
			amount: 310
		}),
		[]
	);

	// An allowance with no recurrence does not decode at all — it is not a missing field on a valid
	// arm, it is not that arm. The message is the union's, and it is the only one left.
	assert.ok(
		componentEntryEventIssues({ event: { kind: 'ALLOWANCE' }, amount: 310 }).some(
			(issue) => issue.match(/is not one of CLAIM/) !== null
		)
	);
	// A `recurrence` on another arm raises nothing *here*, because this helper decodes against the
	// permissive value schema and the union strips what no arm declares. It is still refused, one
	// layer out: the datatype's standard view is `onExcessProperty: 'error'`, and
	// `custom-type-rejections.test.ts` asserts that a bonus carrying a recurrence does not decode.
	// Two views of one union, and the write path crosses the strict one — worth knowing before
	// reading this empty array as permission.
	assert.deepEqual(
		componentEntryEventIssues({
			event: { kind: 'BONUS', note: null, recurrence: { kind: 'ONE_OFF', period: '2026-02' } },
			amount: 310
		}),
		[]
	);
});

test('arrears name YYYY-MM periods, and a correction names its output', () => {
	assert.deepEqual(
		componentEntryEventIssues({
			event: {
				kind: 'ARREARS',
				covers_periods: ['2026-01', '2026-02'],
				reason: 'late start'
			},
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
	// Two issues that can still co-occur: a non-positive amount, and a correction reference on an
	// arm that is not a correction. `effective_range` used to be the second one and is gone.
	const candidate = {
		event: { kind: 'CLAIM', incurred_on: '2026-04-02', description: null },
		amount: -1,
		corrects_adjustment_id: '00000000-0000-4000-8000-000000000001'
	};
	const message = componentEntryEventMismatchMessage(candidate);
	assert.match(message, new RegExp(COMPONENT_ENTRY_EVENT_MISMATCH));
	assert.ok(componentEntryEventIssues(candidate).length >= 2, 'every issue, not the first');
});
