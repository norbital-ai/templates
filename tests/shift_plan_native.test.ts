/** Shift-code plans use the entity's definitions, and planned overtime remains a separate expectation. */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { fixtureId, nativeId } from './fixture_values.js';
import { lineage, world } from './jurisdiction_kit.js';

const LAW = lineage('SG');
const COMPANY = nativeId('entity', fixtureId('shift-plan-company'));
const OTHER = nativeId('entity', fixtureId('shift-plan-other-company'));
const PERSON = nativeId('employment_profile', fixtureId('shift-plan-person'));
const EMPLOYMENT = nativeId('employment_contract', fixtureId('shift-plan-employment'));
const WORK = nativeId('shift_definition', fixtureId('shift-plan-work'));
const FOREIGN = nativeId('shift_definition', fixtureId('shift-plan-foreign'));
const EXPIRED = nativeId('shift_definition', fixtureId('shift-plan-expired'));

it.live(
	'normal hooks reject foreign or expired shift codes and overtime without a shift, preserving rows',
	() => {
		const seed = LAW.law();
		seed.set(
			'entity',
			[COMPANY, OTHER].map((id) => ({
				id,
				name: 'Synthetic shift-plan entity',
				settings_code: 'SG',
				pay_frequency: 'MONTHLY',
				pay_cutoff_day: 1,
				effective_range: { from: '2020-01-01', to: null },
				facts: {}
			}))
		);
		seed.set('employment_profile', [
			{ id: PERSON, name: 'Synthetic shift-plan employee', facts: {} }
		]);
		seed.set('employment_contract', [
			{
				id: EMPLOYMENT,
				employee_id: PERSON,
				company_id: COMPANY,
				employee_number: 'PLAN-1',
				contract_number: 1,
				effective_range: { from: '2020-01-01', to: null },
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2020-01-01', to: null },
							base_salary: { value: 4000, currency: 'SGD' },
							residency_status: 'CITIZEN',
							work_classification: 'EA_COVERED',
							statutory_work_category: 'NON_MANUAL',
							employment_type: 'PERMANENT',
							allowances: []
						}
					]
				}
			}
		]);
		seed.set('shift_definition', [
			{
				id: WORK,
				company_id: COMPANY,
				code: 'DAY',
				variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 }
			},
			{ id: FOREIGN, company_id: OTHER, code: 'FOREIGN', variant: { day_type: 'REST' } },
			{
				id: EXPIRED,
				company_id: COMPANY,
				code: 'OLD',
				variant: { day_type: 'REST' },
				effective_range: { from: '2020-01-01', to: '2025-12-31' }
			}
		]);
		seed.set('shift_pattern', []);
		seed.set('roster_entry', []);
		return world(seed).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.admin);
				const plan = {
					employment_id: EMPLOYMENT,
					work_date: PlainDate('2026-03-02'),
					planned_overtime_hours: Decimal.of('3')
				};
				const orphan = yield* Effect.flip(actor.act('roster_entry.create', plan));
				assert.match(orphan.message, /shift code/);
				const foreign = yield* Effect.flip(
					actor.act('roster_entry.create', { ...plan, shift_definition_id: FOREIGN })
				);
				assert.match(foreign.message, /employee’s entity/);
				const expired = yield* Effect.flip(
					actor.act('roster_entry.create', { ...plan, shift_definition_id: EXPIRED })
				);
				assert.match(expired.message, /in effect/);
				assert.equal((yield* t.storedRead('roster_entry', { all: true })).rows.length, 0);
				assert.equal(
					(yield* actor.act('roster_entry.create', { ...plan, shift_definition_id: WORK })).kind,
					'committed'
				);
				const pattern = {
					company_id: COMPANY,
					code: 'CYCLE',
					pattern: { days: [{ roster_code_id: String(WORK) }, {}] }
				};
				assert.equal((yield* actor.act('shift_pattern.create', pattern)).kind, 'committed');
				const before = (yield* t.storedRead('shift_pattern', { all: true })).rows;
				const invalid = yield* Effect.flip(
					actor.act('shift_pattern.create', {
						...pattern,
						code: 'FOREIGN-CYCLE',
						pattern: { days: [{ roster_code_id: String(FOREIGN) }] }
					})
				);
				assert.match(invalid.message, /belonging to its entity/);
				assert.deepEqual((yield* t.storedRead('shift_pattern', { all: true })).rows, before);
			})
		);
	},
	{ timeout: 15_000 }
);
