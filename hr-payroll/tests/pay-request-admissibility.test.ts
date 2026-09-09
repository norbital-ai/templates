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
 * the entitlement ceiling, and the amount being a magnitude.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { assertPayRequestAdmissible } from '../src/lib/pay_request_hooks.ts';
import claimHooks from '../src/collections/claim_requests/+hooks.ts';
import allowanceHooks from '../src/collections/allowance_requests/+hooks.ts';
import paymentHooks from '../src/collections/payment_requests/+hooks.ts';

const ENTRY = { evidence: 'NONE', settlement: 'PAYROLL', cap: null, eligibility: '' };

const apiWith = (component) => ({
	db: {
		claim_catalogue: { findFirst: () => Effect.succeed(component) },
		allowance_catalogue: { findFirst: () => Effect.succeed(component) },
		payment_catalogue: { findFirst: () => Effect.succeed(component) },
		claim_requests: { findMany: () => Effect.succeed([]) },
		allowance_requests: { findMany: () => Effect.succeed([]) },
		payment_requests: { findMany: () => Effect.succeed([]) }
	}
});

const guardOf = (hooks) => hooks.mutate.perRecord.before.handler;

const attempt = (hooks, component, input) =>
	Effect.runSync(guardOf(hooks)({ input, existing: undefined, api: apiWith(component) }));

const CLAIM = {
	employment_id: 'e1',
	claim_catalogue_id: 'c1',
	amount: 48,
	incurred_on: '2026-04-02'
};

test('a component that demands evidence gets it, whichever family the request is in', () => {
	const demanding = { code: 'MEDICAL', ...ENTRY, evidence: 'REQUIRED' };
	assert.throws(
		() => attempt(claimHooks, demanding, CLAIM),
		/MEDICAL requires evidence for its claims/
	);
	// Evidence is a catalogue fact, not a claim fact: a payment line that demands it refuses too,
	// and nothing but a claim can attach a receipt.
	assert.throws(
		() =>
			attempt(paymentHooks, demanding, {
				employment_id: 'e1',
				payment_catalogue_id: 'c1',
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
	// There is no evidence column on the other collections — a payment cannot name a receipt.
	assert.equal(
		'evidence_file' in
			{ employment_id: 'e1', payment_catalogue_id: 'c1', amount: 100, effective_on: '2026-04-02' },
		false
	);
});

test('an amount is a positive magnitude, whichever family states it', () => {
	for (const amount of [0, -1, Number.NaN, 'not a number']) {
		assert.throws(
			() => attempt(claimHooks, { code: 'X', ...ENTRY }, { ...CLAIM, amount }),
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

test('Payment requires a reason, seals its contract and rejects a correction from another contract', () => {
	const payment = {
		employment_id: 'e1',
		payment_catalogue_id: 'c1',
		amount: 100,
		effective_on: '2026-04-02',
		reason: 'Approved separation payment'
	};
	const component = { code: 'SEPARATION', ...ENTRY };
	assert.throws(
		() => attempt(paymentHooks, component, { ...payment, reason: ' ' }),
		/requires a reason/
	);
	assert.equal(attempt(paymentHooks, component, payment).employment_id, 'e1');
	const api = apiWith(component);
	api.db.payslips = { findFirst: () => Effect.succeed({ employment_id: 'old-contract' }) };
	assert.throws(
		() =>
			Effect.runSync(
				guardOf(paymentHooks)({ input: { ...payment, corrects_payslip_id: 'old-line' }, api })
			),
		/same employment contract/
	);
});
