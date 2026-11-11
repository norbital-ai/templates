// An accepted staff invitation owns exactly one employee profile: the automation links the person HR imported under
// that address, makes a profile for someone HR never entered, and does neither twice. Nobody links a login by hand.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { pack, uuid, workspace } from './kit.ts';

const NOW = '2026-02-20T02:00:00.000Z';
const base = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{
		rate: { amount: 3120, unit: 'MONTHLY' },
		statutory_work_category: 'MANUAL_LABOUR',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{},
	[],
	[]
);
const user = (id: number, name: string) => ({
	id: uuid(id),
	name,
	email: `${name.toLowerCase()}@example.test`,
	kind: 'staff'
});
const invitation = (id: number, name: string, accepted: boolean) => ({
	id: uuid(id),
	email: `${name.toLowerCase()}@example.test`,
	expires_at: '2026-03-01T00:00:00.000Z',
	...(accepted ? { accepted_at: '2026-02-19T00:00:00.000Z' } : {})
});
const seed = {
	...base,
	// Worker is linked already; Imported waits under their address; Newcomer was never entered; Pending has not accepted
	sys_user: [...(base.sys_user ?? []), user(60, 'Imported'), user(61, 'Newcomer')],
	employee_profile: [
		...(base.employee_profile ?? []),
		{ id: uuid(62), name: 'Imported', email: 'imported@example.test' }
	],
	sys_invitation: [
		invitation(70, 'Worker', true),
		invitation(71, 'Imported', true),
		invitation(72, 'Newcomer', true),
		invitation(73, 'Pending', false)
	]
};
/** Every profile as `[name, login]`, by name. */
const profiles = (t: Kit) =>
	t
		.storedQuery({ employee_profile: { limit: 100 } })
		.pipe(
			Effect.map(({ employee_profile }) =>
				employee_profile.rows
					.map((row) => [row.name, row.user_id ?? null, row.id] as const)
					.toSorted(([left], [right]) => left.localeCompare(right))
			)
		);

describe('an accepted invitation', () => {
	it.live(
		'links the imported person, makes one profile for a newcomer, leaves the linked and the unaccepted alone, and does nothing twice',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				// the automation runs on its minute
				t.clock.set('2026-02-20T02:01:00.000Z');
				assert.deepEqual((yield* t.runDue()).failed, []);
				const linked = yield* profiles(t);
				assert.deepEqual(
					linked.map(([name, login]) => [name, login]),
					[
						['Imported', uuid(60)],
						['Newcomer', uuid(61)],
						['Worker', uuid(3)]
					]
				);
				assert.equal(linked.find(([name]) => name === 'Imported')?.[2], uuid(62));
				t.clock.set('2026-02-20T02:02:00.000Z');
				assert.deepEqual((yield* t.runDue()).failed, []);
				assert.deepEqual(yield* profiles(t), linked);
				// a login is the invitation's to link, an admin included
				assert.match(
					String(
						yield* Effect.flip(
							t
								.as(t.admin)
								.act('employee_profile.create', [
									{ name: 'By hand', user_id: idOf('sys_user', uuid(61)) }
								])
						)
					),
					/Only an accepted invitation links a profile to a login/
				);
				assert.deepEqual(yield* profiles(t), linked);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});
