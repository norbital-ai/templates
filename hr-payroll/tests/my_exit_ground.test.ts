// The exit ground is a native contract fact: it decides Form PK/s.60N duties, the retirement review and termination
// benefit. Resignation, retirement and misconduct after due inquiry are outside the benefit; unilateral termination is not.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { settingsConstants } from '../src/lib/payroll_engine/contracts.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const TERMS = {
	rate: { amount: 3000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const base = pack('MY', 'Asia/Kuala_Lumpur', TERMS, {}, [], [], '2026-06-15');
const seedOf = (dateOfBirth = '1990-01-01') => ({
	...base,
	employee_contract: (base.employee_contract ?? []).map((row) => ({
		...row,
		effective_range: { from: '2023-06-30', to: null },
		service_started_on: '2023-06-30',
		payroll: { date_of_birth: dateOfBirth, gender: 'MALE', marital_status: 'SINGLE' }
	}))
});
const live = (dateOfBirth = '1990-01-01') =>
	workspace({ seed: seedOf(dateOfBirth), now: '2026-07-01T02:00:00.000Z' });
type ExitGround =
	| 'RETRENCHMENT'
	| 'RETIREMENT'
	| 'RESIGNATION'
	| 'DISMISSAL'
	| 'MISCONDUCT_DISMISSAL'
	| 'END_OF_CONTRACT'
	| 'MUTUAL'
	| 'DEATH'
	| 'UNILATERAL'
	| 'BREACH_BY_EMPLOYER';
const keys = (t: Kit, prefix: string) =>
	t
		.storedQuery({ obligation: { limit: 100 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.filter((row) => String(row.occurrence_key).startsWith(prefix))
			)
		);
/** End the contract on 30 June 2026 with its ground: the write raises the exit its duties listen to. */
const setGround = (t: Kit, ground: ExitGround) =>
	t.as(t.admin).act('employee_contract.update', [
		{
			target: CONTRACT,
			set: {
				exit_ground: ground,
				effective_range: { from: PlainDate('2023-06-30'), to: PlainDate('2026-06-30') }
			}
		}
	]);

const settings = JSON.parse(
	readFileSync(
		new URL('../seed/public/jurisdiction/MY/version_5/jurisdiction_settings.json', import.meta.url),
		'utf8'
	)
) as readonly import('../src/lib/payroll_engine/contracts.ts').JsonObject[];
const benefit = (
	JSON.parse(
		readFileSync(
			new URL('../seed/public/jurisdiction/MY/version_5/adhoc_catalog.json', import.meta.url),
			'utf8'
		)
	) as readonly {
		code: string;
		lookup?: Record<string, unknown>;
		eligibility?: string;
		conversion?: string;
	}[]
).find((row) => row.code === 'TERMINATION_BENEFIT');
assert.ok(benefit?.eligibility !== undefined && benefit.conversion !== undefined);
const lookup = { ...settingsConstants(settings[0]!), ...benefit.lookup };
const eligibility = (ground: string, legacyMisconduct = false) =>
	evaluate(
		benefit.eligibility!,
		'CALCULATION',
		{
			lookup,
			entry: { quantity: 1, incurred_on: '2026-06-30' },
			subject: {
				employment: {
					effective_range: { from: '2023-06-30', to: '2026-06-30' },
					service_started_on: '2023-06-30',
					terms: TERMS,
					exit_ground: ground,
					employee_extension_data: legacyMisconduct ? { misconduct_dismissal: true } : {}
				}
			}
		},
		benefit.code!
	);
const amount = () =>
	Number(
		(
			evaluate(
				benefit.conversion!,
				'CALCULATION',
				{
					lookup,
					entry: { quantity: 1, incurred_on: '2026-06-30' },
					subject: {
						employment: {
							effective_range: { from: '2023-06-30', to: '2026-06-30' },
							service_started_on: '2023-06-30',
							terms: TERMS,
							exit_ground: 'RETRENCHMENT'
						}
					}
				},
				benefit.code!
			) as number
		).toFixed(2)
	);

describe('MY exit ground', () => {
	it('termination benefit follows the exit ground', () => {
		assert.equal(eligibility('RETRENCHMENT'), true);
		assert.equal(eligibility('UNILATERAL'), true);
		assert.equal(eligibility('RESIGNATION'), false);
		assert.equal(eligibility('RETIREMENT'), false);
		assert.equal(eligibility('MISCONDUCT_DISMISSAL'), false);
		assert.equal(eligibility('DISMISSAL', true), false);
		assert.equal(amount(), 4438.36);
	});
	it('a native retrenchment raises Form PK and the s.60N check once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* setGround(t, 'RETRENCHMENT');
			yield* t.runDue();
			assert.equal((yield* keys(t, 'MY:RETRENCHMENT_NOTIFICATION:')).length, 1);
			assert.equal((yield* keys(t, 'MY:RETRENCHMENT_FOREIGN_FIRST:')).length, 1);
			yield* setGround(t, 'RETRENCHMENT');
			yield* t.runDue();
			assert.equal((yield* keys(t, 'MY:RETRENCHMENT_NOTIFICATION:')).length, 1);
			assert.equal((yield* keys(t, 'MY:RETRENCHMENT_FOREIGN_FIRST:')).length, 1);
		}).pipe(Effect.provide(live())));
	it('a resignation raises no retrenchment duty', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* setGround(t, 'RESIGNATION');
			yield* t.runDue();
			assert.equal((yield* keys(t, 'MY:RETRENCHMENT_NOTIFICATION:')).length, 0);
			assert.equal((yield* keys(t, 'MY:RETRENCHMENT_FOREIGN_FIRST:')).length, 0);
		}).pipe(Effect.provide(live())));
	it('retirement below 60 raises the review; at 60 it does not', () =>
		Effect.gen(function* () {
			const young = yield* TestWorkspace;
			yield* setGround(young, 'RETIREMENT');
			yield* young.runDue();
			assert.equal((yield* keys(young, 'MY:RETIREMENT_AGE_REVIEW:')).length, 1);
		}).pipe(Effect.provide(live('1970-06-30'))));
	it('a retirement at 60 raises no review', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* setGround(t, 'RETIREMENT');
			yield* t.runDue();
			assert.equal((yield* keys(t, 'MY:RETIREMENT_AGE_REVIEW:')).length, 0);
		}).pipe(Effect.provide(live('1966-06-30'))));
});
