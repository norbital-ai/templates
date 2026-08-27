// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The arm rule, held by a test because the database cannot hold it.
 *
 * `obligations` used to express its four arms as a discriminated union nested inside another one,
 * inside a single jsonb column, and a union in jsonb enforces its own shape for free. Real columns
 * do not — but real columns are enforceable by constraints, readable by a row predicate and
 * maskable by a field grant, and two of the facts in that blob were a live foreign key and a file.
 * The trade was made deliberately (see `collections/obligations/+model.ts`), and this is the half
 * that has to be paid for it.
 *
 * Every arm is checked in both directions: what it MUST carry, and what it MUST NOT. The second
 * direction is the one a nullable-column model loses silently, so it is the one written first.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	OBLIGATION_TERMS_MISMATCH,
	obligationTermsIssues,
	obligationTermsMismatchMessage
} from './obligation_refusals.ts';

const UUID = '7f9c8b2e-4c1a-4d3b-9f6e-2a1b3c4d5e6f';
const RANGE = { start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T23:59:59.999Z' };
const FILE = {
	storage_key: `${UUID}.pdf`,
	file_name: 'receipt.pdf',
	file_size: 12,
	mime_type: 'application/pdf'
};

const ok = (candidate) => assert.deepEqual(obligationTermsIssues(candidate), []);
const rejects = (candidate, pattern) => {
	const issues = obligationTermsIssues(candidate);
	assert.notEqual(issues.length, 0, `expected a refusal for ${JSON.stringify(candidate)}`);
	assert.ok(
		issues.some((issue) => pattern.test(issue)),
		`no issue matched ${pattern}: ${issues.join(' ')}`
	);
};

test('each arm accepts exactly its own payload', () => {
	ok({ terms: 'ONE_OFF', occasion: 'ENTERED', note: 'signing bonus' });
	ok({ terms: 'ONE_OFF', occasion: 'CLAIM', incurred_on: '2026-04-02', evidence_file: FILE });
	// A claim with no receipt is ordinary; the evidence column is optional and the incurred day is not.
	ok({ terms: 'ONE_OFF', occasion: 'CLAIM', incurred_on: '2026-04-02' });
	ok({ terms: 'ONE_OFF', occasion: 'ARREARS', covers_periods: ['2026-01'], reason: 'late' });
	ok({ terms: 'ONE_OFF', occasion: 'ADJUSTMENT', note: 'duplicate claim recovered' });
	ok({ terms: 'RECURRING', effective_range: RANGE });
	ok({
		terms: 'SCHEDULED',
		effective_range: RANGE,
		instalments: [{ due_date: '2026-04-30', amount: 500 }]
	});
	ok({ terms: 'REVERSAL', reverses_obligation_id: UUID, reason: 'duplicate' });
});

test('a column an arm does not use may not be set on it', () => {
	// This is the whole cost of moving off a jsonb union, and the only place it is paid. A blob
	// refused these at decode; real columns will hold anything, so the rule is here.
	rejects(
		{ terms: 'RECURRING', effective_range: RANGE, occasion: 'CLAIM' },
		/cannot carry an occasion/
	);
	rejects(
		{
			terms: 'RECURRING',
			effective_range: RANGE,
			instalments: [{ due_date: '2026-04-30', amount: 1 }]
		},
		/cannot carry an instalment schedule/
	);
	rejects(
		{
			terms: 'SCHEDULED',
			effective_range: RANGE,
			instalments: [{ due_date: '2026-04-30', amount: 1 }],
			reverses_obligation_id: UUID
		},
		/cannot carry a reversed obligation/
	);
	rejects(
		{ terms: 'REVERSAL', reverses_obligation_id: UUID, reason: 'x', effective_range: RANGE },
		/cannot carry an effective range/
	);
	// And across occasions, not only across arms: a claim is not an arrears correction.
	rejects(
		{ terms: 'ONE_OFF', occasion: 'CLAIM', incurred_on: '2026-04-02', covers_periods: ['2026-01'] },
		/A CLAIM obligation cannot carry covered periods/
	);
	rejects(
		{
			terms: 'ONE_OFF',
			occasion: 'ARREARS',
			covers_periods: ['2026-01'],
			reason: 'late',
			evidence_file: FILE
		},
		/A ARREARS obligation cannot carry an evidence file/
	);
	// An empty array is absence, not presence: a row that was never given periods has not "carried" them.
	ok({ terms: 'ONE_OFF', occasion: 'ENTERED', note: 'x', covers_periods: [] });
});

test('each arm requires what it cannot mean without', () => {
	rejects({ terms: 'ONE_OFF' }, /must say what occasion/);
	rejects({ terms: 'ONE_OFF', occasion: 'CLAIM' }, /must say the day it was incurred/);
	rejects({ terms: 'ONE_OFF', occasion: 'ARREARS', reason: 'late' }, /at least one period/);
	rejects(
		{ terms: 'ONE_OFF', occasion: 'ARREARS', covers_periods: ['2026-01'] },
		/must state a reason/
	);
	rejects({ terms: 'ONE_OFF', occasion: 'ADJUSTMENT' }, /must state what it corrects/);
	rejects({ terms: 'ONE_OFF', occasion: 'ADJUSTMENT', note: '   ' }, /must state what it corrects/);
	rejects({ terms: 'RECURRING' }, /must state the range/);
	rejects({ terms: 'SCHEDULED', effective_range: RANGE }, /at least one instalment/);
	rejects(
		{ terms: 'SCHEDULED', instalments: [{ due_date: '2026-04-30', amount: 1 }] },
		/must state the range/
	);
	rejects({ terms: 'REVERSAL', reason: 'duplicate' }, /must name the obligation it reverses/);
	rejects({ terms: 'REVERSAL', reverses_obligation_id: UUID }, /must state a reason/);
});

test('arrears periods are months, and a schedule has a ceiling', () => {
	rejects(
		{ terms: 'ONE_OFF', occasion: 'ARREARS', covers_periods: ['2026-01-01'], reason: 'late' },
		/not months written YYYY-MM/
	);
	// The 1..600 bound came off the array schema when the schedule was inlined as a column. It is an
	// arm rule now, and this is the only thing holding it.
	const instalments = Array.from({ length: 601 }, () => ({ due_date: '2026-04-30', amount: 1 }));
	rejects({ terms: 'SCHEDULED', effective_range: RANGE, instalments }, /more than 600 instalments/);
});

test('an unknown arm or occasion is refused rather than tolerated', () => {
	rejects({ terms: 'LOAN_INSTALMENT' }, /not one of ONE_OFF, RECURRING, SCHEDULED or REVERSAL/);
	rejects(
		{ terms: 'ONE_OFF', occasion: 'MANUAL_ADJUSTMENT' },
		/not one of ENTERED, CLAIM, ARREARS or ADJUSTMENT/
	);
	// An unresolvable arm reports that and only that: everything else we could say about the row is
	// noise generated by our own inability to tell what it was meant to be.
	assert.equal(obligationTermsIssues({ terms: 'ONE_OFF', note: 'x', reason: 'y' }).length, 1);
});

test('the refusal names itself and carries every issue at once', () => {
	assert.equal(OBLIGATION_TERMS_MISMATCH, 'OBLIGATION_TERMS_MISMATCH');
	const message = obligationTermsMismatchMessage({ terms: 'REVERSAL' });
	assert.match(message, /^OBLIGATION_TERMS_MISMATCH: /);
	// Both, not the first. A person correcting an import row should not resubmit twice to be told
	// two things.
	assert.match(message, /must name the obligation it reverses/);
	assert.match(message, /must state a reason/);
});
