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
import { admitPayRequests } from '../src/lib/pay_request_rules.ts';
import claimRequests from '../src/data/collection/claim_requests/+collection.ts';
import adhocRequests from '../src/data/collection/adhoc_requests/+collection.ts';
import { matches, memoryDb, runTransform } from './helpers/ctx.ts';
import hrController from '../src/access/+hr_controller.policy.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	STANDING_ENTRY_ID,
	TRANSPORT_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';

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

/** One create through the collection's transform over the world; its payload back. */
const write = async (collection, input, world) =>
	(await runTransform(collection, [input], { tables: world }))[0];
const attempt = (collection, component, input) =>
	write(collection, input, requestWorld({ bands: [], ...component }));

const ADHOC = {
	employment_id: EMPLOYMENT_ID,
	catalogue_id: ADHOC_ID,
	amount: 0,
	event_date: '2026-04-02'
};

const CLAIM = {
	employment_id: EMPLOYMENT_ID,
	catalogue_id: CLAIM_ID,
	amount: 48,
	incurred_on: '2026-04-02'
};

test('a component that demands evidence gets it, whichever family the request is in', async () => {
	const demanding = { code: 'MEDICAL', evidence: 'REQUIRED' };
	await assert.rejects(
		attempt(claimRequests, demanding, CLAIM),
		/MEDICAL requires evidence for its claims/
	);
	await attempt(claimRequests, demanding, {
		...CLAIM,
		evidence_file: {
			storage_key: 'k',
			file_name: 'r.pdf',
			mime_type: 'application/pdf',
			file_size: 1
		}
	});
	// The column exists on the ad hoc family too, so an ad hoc request demands it the same way.
	await assert.rejects(
		attempt(adhocRequests, demanding, { ...ADHOC, catalogue_id: ADHOC_ID, amount: 100 }),
		/MEDICAL requires evidence for its ad hoc payments/
	);
});

test('a type whose eligibility rule does not hold for the person is refused, whichever family', async () => {
	const drivers = {
		code: 'FUEL',
		evidence: 'NONE',
		eligibility: 'terms.department == "LOGISTICS"'
	};
	const claim = { ...CLAIM, catalogue_id: CLAIM_ID };
	await assert.rejects(
		attempt(claimRequests, drivers, claim),
		/FUEL is not offered to PF0001/,
		'the fixture contract has no department'
	);
	const world = requestWorld(drivers);
	world.employment_terms[0].department = 'LOGISTICS';
	assert.equal((await write(claimRequests, claim, world)).employment_id, EMPLOYMENT_ID);
	// An empty rule is everyone, and asks nothing of the person.
	assert.equal(
		(
			await attempt(
				adhocRequests,
				{ code: 'BONUS', evidence: 'NONE', eligibility: '' },
				{
					employment_id: EMPLOYMENT_ID,
					catalogue_id: ADHOC_ID,
					amount: 100,
					event_date: '2026-04-01'
				}
			)
		).employment_id,
		EMPLOYMENT_ID
	);
});

