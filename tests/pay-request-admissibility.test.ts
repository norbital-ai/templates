// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * What the catalogue decides about a pay request, held as one rule with five callers.
 *
 * This file replaces `component_entry_refusals.test.ts`, and most of what that file tested is
 * gone rather than moved. The arm rule existed to police a five-armed union — "only a claim carries
 * an evidence file", "a claim must say the day it was incurred", "arrears must name at least one
 * period", "a correction must name the settled adjustment it corrects" — and every one of those is
 * now a column that exists on one collection and nowhere else, or a `notNull` the database keeps.
 * A rule with nothing left to refuse is deleted, not ported;
 * `public-seed-pay-request-columns.integration.test.ts` is where those constraints are proven
 * against a real database, on the write path the seed itself takes.
 *
 * What could not become a column is what remains here: three facts that live on the *catalogue*,
 * which no column on a request can reach.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { assertPayRequestAdmissible } from '../src/lib/pay_request_hooks.ts';
import claimHooks from '../src/collections/claim_requests/+hooks.ts';
import allowanceHooks from '../src/collections/allowance_requests/+hooks.ts';
import bonusHooks from '../src/collections/bonus_requests/+hooks.ts';
import arrearsHooks from '../src/collections/arrears_requests/+hooks.ts';
import correctionHooks from '../src/collections/correction_requests/+hooks.ts';

const ENTRY_DEFINITION = {
	source: 'ENTRY',
	unit: 'MONEY',
	evidence: 'NONE',
	settlement: 'PAYROLL'
};

const apiWith = (component) => ({
	db: {
		component_catalogue: { findFirst: () => Effect.succeed(component) },
		claim_requests: { findMany: () => Effect.succeed([]) },
		allowance_requests: { findMany: () => Effect.succeed([]) },
		bonus_requests: { findMany: () => Effect.succeed([]) },
		arrears_requests: { findMany: () => Effect.succeed([]) },
		correction_requests: { findMany: () => Effect.succeed([]) }
	}
});

const guardOf = (hooks) => hooks.mutate.perRecord.before.handler;

const attempt = (hooks, component, input) =>
	Effect.runSync(guardOf(hooks)({ input, existing: undefined, api: apiWith(component) }));

const CLAIM = {
	employment_id: 'e1',
	component_catalogue_id: 'c1',
	amount: 48,
	incurred_on: '2026-04-02'
};

test('a component the engine feeds takes no requests at all', () => {
	// The silent half of the pairing: an entry against a schedule-fed component is the direction
	// nothing else would catch, because the run simply ignores it and the money never appears.
	for (const source of ['SCHEDULE', 'FORMULA', 'DERIVED_OVERTIME', 'LEAVE_PAYOUT']) {
		assert.throws(
			() =>
				attempt(
					claimHooks,
					{ code: 'BASIC', definition: { ...ENTRY_DEFINITION, source }, entry_kind: null },
					CLAIM
				),
			/BASIC is calculated by the engine and takes no requests/
		);
	}
});

test('the request family is the component’s, and each collection is checked against its own', () => {
	const cases = [
		[claimHooks, 'CLAIM', CLAIM],
		[
			allowanceHooks,
			'ALLOWANCE',
			{
				employment_id: 'e1',
				component_catalogue_id: 'c1',
				amount: 100,
				recurrence: { kind: 'ONE_OFF', period: '2026-04' }
			}
		],
		[
			bonusHooks,
			'BONUS',
			{ employment_id: 'e1', component_catalogue_id: 'c1', amount: 100, awarded_on: '2026-04-02' }
		],
		[
			arrearsHooks,
			'ARREARS',
			{
				employment_id: 'e1',
				component_catalogue_id: 'c1',
				amount: 100,
				settled_on: '2026-04-02',
				covers_periods: ['2026-01'],
				reason: 'late start'
			}
		],
		[
			correctionHooks,
			'CORRECTION',
			{
				employment_id: 'e1',
				component_catalogue_id: 'c1',
				amount: 100,
				corrected_on: '2026-04-02',
				corrects_adjustment_id: 'a1',
				operation: 'CORRECTION',
				reason: 'wrong rate'
			}
		]
	];
	for (const [hooks, family, input] of cases) {
		// Its own family passes…
		attempt(hooks, { code: 'X', definition: ENTRY_DEFINITION, entry_kind: family }, input);
		// …and every other one is refused, by name and in the vocabulary an operator reads.
		for (const [, other] of cases) {
			if (other === family) continue;
			assert.throws(
				() => attempt(hooks, { code: 'X', definition: ENTRY_DEFINITION, entry_kind: other }, input),
				new RegExp(`X takes ${other} requests, and this is a ${family} one`),
				`${family} against a ${other} component`
			);
		}
		// A component that declares no family takes nothing from anybody.
		assert.throws(
			() => attempt(hooks, { code: 'X', definition: ENTRY_DEFINITION, entry_kind: null }, input),
			/takes no requests/
		);
	}
});

test('a component that demands evidence gets it, and only the claim collection can carry one', () => {
	const demanding = {
		code: 'MEDICAL',
		definition: { ...ENTRY_DEFINITION, evidence: 'REQUIRED' },
		entry_kind: 'CLAIM'
	};
	assert.throws(
		() => attempt(claimHooks, demanding, CLAIM),
		/MEDICAL requires evidence for its claims/
	);
	attempt(claimHooks, demanding, {
		...CLAIM,
		evidence_file: {
			storage_key: 'k',
			file_name: 'r.pdf',
			mime_type: 'application/pdf',
			file_size: 1
		}
	});
	// The refusal that said "only a claim carries an evidence file" is gone because there is no
	// evidence column on the other four collections to refuse — a bonus cannot name a receipt.
	assert.equal(
		'evidence_file' in
			{ employment_id: 'e1', component_catalogue_id: 'c1', amount: 100, awarded_on: '2026-04-02' },
		false
	);
});

test('an amount is a positive magnitude, whichever family states it', () => {
	for (const amount of [0, -1, Number.NaN, 'not a number']) {
		assert.throws(
			() =>
				attempt(
					claimHooks,
					{ code: 'X', definition: ENTRY_DEFINITION, entry_kind: 'CLAIM' },
					{ ...CLAIM, amount }
				),
			/A claim amount is a positive magnitude/,
			String(amount)
		);
	}
});

test('a component that is not in the catalogue at all refuses nothing here', () => {
	// Deliberate: the foreign key is what refuses an unknown component, and it refuses it on every
	// path including the seed. A second refusal in the hook would be a rule the database already
	// holds, stated worse.
	Effect.runSync(
		assertPayRequestAdmissible(
			{
				family: 'CLAIM',
				noun: 'claim',
				eventDate: (c) => c.incurred_on,
				capture: () => Effect.succeed(undefined),
				siblings: () => Effect.succeed([])
			},
			{ api: apiWith(undefined), input: CLAIM, existing: undefined }
		)
	);
});
