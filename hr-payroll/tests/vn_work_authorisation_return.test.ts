// One authorisation produces one return act: the invalidation effect owns it when the record is complete; the contract
// end is only a fallback for a permit whose invalidation facts are missing. An exemption certificate needs its own
// art.33 ground and is never returned merely because the contract ended.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { pack, uuid, workspace } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const terms = (category: string) => ({
	rate: { amount: 30_000_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'ORDINARY',
	work_classification: 'ORDINARY',
	residency_status: 'RESIDENT',
	wage_payment_method: 'BANK',
	work_authorisation_category: category,
	allowances: {}
});
const seedOf = (category: string, facts: JsonObject) => {
	const base = pack(
		'VN',
		'Asia/Ho_Chi_Minh',
		terms(category),
		{
			annual_leave_service_review: { year: '2027', as_of: '2027-03-31' },
			...facts
		},
		[],
		[],
		'2027-01-15'
	);
	return {
		...base,
		entity_profile_version: (base.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: { region: 'I' }
		})),
		employee_contract: (base.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from: '2027-01-01', to: '2027-03-31' },
			signed_contract_period: { from: '2027-01-01', to: '2027-03-31' },
			final_pay_due_on: '2027-04-15'
		}))
	};
};
const returns = (t: Kit) =>
	Effect.gen(function* () {
		yield* t
			.as(t.admin)
			.act('employee_contract.update', [{ target: CONTRACT, set: { reason: 'Resignation' } }]);
		yield* t.runDue();
		const { obligation } = yield* t.storedQuery({ obligation: { limit: 300 } });
		return obligation.rows.filter((row) =>
			String(row.occurrence_key).startsWith('WORK_AUTHORISATION_RETURN:')
		);
	});
const live = (category: string, facts: JsonObject) =>
	workspace({ seed: seedOf(category, facts), now: '2027-04-01T02:00:00.000Z' });

describe('VN work-authorisation return', () => {
	it.live('a complete invalidation record raises exactly one return due in ten working days', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const rows = yield* returns(t);
			assert.equal(rows.length, 1);
			assert.equal(String(rows[0]?.due_on), '2027-04-14');
		}).pipe(
			Effect.provide(
				live('PERMIT', {
					pass_type: 'WORK_PERMIT',
					work_authorisation_invalidated_on: '2027-03-31',
					work_authorisation_invalidation_ground: 'CONTRACT_ENDED'
				})
			)
		)
	);
	it.live('a permit with no invalidation record falls back to the contract end', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const rows = yield* returns(t);
			assert.equal(rows.length, 1);
			assert.equal(String(rows[0]?.due_on), '2027-04-14');
		}).pipe(Effect.provide(live('PERMIT', { pass_type: 'WORK_PERMIT' })))
	);
	it.live('a permit with the date but no ground also falls back once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const rows = yield* returns(t);
			assert.equal(rows.length, 1);
			assert.equal(String(rows[0]?.due_on), '2027-04-14');
		}).pipe(
			Effect.provide(
				live('PERMIT', {
					pass_type: 'WORK_PERMIT',
					work_authorisation_invalidated_on: '2027-03-31'
				})
			)
		)
	);
	it.live('an exemption certificate is not returned merely because the contract ended', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.equal((yield* returns(t)).length, 0);
		}).pipe(Effect.provide(live('EXEMPTION_CERTIFICATE', { pass_type: 'WORK_PERMIT' })))
	);
	it.live('an exemption certificate with its own art.33 ground raises one return', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const rows = yield* returns(t);
			assert.equal(rows.length, 1);
		}).pipe(
			Effect.provide(
				live('EXEMPTION_CERTIFICATE', {
					work_authorisation_invalidated_on: '2027-03-31',
					work_authorisation_invalidation_ground: 'WORK_NOT_AS_CERTIFIED'
				})
			)
		)
	);
});