test('an amount is a positive magnitude, whichever family states it', async () => {
	for (const amount of [0, -1, Number.NaN, 'not a number']) {
		await assert.rejects(
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

test('an ad hoc request is a claim in another family: a band-priced class takes no amount, a stated one must be positive', async () => {
	// Separation pay is priced from the person by the class's band: the request states nothing.
	assert.equal(
		(
			await attempt(
				adhocRequests,
				{
					code: 'BONUS',
					evidence: 'NONE',
					eligibility: '',
					bands: [{ when: '', amount: '100.0', limit: null }]
				},
				ADHOC
			)
		).employment_id,
		EMPLOYMENT_ID
	);
	await assert.rejects(
		attempt(adhocRequests, { code: 'BONUS', evidence: 'NONE', eligibility: '' }, ADHOC),
		/An ad hoc payment amount is a positive magnitude/
	);
	await assert.rejects(
		attempt(
			adhocRequests,
			{ code: 'BONUS', evidence: 'REQUIRED', eligibility: '' },
			{ ...ADHOC, amount: 500 }
		),
		/requires evidence/
	);
	await assert.rejects(
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
	await assert.rejects(attempt(adhocRequests, separation, ADHOC), /eligibility rule does not hold/);
	const world = requestWorld({ ...separation });
	Object.assign(
		world.employments.find((row) => row.id === EMPLOYMENT_ID)!,
		{
			effective_range: { start: '2021-06-01', end: '2026-04-30' },
			exit_reason: 'REDUNDANCY'
		}
	);
	assert.equal(
		(await write(adhocRequests, { ...ADHOC, event_date: '2026-04-30' }, world)).employment_id,
		EMPLOYMENT_ID
	);
});

test('a component that is not in the catalogue at all refuses nothing here', async () => {
	// Deliberate: the foreign key is what refuses an unknown component, and it refuses it on every
	// path including the seed. A second refusal in the transform would be a rule the database
	// already holds, stated worse.
	await admitPayRequests(
		{
			family: 'CLAIM',
			catalogue: 'claim_catalogue',
			requests: 'claim_requests',
			noun: 'claim',
			eventDate: (c) => c.incurred_on
		},
		memoryDb(requestWorld()),
		[CLAIM],
		[undefined]
	);
});

test('a captured claim refuses an edit and a delete; an uncaptured one takes both', async () => {
	const stored = (payslip_id) => ({
		...CLAIM,
		id: 'claim-1',
		as_adjustment_entry: false,
		payslip_id
	});
	const edit = (row) => {
		const world = requestWorld({ ...ENTRY, code: 'MEDICAL' });
		world.claim_requests.push(row);
		return runTransform(claimRequests, [{ amount: 400 }], { tables: world, existing: [row] });
	};
	// The lock is the pin: the row says a payslip took it, so no other read has to answer.
	await assert.rejects(
		edit(stored('paid-slip')),
		/Changing this claim.*already taken this record into account/s
	);
	await edit(stored(null));
	// A delete is the grant's predicate over the same pin.
	const deletable = (row) =>
		matches({}, 'claim_requests', row, hrController.grants.claim_requests.delete);
	assert.equal(deletable(stored('paid-slip')), false);
	assert.equal(deletable(stored(null)), true);
});

test('a ceiling is spent at the band price, and a religious holiday twice in the year is two ceilings (ID Permenaker 6/2016 arts.3(1), 5(2))', async () => {
	// THR's shape: the band prices one month's wage whatever is keyed, and the calendar-year
	// ceiling is one of them per tagged holiday of the worker's religion, never fewer than one.
	const thr = {
		code: 'BONUS',
		evidence: 'NONE',
		eligibility: '',
		bands: [
			{
				when: '',
				amount: '100.0',
				limit: {
					period: 'CALENDAR_YEAR',
					on_exceed: 'BLOCK',
					amount: '100.0 * (entry.religious_holidays > 1.0 ? entry.religious_holidays : 1.0)'
				}
			}
		]
	};
	const world = (holidays) => {
		const tables = requestWorld(thr);
		tables.employees[0].religion = 'ISLAM';
		tables.adhoc_requests = [
			{
				...ADHOC,
				id: 'adhoc-first',
				as_adjustment_entry: false,
				payslip_id: null,
				approval_id: null
			}
		];
		tables.jurisdiction_holidays = holidays.map((date) => ({
			id: `holiday-${date}`,
			company_id: COMPANY_ID,
			date,
			name: 'Idul Fitri (synthetic)',
			religion: 'ISLAM',
			published_at: '2025-12-01T00:00:00.000Z',
			approval_id: null
		}));
		return tables;
	};
	// Both keyed at 0: the first is still 100 of the ceiling, so the second is over it.
	await assert.rejects(write(adhocRequests, ADHOC, world([])), /BONUS entitlement exceeded/);
	await assert.rejects(
		write(adhocRequests, ADHOC, world(['2026-01-02'])),
		/BONUS entitlement exceeded/
	);
	assert.equal(
		(await write(adhocRequests, ADHOC, world(['2026-01-02', '2026-12-22']))).employment_id,
		EMPLOYMENT_ID
	);
});
