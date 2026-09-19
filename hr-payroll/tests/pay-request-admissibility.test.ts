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
import { admitPayRequests } from '../src/lib/pay_request_rules.ts';
import claimRequests from '../src/collections/claim_requests/+collection.ts';
import adhocRequests from '../src/collections/adhoc_requests/+collection.ts';
import allowances from '../src/collections/allowances/+collection.ts';
import { transformOne } from './helpers/transform.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	STANDING_ENTRY_ID,
	TRANSPORT_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

const CLAIM_ID = '00000000-0000-4000-8000-0000000000c1';
const ADHOC_ID = '00000000-0000-4000-8000-0000000000a1';

/** One catalogue row per family, all sharing the spine with the evidence/eligibility under test. */
function requestWorld(component = {}) {
	const world = createPublicPayrollWorld();
	world.claim_catalogue.push({ ...world.allowance_catalogue[0], id: CLAIM_ID, code: 'MEDICAL' });
	world.adhoc_catalogue = [
		{ ...world.allowance_catalogue[0], id: ADHOC_ID, code: 'BONUS', raised_by: 'MANUAL' }
	];
	for (const row of [
		world.claim_catalogue[0],
		world.adhoc_catalogue[0],
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

const attempt = (collection, component, input) => {
	const world = requestWorld({ bands: [], ...component });
	return transformOne(collection, input, undefined, memoryPayrollApi(world).db);
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
		() => attempt(claimRequests, demanding, CLAIM),
		/MEDICAL requires evidence for its claims/
	);
	attempt(claimRequests, demanding, {
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
		effective_from: '2026-04-01',
		effective_to: '2026-04-30'
	};
	assert.throws(
		() => attempt(allowances, demanding, allowance),
		/MEDICAL requires evidence for its allowances/
	);
	attempt(allowances, demanding, {
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
		() => attempt(claimRequests, drivers, claim),
		/FUEL is not offered to PF0001/,
		'the fixture contract has no department'
	);
	const world = requestWorld(drivers);
	world.employment_terms[0].department = 'LOGISTICS';
	assert.equal(
		transformOne(claimRequests, claim, undefined, memoryPayrollApi(world).db).employment_id,
		EMPLOYMENT_ID
	);
	// An empty rule is everyone, and asks nothing of the person.
	assert.equal(
		attempt(
			allowances,
			{ code: 'BONUS', evidence: 'NONE', eligibility: '' },
			{
				employment_id: EMPLOYMENT_ID,
				catalogue_id: TRANSPORT_ID,
				amount: 100,
				effective_from: '2026-04-01',
				effective_to: null
			}
		).employment_id,
		EMPLOYMENT_ID
	);
});

test('an amount is a positive magnitude, whichever family states it', () => {
	for (const amount of [0, -1, Number.NaN, 'not a number']) {
		assert.throws(
			() =>
				attempt(
					claimRequests,
					{ code: 'X', evidence: 'NONE', eligibility: '' },
					{ ...CLAIM, amount }
				),
			/A claim amount is a positive magnitude/,
			String(amount)
		);
	}
});

const ADHOC = {
	employment_id: EMPLOYMENT_ID,
	catalogue_id: ADHOC_ID,
	amount: 0,
	event_date: '2026-04-02'
};

test('an ad hoc request is a claim in another family: a band-priced class takes no amount, a stated one must be positive', () => {
	// Separation pay is priced from the person by the class's band: the request states nothing.
	assert.equal(
		attempt(
			adhocRequests,
			{
				code: 'BONUS',
				evidence: 'NONE',
				eligibility: '',
				bands: [{ when: '', amount: '100.0', limit: null }]
			},
			ADHOC
		).employment_id,
		EMPLOYMENT_ID
	);
	assert.throws(
		() => attempt(adhocRequests, { code: 'BONUS', evidence: 'NONE', eligibility: '' }, ADHOC),
		/An ad hoc payment amount is a positive magnitude/
	);
	assert.throws(
		() =>
			attempt(
				adhocRequests,
				{ code: 'BONUS', evidence: 'REQUIRED', eligibility: '' },
				{ ...ADHOC, amount: 500 }
			),
		/requires evidence/
	);
	assert.throws(
		() =>
			attempt(
				adhocRequests,
				{ code: 'BONUS', evidence: 'NONE', eligibility: 'employment.service_months >= 600' },
				{ ...ADHOC, amount: 500 }
			),
		/eligibility rule does not hold/
	);
	// A separation class reads the leaver's exit at the write, as the run does: off-boarding's
	// request on the last day of a redundancy is admitted, the same request on an open contract not.
	const separation = {
		code: 'TERMINATION_BENEFIT',
		evidence: 'NONE',
		eligibility: 'employment.exit_reason == "REDUNDANCY"',
		bands: [{ when: '', amount: 'person.terms.monthly_wage', limit: null }]
	};
	assert.throws(() => attempt(adhocRequests, separation, ADHOC), /eligibility rule does not hold/);
	const world = requestWorld({ ...separation });
	Object.assign(
		world.employments.find((row) => row.id === EMPLOYMENT_ID)!,
		{
			effective_range: { start: '2021-06-01', end: '2026-04-30' },
			exit_reason: 'REDUNDANCY'
		}
	);
	assert.equal(
		transformOne(
			adhocRequests,
			{ ...ADHOC, event_date: '2026-04-30' },
			undefined,
			memoryPayrollApi(world).db
		).employment_id,
		EMPLOYMENT_ID
	);
});

test('a component that is not in the catalogue at all refuses nothing here', () => {
	// Deliberate: the foreign key is what refuses an unknown component, and it refuses it on every
	// path including the seed. A second refusal in the transform would be a rule the database
	// already holds, stated worse.
	Effect.runSync(
		admitPayRequests(
			{
				family: 'CLAIM',
				catalogue: 'claim_catalogue',
				requests: 'claim_requests',
				noun: 'claim',
				eventDate: (c) => c.incurred_on
			},
			memoryPayrollApi(requestWorld()).db,
			[CLAIM],
			[undefined]
		)
	);
});

test('an allowance is admitted with an empty reason, seals its contract, and states a window that opens before it closes', () => {
	// The reason is a descriptive column: the transform does not gate on it, and the contract
	// binding is still enforced by `boundToContract` on the way in.
	const standing = {
		employment_id: EMPLOYMENT_ID,
		catalogue_id: TRANSPORT_ID,
		amount: 100,
		effective_from: '2026-04-02',
		effective_to: null,
		reason: ''
	};
	const component = { code: 'TRANSPORT', evidence: 'NONE', eligibility: '' };
	assert.equal(attempt(allowances, component, standing).employment_id, EMPLOYMENT_ID);
	assert.throws(
		() => attempt(allowances, component, { ...standing, effective_to: '2026-04-01' }),
		/cannot end before it starts/
	);
	assert.throws(
		() => attempt(allowances, component, { ...standing, effective_from: undefined }),
		/states the day it starts/
	);
});
