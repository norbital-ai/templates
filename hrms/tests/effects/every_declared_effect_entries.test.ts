// Every pack: each effect a pack declares on a catalogue entry fires without failing its own expression.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { ENTITY, lawAt, leaveCreate, storedQuery, workspace } from '../kit.ts';
import { COUNTRIES, EMPLOYMENT, NOW, ON, attempt, seedOf } from './every_declared_effect_kit.ts';

describe('an entry raises what its effects declare', () => {
	for (const [code, zone] of COUNTRIES)
		it.live(code, () => {
			const seed = seedOf(code, zone);
			const law = lawAt(code, ON);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				const failed: string[] = [];
				for (const row of law.rows.workplace_case_catalog)
					yield* attempt(
						t,
						row.code,
						admin.act({
							'workplace_case_catalog_entry.create': [
								{
									catalog_code: String(row.code),
									entity_id: ENTITY,
									employment_id: EMPLOYMENT,
									kind: String(row.code),
									opened_on: ON,
									inputs: {}
								}
							]
						}),
						failed
					);
				for (const row of law.rows.leave_catalog)
					yield* attempt(
						t,
						row.code,
						admin.act({
							'leave_catalog_entry.create': [
								leaveCreate({
									entity_id: ENTITY,
									employment_id: EMPLOYMENT,
									catalog_code: String(row.code),
									days: [
										{ date: ON, part: 'AM' },
										{ date: ON, part: 'PM' }
									]
								})
							]
						}),
						failed
					);
				for (const row of law.rows.adhoc_catalog)
					yield* attempt(
						t,
						row.code,
						admin.act({
							'adhoc_catalog_entry.create': [
								{
									entity_id: ENTITY,
									employment_id: EMPLOYMENT,
									catalog_code: String(row.code),
									description: 'Sweep',
									quantity: '100',
									incurred_on: ON
								}
							]
						}),
						failed
					);
				assert.deepEqual(failed, []);
				const declared = law.rows.registered_effect.some(
					(row) => row.source_collection === 'workplace_case_catalog_entry'
				);
				const raised = (yield* storedQuery(t, { obligation: { limit: 1000 } })).obligation.rows;
				if (declared) assert.ok(raised.length > 0, 'nothing raised');
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		});
});
