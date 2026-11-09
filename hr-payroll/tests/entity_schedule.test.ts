// An employer change filed ahead of its day is knowledge: nothing reads it until its day merges it into a sealed
// version, and the open version ends the day before.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { ENTITY, pack, workspace } from './kit.ts';

const seed = pack('MY', 'Asia/Kuala_Lumpur', {
	rate: { amount: 8000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
}, {}, [], [], '2026-01-15');

const versions = (t: Kit) =>
	t
		.storedQuery({
			entity_profile_version: {
				where: { entity_id: { eq: ENTITY } },
				fields: ['id', 'name', 'representative_name', 'effective_range', 'status'],
				limit: 10
			}
		})
		.pipe(Effect.map(({ entity_profile_version }) => entity_profile_version.rows));

const file = (t: Kit, field: string, value: string) =>
	t.as(t.member(['hr_controller'])).act('entity_change.create', [
		{
			entity_id: ENTITY,
			field_path: field,
			new_value: value,
			effective_from: PlainDate('2026-02-01'),
			notes: 'Scheduled employer update'
		}
	]);

describe('a scheduled employer change', () => {
	it.live('stays knowledge until its day, then merges into one sealed version', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t, 'name', 'Renamed Sdn. Bhd.');
			yield* file(t, 'representative_name', 'New Representative');
			yield* t.runDue();
			assert.equal((yield* versions(t)).length, 1);

			t.clock.set('2026-02-01T02:00:00.000Z');
			yield* t.runDue();
			const sealed = (yield* versions(t)).filter((row) => row.status === 'SEALED');
			assert.equal(sealed.length, 2);
			const [old, next] = sealed.toSorted((left, right) =>
				String(left.effective_range.from).localeCompare(String(right.effective_range.from))
			);
			assert.ok(old !== undefined && next !== undefined);
			assert.equal(String(old.effective_range.to), '2026-01-31');
			assert.equal(String(next.effective_range.from), '2026-02-01');
			assert.equal(next.effective_range.to, null);
			assert.equal(next.name, 'Renamed Sdn. Bhd.');
			assert.equal(next.representative_name, 'New Representative');

			const { entity_change } = yield* t.storedQuery({
				entity_change: { fields: ['applied_version_id'], limit: 10 }
			});
			assert.equal(entity_change.rows.length, 2);
			assert.ok(
				entity_change.rows.every((row) => String(row.applied_version_id) === String(next.id))
			);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-01-20T02:00:00.000Z' })))
	);

	it.live('refuses a field that is not an employer fact', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(
				t.as(t.member(['hr_controller'])).act('entity_change.create', [
					{
						entity_id: ENTITY,
						field_path: 'settings_code',
						new_value: 'SG',
						effective_from: PlainDate('2026-02-01')
					}
				])
			);
			assert.match(String(refused), /Only an employer fact can be scheduled/);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-01-20T02:00:00.000Z' })))
	);
});
