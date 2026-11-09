// EPF and PERKESO registration are one-time employer facts. A missing date is "not recorded", so the task confirms the
// registration; recording the date stops the reminder. There is no statutory deadline tied to the entity version date.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace } from './kit.ts';

const PROFILE = idOf('entity_profile_version', uuid(2));
const terms = {
	rate: { amount: 5000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const seedOf = (dates: { readonly epf_registered_on?: string; readonly socso_registered_on?: string } = {}) => {
	const base = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], [], '2026-06-15');
	return {
		...base,
		entity: (base.entity ?? []).map((row) => ({
			...row,
			...(dates.epf_registered_on === undefined
				? {}
				: { epf_registered_on: dates.epf_registered_on }),
			...(dates.socso_registered_on === undefined
				? {}
				: { socso_registered_on: dates.socso_registered_on })
		}))
	};
};
const live = (dates = {}) =>
	workspace({ seed: seedOf(dates), now: '2026-07-01T02:00:00.000Z' });
const keys = (t: Kit, prefix: string) =>
	t.storedQuery({ obligation: { limit: 100 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows.filter((row) => String(row.occurrence_key).startsWith(prefix))
		)
	);
const touch = (t: Kit) =>
	t.as(t.admin).act('entity_profile_version.update', [{ target: PROFILE, set: { reason: 'Review' } }]);

describe('MY employer registration reminders', () => {
	it('a missing date raises a confirmation task without a due date', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* touch(t);
			yield* t.runDue();
			const epf = yield* keys(t, 'MY:EPF_EMPLOYER_REGISTRATION:');
			const socso = yield* keys(t, 'MY:SOCSO_EIS_EMPLOYER_REGISTRATION:');
			assert.equal(epf.length, 1);
			assert.equal(socso.length, 1);
			assert.equal(epf[0]?.due_on ?? null, null);
			assert.equal(socso[0]?.due_on ?? null, null);
			assert.match(String(epf[0]?.title), /Confirm the employer’s EPF registration/);
		}).pipe(Effect.provide(live()))
	);
	it('a recorded date raises neither reminder', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* touch(t);
			yield* t.runDue();
			assert.equal((yield* keys(t, 'MY:EPF_EMPLOYER_REGISTRATION:')).length, 0);
			assert.equal((yield* keys(t, 'MY:SOCSO_EIS_EMPLOYER_REGISTRATION:')).length, 0);
		}).pipe(
			Effect.provide(
				live({ epf_registered_on: '2026-01-15', socso_registered_on: '2026-01-15' })
			)
		)
	);
	it('records both employer dates on the mutable entity', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t.as(t.admin).act('entity.update', [
				{
					target: ENTITY,
					set: {
						epf_registered_on: PlainDate('2026-02-01'),
						socso_registered_on: PlainDate('2026-02-02')
					}
				}
			]);
			const { entity } = yield* t.storedQuery({ entity: { limit: 1 } });
			assert.equal(String(entity.rows[0]?.epf_registered_on), '2026-02-01');
			assert.equal(String(entity.rows[0]?.socso_registered_on), '2026-02-02');
		}).pipe(Effect.provide(live()))
	);
});
