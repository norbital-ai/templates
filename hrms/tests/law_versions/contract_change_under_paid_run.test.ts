// A contract change filed ahead whose day a paid run already covers: it never seals, and HR is told.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { pay, rostered } from '../amendment_kit.ts';
import { storedQuery, workspace } from '../kit.ts';

const MONTHS = ['2026-01', '2026-02'] as const;

describe('a contract change filed for a day a paid run covers', () => {
	// a change is filed only for the first of a month still ahead (contract_change `scheduled`), so a paid run can
	// cover its day only when that month was paid in advance
	it.live('stays filed when its day comes, and a task names the day', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const DAY = '2026-02-01';
			const versions = () =>
				storedQuery(t, { employee_contract: { limit: 100 } }).pipe(
					Effect.map(({ employee_contract }) => employee_contract.rows)
				);
			const [held] = yield* versions();
			assert.ok(held !== undefined);
			yield* (yield* t.as(t.member(['hr_controller']))).act({
				'contract_change.create': [
					{
						employee_id: held.employee_id,
						field_path: 'terms.rate.amount',
						old_value: 2800,
						new_value: 3000,
						effective_from: DAY
					}
				]
			});
			yield* pay(t, MONTHS[0]);
			yield* pay(t, MONTHS[1]);
			t.clock.set(`${DAY}T01:00:00.000Z`);
			yield* t.run_due();
			const { contract_change, obligation } = yield* storedQuery(t, {
				contract_change: { limit: 10 },
				obligation: { limit: 500 }
			});
			assert.deepEqual(
				contract_change.rows.map((row) => row.applied_version_id ?? null),
				[null],
				'the change stays filed'
			);
			assert.deepEqual(
				(yield* versions()).map((row) => [row.status, row.effective_range.to]),
				[['SEALED', null]],
				'nothing sealed'
			);
			assert.deepEqual(
				obligation.rows
					.map((row) => row.title)
					.filter((title) => title.startsWith('Contract change failed'))
					.map((title) => title.includes(`A paid run already covers ${DAY}`)),
				[true],
				obligation.rows.map((row) => row.title).join('\n')
			);
		}).pipe(Effect.provide(workspace({ seed: rostered(MONTHS), now: '2026-01-20T02:00:00.000Z' })))
	);
});
