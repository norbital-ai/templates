// What an entitlement counts: service across every stint where the profile counts them, and an entry deleted after its
// run is paid, which no longer counts. Malaysia's law pack is only the fixture: its rows' bands are what the entry is
// written against.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { DateTime, Effect } from 'effect';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	catalogRow,
	pack,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	accountsIn,
	measureOf,
	leaveCreate,
	storedQuery
} from '../kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
type Person = {
	readonly started?: string;
	readonly gender?: 'FEMALE' | 'MALE';
	readonly events?: readonly JsonObject[];
};
const seedOf = ({ started = '2024-01-01', gender = 'FEMALE', events = [] }: Person) => {
	const seed = pack(
		'MY',
		'Asia/Kuala_Lumpur',
		{
			rate: { amount: 8000, unit: 'MONTHLY' },
			statutory_work_category: 'NON_MANUAL',
			work_classification: 'EA_COVERED',
			residency_status: 'CITIZEN',
			wage_payment_method: 'BANK',
			allowances: {}
		},
		{ events },
		[],
		[],
		'2026-11-15'
	);
	return {
		...seed,
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			service_started_on: started,
			effective_range: { from: started, to: null },
			payroll: { date_of_birth: '1990-01-01', gender, marital_status: 'MARRIED' }
		}))
	};
};
type Seed = ReturnType<typeof seedOf>;
const born = (...dates: readonly string[]) => dates.map((on) => ({ kind: 'CHILD_BIRTH', on }));
const dates = (from: string, count: number) =>
	Array.from({ length: count }, (_, index) =>
		DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(from), { days: index }))
	);
const take = (t: Kit, seed: Seed, code: string, days: readonly string[]) =>
	t.as(t.admin).pipe(
		Effect.flatMap((caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
						days: wholeDays(...days)
					})
				]
			})
		)
	);
const run = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.pipe(
			Effect.flatMap((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
			)
		)
		.pipe(Effect.andThen(t.run_due()));
/** How many leave entries the workspace holds. */
const entries = (t: Kit) =>
	storedQuery(t, { leave_catalog_entry: { fields: ['id'], limit: 10 } }).pipe(
		Effect.map(({ leave_catalog_entry }) => leave_catalog_entry.rows.length)
	);

describe('cumulative service', () => {
	it.live(
		'counts the stint before a rehire toward a qualifying period where the profile counts every stint',
		() => {
			const base = seedOf({ started: '2025-11-10', gender: 'MALE', events: born('2026-11-02') });
			const seed = {
				...base,
				employee_profile: [
					{ id: uuid(4), user_id: uuid(3), name: 'Worker', cumulative_service: true }
				],
				employee_contract: (base.employee_contract ?? []).flatMap((row) => [
					{
						...row,
						id: uuid(60),
						service_started_on: '2024-01-02',
						effective_range: { from: '2024-01-02', to: '2025-11-05' }
					},
					row
				])
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				// the current stint alone is short of the row's qualifying months
				assert.ok(measureOf(yield* accountsIn(t), 'leave', 'PATERNITY_LEAVE', 'entitled') > 0);
				yield* take(t, base, 'PATERNITY_LEAVE', ['2026-11-03']);
				assert.equal(yield* entries(t), 1);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		}
	);
});

describe('an unpaid-leave entry', () => {
	// two full years' service at the 12-day band; a month less and it is the 8-day band
	const seed = seedOf({ started: '2024-11-01' });
	const nine = dates('2026-11-23', 9);
	const layer = workspace({ seed, now: NOW });
	const unpaid = (t: Kit, days: readonly string[]) => take(t, seed, 'NPL', days);
	it.live('deleted after its run is paid no longer counts against another entitlement', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* unpaid(t, dates('2026-03-01', 31));
			yield* run(t, '2026-03');
			const [march] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
			const [priced] = (yield* storedQuery(t, { leave_catalog_entry: { limit: 1 } }))
				.leave_catalog_entry.rows;
			assert.ok(march !== undefined && priced !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.update': [{ target: march, set: { state: 'PAID' } }]
			});
			yield* t.run_due();
			yield* (yield* t.as(t.admin)).act({ 'leave_catalog_entry.delete': [{ target: priced }] });
			yield* t.run_due();
			yield* take(t, seed, 'ANNUAL_LEAVE', nine);
			assert.equal(yield* entries(t), 1);
		}).pipe(Effect.provide(layer))
	);
});
