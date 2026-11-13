// What a correction of a paid period may not do: start a contract version mid-month, or hand an off-cycle run what
// another run already took.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { amendments, claimed, pay, raisedFrom, rostered } from '../amendment_kit.ts';
import { ENTITY, current, refusal, storedQuery, workspace } from '../kit.ts';

const MONTHS = ['2026-01', '2026-02'] as const;
const NOW = '2026-02-20T02:00:00.000Z';
const seed = rostered(MONTHS);

describe('a contract version sealed over a paid month', () => {
	// a successor version starts on the first of a month (employee_contract `startsMidMonth`); only seeded versions split
	// a month. The refusal is the behaviour, before and after the month is paid.
	it.live('from the 16th: refused, a version starts on the first, and nothing is amended', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, MONTHS[0]);
			assert.equal(
				(yield* refusal(raisedFrom(t, '2026-01-16', 3300))).key,
				'errors.employee_contract_mid_month'
			);
			assert.deepEqual(yield* amendments(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('what another run already took', () => {
	it.live('an off-cycle run naming a claim an on-cycle run paid: refused', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const claim = yield* claimed(t, 50, '2026-01-10');
			yield* pay(t, MONTHS[0]);
			const sealed = yield* current(t, 'claim_catalog_entry', claim);
			const { claim_catalog_entry } = yield* storedQuery(t, {
				claim_catalog_entry: { where: { id: { eq: claim } }, limit: 1 }
			});
			assert.notEqual(
				claim_catalog_entry.rows[0]?.payroll_run_id ?? null,
				null,
				'January sealed it'
			);
			const admin = yield* t.as(t.admin);
			assert.equal(
				(yield* refusal(
					admin.act({
						'payroll_run.create': [
							{ entity_id: ENTITY, period: MONTHS[1], kind: 'OFF_CYCLE', claim: [sealed] }
						]
					})
				)).key,
				'errors.payroll_run_already_attached'
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('an off-cycle run naming an amended period the next on-cycle run carried: refused', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, MONTHS[0]);
			yield* raisedFrom(t, '2026-01-01', 3300);
			const [open] = yield* amendments(t);
			assert.ok(open !== undefined && open.payroll_run_id === null, 'January is open');
			yield* pay(t, MONTHS[1]);
			const taken = yield* current(t, 'pay_amendment', open.id);
			assert.notEqual(
				(yield* amendments(t)).find((row) => row.id === open.id)?.payroll_run_id ?? null,
				null,
				'February took it'
			);
			const admin = yield* t.as(t.admin);
			assert.equal(
				(yield* refusal(
					admin.act({
						'payroll_run.create': [
							{ entity_id: ENTITY, period: MONTHS[1], kind: 'OFF_CYCLE', amendments: [taken] }
						]
					})
				)).key,
				'errors.payroll_run_already_attached'
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});
