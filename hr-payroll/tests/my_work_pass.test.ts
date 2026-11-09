// The work-pass renewal reminder starts at the Immigration Department's three-month window before the pass expires.
// The pass expiry is a native contract date, editable while sealed, and the reminder key carries it so a renewal raises
// a new reminder instead of being deduped against the old expiry.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { pack, uuid, workspace } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const terms = (residency: string) => ({
	rate: { amount: 5000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: residency,
	wage_payment_method: 'BANK',
	allowances: {}
});
const seedOf = (residency = 'FOREIGNER', expiry: string | null = '2027-03-31') => {
	const base = pack('MY', 'Asia/Kuala_Lumpur', terms(residency), {}, [], [], '2026-06-15');
	return {
		...base,
		employee_contract: (base.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from: '2026-01-01', to: null },
			...(expiry === null ? {} : { work_pass_valid_until: expiry })
		}))
	};
};
const live = (residency = 'FOREIGNER', expiry: string | null = '2027-03-31') =>
	workspace({ seed: seedOf(residency, expiry), now: '2026-07-01T02:00:00.000Z' });
const notices = (t: Kit) =>
	t
		.storedQuery({ obligation: { limit: 100 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.filter((row) =>
					String(row.occurrence_key).startsWith('MY:WORK_PASS_RENEWAL:')
				)
			)
		);
const touch = (t: Kit) =>
	t.as(t.admin).act('employee_contract.update', [{ target: CONTRACT, set: { reason: 'Review' } }]);

describe('MY work-pass renewal', () => {
	it('starts three months before the native expiry, keyed by expiry', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* touch(t);
			yield* t.runDue();
			const raised = yield* notices(t);
			assert.equal(raised.length, 1);
			assert.equal(
				String(raised[0]?.occurrence_key),
				'MY:WORK_PASS_RENEWAL:' + CONTRACT + ':2027-03-31'
			);
			assert.equal(String(raised[0]?.due_on), '2026-12-31');
			assert.match(String(raised[0]?.title), /pass expires 2027-03-31/);
		}).pipe(Effect.provide(live())));
	it('a renewed expiry raises a second reminder and keeps the first', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* touch(t);
			yield* t.runDue();
			yield* t
				.as(t.admin)
				.act('employee_contract.update', [
					{ target: CONTRACT, set: { work_pass_valid_until: PlainDate('2027-06-30') } }
				]);
			yield* t.runDue();
			const raised = yield* notices(t);
			assert.equal(raised.length, 2);
			const renewed = raised.find((row) => String(row.occurrence_key).endsWith(':2027-06-30'));
			assert.ok(renewed !== undefined);
			assert.equal(String(renewed.due_on), '2027-04-01');
		}).pipe(Effect.provide(live())));
	it('a citizen or a contract without an expiry raises none', () =>
		Effect.gen(function* () {
			const citizen = yield* TestWorkspace;
			yield* touch(citizen);
			yield* citizen.runDue();
			assert.equal((yield* notices(citizen)).length, 0);
		}).pipe(Effect.provide(live('CITIZEN'))));
	it('a missing expiry raises none', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* touch(t);
			yield* t.runDue();
			assert.equal((yield* notices(t)).length, 0);
		}).pipe(Effect.provide(live('FOREIGNER', null))));
});
