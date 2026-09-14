// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * What the catalogue decides about a pay request, held as one rule with four callers.
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
 * The catalogue then split seven ways, and two more rules went with it. "This component is
 * calculated by the engine and takes no requests" is **unsayable**: the four event catalogues are
 * entered amounts by construction, so a schedule-fed row cannot exist in one. And the
 * `entry_kind` pairing rule is a **foreign key** — a claim request names a `claim_catalogue` row or
 * it does not write at all.
 *
 * What is left is what still lives on the catalogue and no column on a request can reach: evidence,
 * the entitlement ceiling, and the amount being a magnitude. The read path is the real guard, so
 * the tests drive it over the memory payroll world rather than a hand-written double.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { assertPayRequestAdmissible } from '../src/lib/pay_request_hooks.ts';
import claimHooks from '../src/collections/claim_requests/+hooks.ts';
import allowanceHooks from '../src/collections/allowance_requests/+hooks.ts';
import paymentHooks from '../src/collections/payment_requests/+hooks.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

const CLAIM_ID = '00000000-0000-4000-8000-0000000000c1';

/** One catalogue row per family, all sharing the spine with the evidence/eligibility under test. */
function requestWorld(component = {}) {
	const world = createPublicPayrollWorld();
	world.claim_catalogue.push({ ...world.allowance_catalogue[0], id: CLAIM_ID, code: 'MEDICAL' });
	for (const row of [
		world.claim_catalogue[0],
		world.payment_catalogue[0],
		world.allowance_catalogue[0]
	])
		Object.assign(row, component);
	return world;
}

const ENTRY = {
	code: 'X',
	evidence: 'NONE',
	bands: [],
	eligibility: '',
	destination: 'PAY',
	direction: 'ADD'
};

const guardOf = (hooks) => hooks.mutate.perRecord.before.handler;

const attempt = (hooks, component, input) => {
	const world = requestWorld({ bands: [], ...component });
	return Effect.runSync(
		guardOf(hooks)({ input, existing: undefined, api: memoryPayrollApi(world) })
	);
};

const CLAIM = {
	employment_id: EMPLOYMENT_ID,
	catalogue_id: CLAIM_ID,
	amount: 48,
	incurred_on: '2026-04-02'
};

test('a component that demands evidence gets it, whichever family the request is in', () => {
	const demanding = { code: 'MEDICAL', evidence: 'REQUIRED' };
	assert.throws(
		() => attempt(claimHooks, demanding, CLAIM),
		/MEDICAL requires evidence for its claims/
	);
	// Evidence is a catalogue fact, not a claim fact: a payment line that demands it refuses too,
	// and nothing but a claim can attach a receipt.
	assert.throws(
		() =>
			attempt(paymentHooks, demanding, {
				employment_id: EMPLOYMENT_ID,
				catalogue_id: '77777777-7777-4777-8777-777777777778',
				amount: 100,
				effective_on: '2026-04-02',
				reason: 'Approved'
			}),
		/MEDICAL requires evidence for its payments/
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
	// The column now exists on all three families, so an allowance line demands it the same way.
	const allowance = {
		employment_id: EMPLOYMENT_ID,
		catalogue_id: '77777777-7777-4777-8777-777777777777',
		amount: 100,
		recurrence: { kind: 'ONE_OFF', on: '2026-04-15' }
	};
	assert.throws(
		() => attempt(allowanceHooks, demanding, allowance),
		/MEDICAL requires evidence for its allowances/
	);
	attempt(allowanceHooks, demanding, {
		...allowance,
		evidence_file: {
			storage_key: 'k',
			file_name: 'r.pdf',
			mime_type: 'application/pdf',
			file_size: 1
		}
	});
});

test('a type whose eligibility rule does not hold for the person is refused, whichever family', () => {
	const drivers = {
		code: 'FUEL',
		evidence: 'NONE',
		eligibility: 'terms.department == "LOGISTICS"'
	};
	const claim = { ...CLAIM, catalogue_id: CLAIM_ID };
	assert.throws(
		() => attempt(claimHooks, drivers, claim),
		/FUEL is not offered to PF0001/,
		'the fixture contract has no department'
	);
	const world = requestWorld(drivers);
	world.employment_terms[0].department = 'LOGISTICS';
	assert.equal(
		Effect.runSync(
			guardOf(claimHooks)({
				input: claim,
				existing: undefined,
				api: memoryPayrollApi(world)
			})
		).employment_id,
		EMPLOYMENT_ID
	);
	// An empty rule is everyone, and asks nothing of the person.
	assert.equal(
		attempt(
			paymentHooks,
			{ code: 'BONUS', evidence: 'NONE', eligibility: '' },
			{
				employment_id: EMPLOYMENT_ID,
				catalogue_id: '77777777-7777-4777-8777-777777777778',
				amount: 100,
				effective_on: '2026-04-02',
				reason: 'Approved'
			}
		).employment_id,
		EMPLOYMENT_ID
	);
});

test('an amount is a positive magnitude, whichever family states it', () => {
	for (const amount of [0, -1, Number.NaN, 'not a number']) {
		assert.throws(
			() =>
				attempt(claimHooks, { code: 'X', evidence: 'NONE', eligibility: '' }, { ...CLAIM, amount }),
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
				eventDate: (c) => c.incurred_on
			},
			{ api: memoryPayrollApi(requestWorld()), input: CLAIM, existing: undefined }
		)
	);
});

test('Payment requires a reason and seals its contract', () => {
	const payment = {
		employment_id: EMPLOYMENT_ID,
		catalogue_id: '77777777-7777-4777-8777-777777777778',
		amount: 100,
		effective_on: '2026-04-02',
		reason: 'Approved separation payment'
	};
	const component = { code: 'SEPARATION', evidence: 'NONE', eligibility: '' };
	assert.throws(
		() => attempt(paymentHooks, component, { ...payment, reason: ' ' }),
		/requires a reason/
	);
	assert.equal(attempt(paymentHooks, component, payment).employment_id, EMPLOYMENT_ID);
});
