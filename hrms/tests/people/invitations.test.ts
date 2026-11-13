// An accepted staff invitation owns exactly one employee profile: the write that accepts it links the person HR imported under
// that address, makes a profile for someone HR never entered, and does neither twice. Nobody links a login by hand.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { pack, uuid, workspace, storedQuery } from '../kit.ts';

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
	// Worker is linked already; Imported waits under their address; Newcomer was never entered; Pending has not accepted.
	// Imported and Newcomer have no login yet: signing in accepts their open invitation and creates it.
	employee_profile: [
		...(base.employee_profile ?? []),
		{ id: uuid(62), name: 'Imported', email: 'imported@example.test' }
	],
	sys_invitation: [
		invitation(70, 'Worker', true),
		invitation(71, 'Imported', false),
		invitation(72, 'Newcomer', false),
		invitation(73, 'Pending', false)
	]
};
/** Every profile as `[name, login]`, by name. */
const profiles = (t: Kit) =>
	storedQuery(t, { employee_profile: { limit: 100 } }).pipe(
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
				// signing in accepts the invitation: the user it writes is what provisions the profile
				const accept = Effect.gen(function* () {
					yield* t.sign_in('imported@example.test');
					yield* t.sign_in('newcomer@example.test');
					assert.deepEqual((yield* t.run_due()).failed, []);
				});
				yield* accept;
				const linked = yield* profiles(t);
				assert.deepEqual(
					linked.map(([name, login]) => [name, login !== null]),
					[
						['Imported', true],
						['Newcomer', true],
						['Worker', true]
					]
				);
				assert.equal(linked.find(([name]) => name === 'Worker')?.[1], uuid(3));
				assert.equal(linked.find(([name]) => name === 'Imported')?.[2], uuid(62));
				// signing in again writes nothing new, and nothing is provisioned twice
				yield* accept;
				assert.deepEqual(yield* profiles(t), linked);
				const admin = yield* t.as(t.admin);
				const newcomer = linked.find(([name]) => name === 'Newcomer')?.[1];
				assert.ok(newcomer != null);
				// a login is the invitation's to link, an admin included
				const refused = yield* Effect.flip(
					admin.act({
						'employee_profile.create': [{ name: 'By hand', user_id: idOf('sys_user', newcomer) }]
					})
				);
				assert.ok(refused._tag === 'ActRefused');
				assert.equal(refused.key, 'errors.employee_profile_invitation_links');
				assert.deepEqual(yield* profiles(t), linked);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});
