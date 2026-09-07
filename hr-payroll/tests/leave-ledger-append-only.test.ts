/**
 * The leave ledger is append-only, and that is the whole of its audit guarantee.
 *
 * A balance is the sum of its movements, so a posted line that can be rewritten or deleted makes
 * every historical balance unreconstructable — including the one a paid payslip priced. Both
 * handlers enforce it and neither was ever imported by a test.
 *
 * The sign rules are here for the same reason: a grant that posts negative or a take that posts
 * positive moves the balance the wrong way, and the ledger has no other check on direction.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import leaveEntryHooks from '../src/collections/leave_entries/+hooks.ts';

const ENTITLEMENT_ID = '0199aaaa-0000-7000-8000-00000000e001';

const api = (entitlement?: Record<string, unknown>, duplicate?: Record<string, unknown>) => ({
	db: {
		leave_entitlements: { findFirst: () => Effect.succeed(entitlement) },
		leave_entries: { findFirst: () => Effect.succeed(duplicate) }
	}
});

const post = (input: Record<string, unknown>, world = api()) =>
	Effect.runSync(
		leaveEntryHooks.mutate.perRecord.before.handler({
			input,
			existing: undefined,
			api: world
		} as never) as never
	);

const rewrite = (input: Record<string, unknown>) =>
	Effect.runSync(
		leaveEntryHooks.mutate.perRecord.before.handler({
			input,
			existing: { id: 'entry-1' },
			api: api()
		} as never) as never
	);

test('a posted entry cannot be rewritten', () => {
	assert.throws(
		() => rewrite({ id: 'entry-1', days: -1 }),
		/Leave entries are append-only. Post a correcting entry/
	);
	assert.throws(() => rewrite({ id: 'entry-1', reason: 'a better story' }), /append-only/);
});

test('restating a stored line unchanged is not an edit', () => {
	// An employment write carries the complete set of its entitlements' entries, restating every
	// stored line by id. Treating that restatement as an edit would make the reconciler's own
	// declarative write illegal.
	assert.doesNotThrow(() => rewrite({ id: 'entry-1' }));
	assert.doesNotThrow(() => rewrite({ id: 'entry-1', row_version: 3 }));
});

test('a posted entry cannot be deleted, whatever it is', () => {
	assert.throws(
		() =>
			Effect.runSync(
				leaveEntryHooks.delete.perRecord.before.handler({
					existing: { id: 'entry-1' },
					api: api()
				} as never) as never
			),
		/Leave entries cannot be deleted. Post a correcting entry/
	);
});

test('an entry that moves nothing is refused', () => {
	assert.throws(
		() => post({ kind: 'ACCRUAL', days: 0, leave_entitlement_id: ENTITLEMENT_ID }),
		/A leave entry must move the balance/
	);
});

test('grants post positive and takes post negative, and the reverse is refused', () => {
	for (const kind of ['OPENING_ENTITLEMENT', 'ACCRUAL', 'CARRY_FORWARD', 'RESTORED']) {
		assert.throws(
			() => post({ kind, days: -1, leave_entitlement_id: ENTITLEMENT_ID }),
			/Grant, carry and restore entries must be positive/,
			`${kind} accepted a negative award`
		);
		assert.doesNotThrow(() => post({ kind, days: 1, leave_entitlement_id: ENTITLEMENT_ID }));
	}
	for (const kind of ['CARRY_TRANSFER_OUT', 'TAKEN', 'ENCASHED', 'COMMUTED', 'EXPIRED']) {
		assert.throws(
			() => post({ kind, days: 1, leave_entitlement_id: ENTITLEMENT_ID }),
			/Take, transfer, encash, commute and expiry entries must be negative/,
			`${kind} accepted a positive movement`
		);
		assert.doesNotThrow(() => post({ kind, days: -1, leave_entitlement_id: ENTITLEMENT_ID }));
	}
});

/**
 * A manual correction is the one line a person writes by hand, so it carries the most conditions:
 * a reason, a reference unique on the entitlement, an open entitlement, and a date inside the
 * leave year it belongs to. The duplicate check is deliberately before the approval is held, so a
 * reference cannot be posted twice while the first is still pending.
 */
const OPEN_YEAR = {
	id: ENTITLEMENT_ID,
	status: 'OPEN',
	starts_on: '2026-01-01',
	ends_on: '2026-12-31'
};
const manual = (over: Record<string, unknown> = {}) => ({
	kind: 'MANUAL_ADJUSTMENT',
	days: 2,
	leave_entitlement_id: ENTITLEMENT_ID,
	reason: 'Goodwill day for the shutdown',
	source_key: 'HR-2026-014',
	effective_on: '2026-06-01',
	...over
});

test('a manual adjustment needs a reason and a unique reference', () => {
	assert.throws(
		() => post(manual({ reason: '  ' }), api(OPEN_YEAR)),
		/A manual leave adjustment needs a reason/
	);
	assert.throws(
		() => post(manual({ source_key: '' }), api(OPEN_YEAR)),
		/A manual leave adjustment needs a unique reference/
	);
	assert.throws(
		() => post(manual(), api(OPEN_YEAR, { id: 'already-posted' })),
		/A leave entry with this reference is already posted on this entitlement/
	);
	assert.doesNotThrow(() => post(manual(), api(OPEN_YEAR)));
});

test('a manual adjustment needs an open entitlement and a date inside its leave year', () => {
	assert.throws(
		() => post(manual(), api()),
		/A manual leave adjustment requires an approved open entitlement/
	);
	assert.throws(
		() => post(manual(), api({ ...OPEN_YEAR, status: 'CLOSED' })),
		/requires an approved open entitlement/
	);
	assert.throws(
		() => post(manual({ effective_on: '2025-12-31' }), api(OPEN_YEAR)),
		/A manual leave adjustment must fall inside its leave year/
	);
	assert.throws(
		() => post(manual({ effective_on: '2027-01-01' }), api(OPEN_YEAR)),
		/must fall inside its leave year/
	);
	// The boundaries themselves are inside the year.
	assert.doesNotThrow(() => post(manual({ effective_on: '2026-01-01' }), api(OPEN_YEAR)));
	assert.doesNotThrow(() => post(manual({ effective_on: '2026-12-31' }), api(OPEN_YEAR)));
});
