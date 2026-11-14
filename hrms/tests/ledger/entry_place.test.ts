// An entry names a row its company's law holds and a day its stint covers: anything else would post nothing, silently.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { ENTITY, leaveCreate, pack, uuid, wholeDays, workspace, packTerms } from '../kit.ts';

const NOW = '2026-10-06T02:00:00.000Z';
const EMPLOYMENT = idOf('employment', uuid(6));
// the fixture's stint starts on 1 January 2025
const seed = pack('ZZ', 'Asia/Kuala_Lumpur', packTerms(8000), {}, [], []);
const own = { entity_id: ENTITY, employment_id: EMPLOYMENT };
const refusal = (t: Kit, writes: Parameters<Effect.Success<ReturnType<Kit['as']>>['act']>[0]) =>
	Effect.flatMap(t.as(t.admin), (caller) => Effect.flip(caller.act(writes))).pipe(
		Effect.map((refused) => JSON.stringify(refused))
	);

describe('an entry', () => {
	it.live('names a row the law holds', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.match(
				yield* refusal(t, {
					'adhoc_catalog_entry.create': [
						{
							...own,
							catalog_code: 'NO_SUCH_ROW',
							description: 'x',
							quantity: '10',
							incurred_on: '2026-10-01'
						}
					]
				}),
				/NO_SUCH_ROW/
			);
			assert.match(
				yield* refusal(t, {
					'claim_catalog_entry.create': [
						{ ...own, catalog_code: 'NO_SUCH_ROW', quantity: '10', incurred_on: '2026-10-01' }
					]
				}),
				/NO_SUCH_ROW/
			);
			assert.match(
				yield* refusal(t, {
					'leave_catalog_entry.create': [
						leaveCreate({ ...own, catalog_code: 'NO_SUCH_ROW', days: wholeDays('2026-10-12') })
					]
				}),
				/NO_SUCH_ROW/
			);
			assert.match(
				yield* refusal(t, {
					'loan_catalog_entry.create': [
						{
							...own,
							catalog_code: 'NO_SUCH_ROW',
							quantity: '100',
							repayment_period: { from: '2026-10-01', to: '2026-12-31' }
						}
					]
				}),
				/NO_SUCH_ROW/
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('falls on a day its stint covers', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.match(
				yield* refusal(t, {
					'adhoc_catalog_entry.create': [
						{
							...own,
							catalog_code: 'BONUS',
							description: 'x',
							quantity: '10',
							incurred_on: '2024-06-01'
						}
					]
				}),
				/2024-06-01/
			);
			assert.match(
				yield* refusal(t, {
					'leave_catalog_entry.create': [
						leaveCreate({ ...own, catalog_code: 'NPL', days: wholeDays('2024-06-03') })
					]
				}),
				/2024-06-03/
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});
