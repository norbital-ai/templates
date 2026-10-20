import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { fixtureId, nativeId } from './fixture_values.js';
import { lineage, world } from './jurisdiction_kit.js';

it.effect(
	'contract admission resolves older allowance identities before testing Japan minimum wage',
	Effect.fnUntraced(function* () {
		const law = lineage('JP');
		const rows = law.law();
		const company = nativeId('entity', fixtureId('allowance-context-company'));
		const person = nativeId('employment_profile', fixtureId('allowance-context-person'));
		const commuting = nativeId(
			'allowance_catalog',
			law.byCode('version_1', 'allowance_catalog', 'COMMUTING_ALLOWANCE').id
		);
		const foreignLaw = lineage('MY');
		const foreignAllowance = foreignLaw.byCode('version_1', 'allowance_catalog', 'MEAL_ALLOWANCE');
		rows.set('jurisdiction_settings', [
			...(rows.get('jurisdiction_settings') ?? []),
			foreignLaw.settingsOf('version_1')
		]);
		rows.set('allowance_catalog', [...(rows.get('allowance_catalog') ?? []), foreignAllowance]);
		rows.set('entity', [
			{
				id: company,
				name: 'Allowance test employer',
				settings_code: 'JP',
				region: 'TOKYO',
				pay_cutoff_day: 1,
				effective_range: { from: '2020-01-01', to: null },
				facts: { monthly_average_scheduled_hours: 160 }
			}
		]);
		rows.set('employment_profile', [
			{
				id: person,
				name: 'Allowance test employee',
				date_of_birth: '1990-01-01',
				nationality: 'JP',
				facts: {}
			}
		]);
		yield* world(rows).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.admin);
				const create = (
					salary: number,
					allowance: { readonly catalogue_id?: string; readonly code?: string } = {
						catalogue_id: commuting
					}
				) =>
					actor.act('employment_contract.create', {
						company_id: company,
						employee_id: person,
						employee_number: 'ALLOWANCE-1',
						effective_range: { from: PlainDate('2026-03-16'), to: null },
						facts: {
							contract_terms: [
								{
									effective_range: { from: PlainDate('2026-03-16'), to: null },
									base_salary: { value: salary, currency: 'JPY' },
									work_classification: 'ORDINARY',
									statutory_work_category: 'EMPLOYMENT_ONLY',
									employment_type: 'PERMANENT',
									residency_status: 'RESIDENT',
									allowances: [{ ...allowance, amount: { value: 40000, currency: 'JPY' } }]
								}
							]
						}
					});
				// 170,000 / 160 = 1,062.50, below Tokyo's 1,226. The excluded commuting amount cannot make it pass.
				const refused = yield* Effect.flip(create(170000));
				assert.match(refused.message, /below the regional minimum wage/i);
				for (const allowance of [
					{ code: 'COMMUTING_ALLOWANCE' },
					{ code: 'COMMUTING_ALLOWANCE', catalogue_id: commuting }
				])
					assert.match(
						(yield* Effect.flip(create(170000, allowance))).message,
						/below the regional minimum wage/i
					);
				for (const catalogue_id of [
					fixtureId('missing-allowance-catalogue'),
					String(foreignAllowance.id)
				])
					assert.match(
						(yield* Effect.flip(create(210000, { catalogue_id }))).message,
						/no actual allowance catalogue.*jurisdiction/i
					);
				assert.match(
					(yield* Effect.flip(create(210000, { catalogue_id: commuting, code: 'MEAL_ALLOWANCE' })))
						.message,
					/code must match its catalogue item/i
				);
				assert.equal((yield* actor.read('employment_contract', { all: true })).rows.length, 0);
				const accepted = yield* create(210000);
				assert.equal(accepted.kind, 'committed');
				const stored = (yield* actor.read('employment_contract', {
					select: { facts: true },
					all: true
				})).rows;
				assert.equal(stored.length, 1);
				assert.equal(
					stored[0]?.facts?.contract_terms?.[0]?.allowances?.[0]?.catalogue_id,
					commuting
				);
				assert.ok(stored[0]?.facts?.contract_terms?.[0]?.allowances?.[0]?.code == null);
			})
		);
	}),
	15_000
);
