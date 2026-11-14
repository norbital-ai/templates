// A half-day of a person is taken once, and a slot leaves only through its leave: the ledger posts from the entry.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	leaveCreate,
	pack,
	storedQuery,
	uuid,
	wholeDays,
	workspace,
	packTerms
} from '../kit.ts';

const NOW = '2026-10-06T02:00:00.000Z';
const EMPLOYMENT = idOf('employment', uuid(6));
const seed = pack('ZZ', 'Asia/Kuala_Lumpur', packTerms(8000), {}, [], []);
const leave = (days: ReturnType<typeof wholeDays>) =>
	leaveCreate({
		entity_id: ENTITY,
		employment_id: EMPLOYMENT,
		catalog_code: 'NPL',
		days
	});
const take = (t: Kit, ...rows: readonly ReturnType<typeof leave>[]) =>
	Effect.flatMap(t.as(t.admin), (caller) => caller.act({ 'leave_catalog_entry.create': rows }));

describe('a half-day of leave', () => {
	it.live('is taken once: a second leave on it is refused, in a later save or the same one', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, leave(wholeDays('2026-10-12')));
			const again = yield* Effect.flip(take(t, leave([{ date: '2026-10-12', part: 'PM' }])));
			assert.match(JSON.stringify(again), /Leave already covers 2026-10-12/);
			const twice = yield* Effect.flip(
				take(t, leave(wholeDays('2026-10-13')), leave(wholeDays('2026-10-13')))
			);
			assert.match(JSON.stringify(twice), /Leave already covers 2026-10-13/);
			yield* take(t, leave(wholeDays('2026-10-14')));
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('leaves only through its leave: HR changes the leave, never a slot on its own', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = yield* t.as(yield* t.sign_in('payroll@example.test'));
			yield* hr.act({
				'leave_catalog_entry.create': [leave(wholeDays('2026-10-12', '2026-10-13'))]
			});
			const slots = () =>
				storedQuery(t, { leave_catalog_entry_day: { limit: 10 } }).pipe(
					Effect.map((got) => got.leave_catalog_entry_day.rows)
				);
			const [slot] = yield* slots();
			assert.ok(slot !== undefined);
			yield* Effect.flip(hr.act({ 'leave_catalog_entry_day.delete': [{ target: slot }] }));
			assert.equal((yield* slots()).length, 4);
			const [entry] = (yield* storedQuery(t, { leave_catalog_entry: { limit: 1 } }))
				.leave_catalog_entry.rows;
			assert.ok(entry !== undefined);
			yield* hr.act({
				'leave_catalog_entry.update': [
					{ target: entry, set: { leave_catalog_entry_day: { delete: [slot] } } }
				]
			});
			assert.equal((yield* slots()).length, 3);
		}).pipe(
			Effect.provide(
				workspace({
					seed: {
						...seed,
						sys_user: [
							...(seed.sys_user ?? []),
							{
								id: uuid(41),
								name: 'Payroll',
								email: 'payroll@example.test',
								kind: 'staff',
								team: 'hr_controller'
							}
						]
					},
					now: NOW
				})
			)
		)
	);
});
