import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Effect } from 'effect';
import { nativeId } from './fixture_values.ts';
import { employer, world } from './jurisdiction_kit.ts';

it.effect(
	'a batch validates each profile standing against the scheme schema and refuses unknown elections',
	() => {
		const rows = employer([]);
		const settings = rows.get('jurisdiction_settings')?.[0];
		const scheme = rows.get('statutory_contribution_catalog')?.[0];
		assert.ok(settings && scheme);
		const schemeId = nativeId('statutory_contribution_catalog', scheme['id']);
		settings['employee_input_schema'] = {
			type: 'object',
			properties: {
				employment_statutory_facts: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							status: {
								type: 'object',
								properties: {
									elections: { type: 'object', properties: { voluntary: { type: 'boolean' } } }
								}
							}
						}
					}
				}
			}
		};
		const person = (name: string, elections: Readonly<Record<string, boolean>>) => ({
			name,
			facts: {
				employment_statutory_facts: [
					{
						statutory_contribution_id: schemeId,
						effective_range: { from: '2020-01-01', to: null },
						status: { kind: 'ENROLLED', elections }
					}
				]
			}
		});
		return world(rows).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				const accepted = yield* hr.act(
					'employment_profile.create',
					['First', 'Second', 'Third'].map((name) => person(name, { voluntary: true }))
				);
				assert.equal(accepted.kind, 'committed');
				const refused = yield* Effect.flip(
					hr.act('employment_profile.create', [
						person('Fourth', { voluntary: false }),
						person('Invalid', { unknown: true })
					])
				);
				assert.match(refused.message, /Unknown election 'unknown'/);
				assert.equal(
					(yield* hr.query({ employment_profile: {} })).employment_profile.rows.length,
					3
				);
			})
		);
	}
);
