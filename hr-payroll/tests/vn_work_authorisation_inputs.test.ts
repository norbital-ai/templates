// The onboarding route prompt ends once the route is recorded. The extension-count prompt is a renewal fact: it waits
// for the first pay date inside the 90-day window before the contract end, not for onboarding.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { jsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
type SeedOptions = {
	readonly category?: string | null;
	readonly count?: number | null;
	readonly status?: 'DRAFT' | 'SEALED';
};
const terms = (category: string | null) => ({
	rate: { amount: 30_000_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'ORDINARY',
	work_classification: 'ORDINARY',
	residency_status: 'RESIDENT',
	wage_payment_method: 'BANK',
	...(category === null ? {} : { work_authorisation_category: category }),
	allowances: {}
});
// Decree 393 commences 2026-12-05, past the seeded law (to 2026-11-30): here the last sealed version stays in force.
const lasting = (seed: ReturnType<typeof pack>): ReturnType<typeof pack> => {
	const law = seed.entity_profile_version?.[0]?.input_schema_version_id;
	return {
		...seed,
		jurisdiction_settings: (seed.jurisdiction_settings ?? []).map((row) =>
			row.id === law
				? { ...row, effective_range: { ...jsonObject(row.effective_range), to: null } }
				: row
		)
	};
};
const seedOf = ({ category = null, count = null, status = 'SEALED' }: SeedOptions = {}) => {
	const base = lasting(
		pack(
			'VN',
			'Asia/Ho_Chi_Minh',
			terms(category),
			{
				pass_type: 'WORK_PERMIT',
				...(count === null ? {} : { work_authorisation_extension_count: count })
			},
			[],
			[],
			'2026-11-15'
		)
	);
	return {
		...base,
		entity_profile_version: (base.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: { region: 'I' }
		})),
		employee_contract: (base.employee_contract ?? []).map((row) => ({
			...row,
			status,
			effective_range: { from: '2027-01-05', to: '2027-12-31' },
			signed_contract_period: { from: '2027-01-05', to: '2027-12-31' }
		}))
	};
};
const live = (options: SeedOptions = {}) =>
	workspace({ seed: seedOf(options), now: '2027-01-20T02:00:00.000Z' });
const keys = (t: Kit, prefix: string) =>
	t
		.storedQuery({ obligation: { limit: 400 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.filter((row) => String(row.occurrence_key).startsWith(prefix))
			)
		);
const seal = (t: Kit) =>
	t.as(t.admin).act('employee_contract.update', [{ target: CONTRACT, set: { status: 'SEALED' } }]);
const run = (t: Kit, period: string) =>
	t.as(t.admin).act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }]);

describe('VN work-authorisation inputs', () => {
	it.live('the route prompt fires only while the route is missing', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t);
			yield* t.runDue();
			const missing = yield* keys(t, 'FOREIGN_WORKER_NEW_DECREE_REVIEW:');
			assert.equal(missing.length, 1);
			assert.equal(String(missing[0]?.due_on), '2027-01-05');
			assert.equal(String(missing[0]?.title), 'Record the actual work authorisation route');
		}).pipe(Effect.provide(live({ status: 'DRAFT' })))
	);
	it.live('a recorded route raises no onboarding prompt', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t);
			yield* t.runDue();
			assert.equal((yield* keys(t, 'FOREIGN_WORKER_NEW_DECREE_REVIEW:')).length, 0);
		}).pipe(Effect.provide(live({ category: 'PERMIT', status: 'DRAFT' })))
	);
	it.live('the count prompt waits for the first pay date in the 90-day window', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2027-09');
			yield* t.runDue();
			assert.equal((yield* keys(t, 'WORK_AUTHORISATION_EXPIRY_INPUTS_393:')).length, 0);
			yield* run(t, '2027-10');
			yield* t.runDue();
			const prompt = yield* keys(t, 'WORK_AUTHORISATION_EXPIRY_INPUTS_393:');
			assert.equal(prompt.length, 1);
			assert.equal(String(prompt[0]?.title), 'Record the extension count used');
			assert.equal(String(prompt[0]?.due_on), '2027-10-25');
		}).pipe(Effect.provide(live({ category: 'PERMIT' })))
	);
	it.live('a recorded count selects the extension application and ends the prompt', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2027-11');
			yield* t.runDue();
			assert.equal((yield* keys(t, 'WORK_AUTHORISATION_EXTENSION_393:')).length, 1);
			assert.equal((yield* keys(t, 'WORK_AUTHORISATION_EXPIRY_INPUTS_393:')).length, 0);
		}).pipe(Effect.provide(live({ category: 'PERMIT', count: 0 })))
	);
});
