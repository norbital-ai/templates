// HRD Corp registration is compulsory only for a scoped employer that declares NOT_REGISTERED and records when its
// liability began. Registered, deregistered, out-of-scope, unknown and undated classes raise no registration task.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { pack, uuid, workspace } from './kit.ts';

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
type Facts = {
	readonly hrd_scope?: string;
	readonly hrd_registration_class?: string;
	readonly hrd_registration_liability_on?: string;
};
const seedOf = (facts: Facts) => {
	const base = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], [], '2026-06-15');
	return {
		...base,
		entity_profile_version: (base.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: facts
		}))
	};
};
const live = (facts: Facts) => workspace({ seed: seedOf(facts), now: '2026-07-01T02:00:00.000Z' });
const tasks = (t: Kit) =>
	t
		.storedQuery({ obligation: { limit: 100 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.filter((row) =>
					String(row.occurrence_key).startsWith('MY:HRD_EMPLOYER_REGISTRATION:')
				)
			)
		);
const touch = (t: Kit) =>
	t
		.as(t.admin)
		.act('entity_profile_version.update', [{ target: PROFILE, set: { reason: 'Review' } }]);

const rule = (
	JSON.parse(
		readFileSync(
			new URL('../seed/public/jurisdiction/MY/version_8/registered_rule.json', import.meta.url),
			'utf8'
		)
	) as readonly { code: string; validate?: string; lookup?: Record<string, unknown> }[]
).find((row) => row.code === 'HRD_LIABILITY_EVENT_DATE_REQUIRED');
assert.ok(rule?.validate !== undefined);
const ruleHolds = (status: string, facts: Facts) =>
	evaluate(
		rule.validate!,
		'CALCULATION',
		{ lookup: rule.lookup ?? {}, entry: { status, entity_extension_data: facts } },
		rule.code
	);

describe('MY HRD registration', () => {
	it('raises only for a scoped NOT_REGISTERED employer with a liability date', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* touch(t);
			yield* t.runDue();
			const raised = yield* tasks(t);
			assert.equal(raised.length, 1);
			assert.equal(String(raised[0]?.due_on), '2026-03-31');
			assert.equal(String(raised[0]?.title), 'Register the employer with HRD Corp');
		}).pipe(
			Effect.provide(
				live({
					hrd_scope: 'PART_I',
					hrd_registration_class: 'NOT_REGISTERED',
					hrd_registration_liability_on: '2026-03-01'
				})
			)
		));
	const none: readonly (readonly [string, Facts])[] = [
		[
			'compulsory',
			{
				hrd_scope: 'PART_I',
				hrd_registration_class: 'COMPULSORY',
				hrd_registration_liability_on: '2026-03-01'
			}
		],
		['optional', { hrd_scope: 'PART_I', hrd_registration_class: 'OPTIONAL' }],
		['deregistered', { hrd_scope: 'PART_I', hrd_registration_class: 'DEREGISTERED' }],
		[
			'out of scope',
			{
				hrd_scope: 'OUT_OF_SCOPE',
				hrd_registration_class: 'NOT_REGISTERED',
				hrd_registration_liability_on: '2026-03-01'
			}
		],
		['unknown class', {}]
	];
	for (const [name, facts] of none)
		it.live(`${name} raises no registration task`, () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* touch(t);
				yield* t.runDue();
				assert.equal((yield* tasks(t)).length, 0);
			}).pipe(Effect.provide(live(facts)))
		);
	it('a sealed compulsory or not-registered version cannot omit the liability date', () =>
		Effect.gen(function* () {
			const cases: readonly Facts[] = [
				{ hrd_scope: 'PART_I', hrd_registration_class: 'COMPULSORY' },
				{ hrd_scope: 'PART_I', hrd_registration_class: 'NOT_REGISTERED' }
			];
			for (const facts of cases) {
				const refused = yield* Effect.flip(
					Effect.gen(function* () {
						const t = yield* TestWorkspace;
						yield* touch(t);
					}).pipe(Effect.provide(live(facts)))
				);
				assert.match(String(refused), /HRD_LIABILITY_EVENT_DATE_REQUIRED/);
			}
		}));
	it('the liability-date rule requires the date for compulsory and not-registered classes', () => {
		assert.equal(
			ruleHolds('SEALED', { hrd_scope: 'PART_I', hrd_registration_class: 'NOT_REGISTERED' }),
			false
		);
		assert.equal(
			ruleHolds('SEALED', { hrd_scope: 'PART_I', hrd_registration_class: 'COMPULSORY' }),
			false
		);
		assert.equal(
			ruleHolds('SEALED', {
				hrd_scope: 'PART_I',
				hrd_registration_class: 'NOT_REGISTERED',
				hrd_registration_liability_on: '2026-03-01'
			}),
			true
		);
		assert.equal(
			ruleHolds('SEALED', { hrd_scope: 'OUT_OF_SCOPE', hrd_registration_class: 'COMPULSORY' }),
			true
		);
		assert.equal(ruleHolds('DRAFT', { hrd_registration_class: 'COMPULSORY' }), true);
		assert.equal(ruleHolds('SEALED', { hrd_registration_class: 'OPTIONAL' }), true);
	});
});
