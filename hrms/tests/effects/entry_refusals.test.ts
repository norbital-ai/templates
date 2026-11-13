// An entry missing what its form requires is refused, naming it: a case without its row's required inputs, a leave
// entry without a day, or one whose only day is deleted.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	leaveCreate,
	pack,
	refusal,
	storedQuery,
	uuid,
	wholeDays,
	workspace
} from '../kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const terms = {
	rate: { amount: 5000, unit: 'MONTHLY' },
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], []);
const CASE = 'WORKPLACE_ACCIDENT';
const LEAVE = 'NPL';
const live = workspace({ seed, now: '2026-06-20T02:00:00.000Z' });
const file = (t: Kit, inputs: JsonObject) =>
	t.as(t.admin).pipe(
		Effect.andThen((admin) =>
			admin.act({
				'workplace_case_catalog_entry.create': [
					{
						catalog_code: CASE,
						entity_id: ENTITY,
						employment_id: CONTRACT,
						kind: CASE,
						opened_on: '2026-06-10',
						inputs
					}
				]
			})
		)
	);

describe('a case', () => {
	it.live(
		'filed without what its form requires is refused naming it, and filed with it stands',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const refused = yield* refusal(file(t, {}));
				assert.equal(refused.key, 'errors.workplace_case_missing_inputs');
				assert.deepEqual(refused.values, { inputs: 'accident_type' });
				assert.equal((yield* file(t, { accident_type: 'INDUSTRIAL' })).kind, 'committed');
			}).pipe(Effect.provide(live))
	);
});

describe('a leave entry', () => {
	it.live('without a day is refused', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			const refused = yield* refusal(
				admin.act({
					'leave_catalog_entry.create': [
						{ entity_id: ENTITY, employment_id: CONTRACT, catalog_code: LEAVE }
					]
				})
			);
			assert.equal(refused.key, 'errors.leave_entry_needs_day');
		}).pipe(Effect.provide(live))
	);
	it.live('cannot have its only day deleted', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			yield* admin.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_code: LEAVE,
						days: wholeDays('2026-06-01')
					})
				]
			});
			const [entry] = (yield* storedQuery(t, { leave_catalog_entry: { limit: 1 } }))
				.leave_catalog_entry.rows;
			assert.ok(entry !== undefined);
			const { leave_catalog_entry_day } = yield* storedQuery(t, {
				leave_catalog_entry_day: {
					where: { leave_entry_id: { eq: entry.id } },
					fields: ['id', 'revision'],
					limit: 10
				}
			});
			const refused = yield* refusal(
				admin.act({
					'leave_catalog_entry.update': [
						{
							target: entry,
							set: { leave_catalog_entry_day: { delete: leave_catalog_entry_day.rows } }
						}
					]
				})
			);
			assert.equal(refused.key, 'errors.leave_entry_needs_day');
		}).pipe(Effect.provide(live))
	);
});
