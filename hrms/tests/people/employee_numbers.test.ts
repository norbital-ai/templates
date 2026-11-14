// An employee number is the one given, the one the person already holds, or the one the database counted for their
// profile: people hired at the same moment never share one, and a rehire keeps theirs.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { ENTITY, PAY_GROUP, agreedTerms, pack, storedQuery, uuid, workspace } from '../kit.ts';

const AGREED = agreedTerms(2800, 'MANUAL_LABOUR');
const seed = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{ ...AGREED, residency_status: 'CITIZEN' },
	{},
	[],
	[]
);
const PEOPLE = Array.from({ length: 6 }, (_, index) => idOf('employee_profile', uuid(800 + index)));

const hire = (person: Id<'employee_profile'>, from: string, to: string | null = null) => ({
	employee_id: person,
	entity_id: ENTITY,
	effective_range: { from, to },
	reason: 'A new stint',
	terms: [
		{
			effective_from: from,
			engagement: 'EMPLOYEE' as const,
			pay_group_id: idOf('pay_group', PAY_GROUP),
			...AGREED
		}
	],
	parameters: [
		{
			effective_from: from,
			residency_status: 'CITIZEN' as const,
			marital_status: 'SINGLE' as const
		}
	]
});
const stints = (t: Kit) =>
	storedQuery(t, { employment: { where: { employee_id: { in: PEOPLE } }, limit: 100 } }).pipe(
		Effect.map((got) => got.employment.rows)
	);

describe('an employee number', () => {
	it.live('is counted by the database: hires at the same moment never share one', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			// the profiles themselves are filed at the same moment, each in its own write
			yield* Effect.all(
				PEOPLE.map((id, index) =>
					admin.act({ 'employee_profile.create': [{ id, name: `Person ${index}` }] })
				),
				{ concurrency: 'unbounded' }
			);
			yield* Effect.all(
				PEOPLE.map((id) => admin.act({ 'employment.create': [hire(id, '2026-01-01')] })),
				{ concurrency: 'unbounded' }
			);
			const held = (yield* stints(t)).map((row) => row.employee_number);
			assert.equal(held.length, PEOPLE.length);
			assert.equal(new Set(held).size, PEOPLE.length);
			for (const number of held) assert.match(number, /^HR-\d{4}$/);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })))
	);
	it.live('stays with the person on a rehire, and a given one is kept as given', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			const [first, second] = PEOPLE;
			assert.ok(first !== undefined && second !== undefined);
			yield* admin.act({
				'employee_profile.create': [
					{ id: first, name: 'Person 0' },
					{ id: second, name: 'Person 1' }
				]
			});
			yield* admin.act({
				'employment.create': [
					{ ...hire(first, '2025-01-01', '2025-06-30'), employee_number: 'A-77' },
					hire(second, '2025-01-01', '2025-06-30')
				]
			});
			yield* admin.act({
				'employment.create': [hire(first, '2026-01-01'), hire(second, '2026-01-01')]
			});
			const got = yield* stints(t);
			const held = (person: Id<'employee_profile'>) =>
				got.filter((row) => row.employee_id === person).map((row) => row.employee_number);
			assert.deepEqual(held(first), ['A-77', 'A-77']);
			const [counted, again] = held(second);
			assert.match(String(counted), /^HR-\d{4}$/);
			assert.equal(again, counted);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })))
	);
});
