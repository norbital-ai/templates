// A shift code scheduled by a contract may not run longer than that contract's ordinary day. These figures are
// synthetic: they prove the contract write boundary, not a seeded legal value.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, storedQuery, uuid, workspace } from './kit.ts';

const LONG_SHIFT = idOf('shift_definition', uuid(20));
const PATTERN = idOf('shift_pattern', uuid(21));
const terms = {
	rate: { amount: 60_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_FIELD',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {},
	shift_pattern_id: PATTERN
};
const base = pack('PH', 'Asia/Manila', terms, {}, [], [], '2026-11-15');
const map = {
	MONDAY: LONG_SHIFT,
	TUESDAY: LONG_SHIFT,
	WEDNESDAY: LONG_SHIFT,
	THURSDAY: LONG_SHIFT,
	FRIDAY: LONG_SHIFT,
	SATURDAY: LONG_SHIFT,
	SUNDAY: LONG_SHIFT
};
const seed = {
	...base,
	shift_definition: [
		{
			id: LONG_SHIFT,
			entity_id: ENTITY,
			code: 'LONG',
			name: 'Long day',
			effective_range: { from: '2025-01-01', to: null },
			variant: {
				day_type: 'WORK',
				start_time: '08:00',
				end_time: '18:00',
				ends_next_day: false,
				breaks: []
			}
		}
	],
	shift_pattern: [
		{
			id: PATTERN,
			entity_id: ENTITY,
			code: 'LONG-WEEK',
			name: 'Long week',
			effective_range: { from: '2025-01-01', to: null },
			pattern: { week_start: 'MONDAY', days: map }
		}
	]
};

describe('a contract shift pattern', () => {
	it.live('refuses a shift longer than its normal day', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const [held] = (yield* storedQuery(t, { employee_contract: { limit: 1 } })).employee_contract
				.rows;
			assert.ok(held !== undefined);
			const admin = yield* t.as(t.admin);
			const refused = yield* Effect.flip(
				admin.act({
					'employee_contract.update': [
						{
							target: held,
							set: { terms: { ...held.terms, job_title: 'Changed' } }
						}
					]
				})
			);
			assert.ok(refused._tag === 'ActRefused');
			assert.equal(refused.key, 'errors.employee_contract_shift_overlong');
			assert.equal(refused.values?.hours, 8);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-11-20T02:00:00.000Z' })))
	);
});
