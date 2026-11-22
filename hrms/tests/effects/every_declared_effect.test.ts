// Every pack: each effect a pack declares on a person's employment, a company or a run fires without failing
// its own expression, and every run effect that raises a task looks for it first. A mechanism check across all packs, not a check of any one law.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { CreateInput } from '@norbital-ai/bolt';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	PAY_GROUP,
	agreedTerms,
	current,
	lawAt,
	seedLaw,
	seededLaws,
	storedQuery,
	uuid,
	workspace
} from '../kit.ts';
import {
	COUNTRIES,
	EMPLOYEE,
	EMPLOYER,
	EMPLOYMENT,
	NOW,
	ON,
	attempt,
	failures,
	seedOf
} from './every_declared_effect_kit.ts';

const HIRE = idOf('employee_profile', uuid(300));

describe('a person’s employment raises what its effects declare', () => {
	for (const [code, zone] of COUNTRIES)
		it.live(code, () => {
			const base = seedOf(code, zone);
			const seed = {
				...base,
				employee_profile: [
					...(base.employee_profile ?? []),
					{ id: HIRE, name: 'Hire', date_of_birth: '1990-01-01', gender: 'MALE' }
				]
			};
			const declared = lawAt(code, ON).rows.registered_effect.some(
				(row) =>
					row.source_collection === 'employment' &&
					row.target_collection === 'obligation' &&
					row.condition == null &&
					Array.isArray(row.events) &&
					row.events.includes('create')
			);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				const failed: string[] = [];
				// a hire arrives whole: the stint with its first terms and what the law is told of the person
				yield* attempt(
					t,
					'hire',
					admin.act({
						'employment.create': [
							{
								employee_id: HIRE,
								entity_id: ENTITY,
								effective_range: { from: ON, to: null },
								terms: [
									{
										effective_from: ON,
										engagement: 'EMPLOYEE',
										pay_group_id: idOf('pay_group', PAY_GROUP),
										...agreedTerms(5000)
									}
								],
								parameters: [
									{
										effective_from: ON,
										parameters: {
											residency_status: 'CITIZEN',
											marital_status: 'SINGLE',
											...(EMPLOYEE[code] ?? {})
										}
									}
								]
							}
						]
					}),
					failed
				);
				// what was agreed, and what the law is told, change from the first of a month
				yield* attempt(
					t,
					'contract_terms',
					admin.act({
						'contract_terms.create': [
							{
								employment_id: EMPLOYMENT,
								effective_from: '2026-11-01',
								rate: { amount: 6000, unit: 'MONTHLY' }
							}
						]
					}),
					failed
				);
				yield* attempt(
					t,
					'statutory_parameters',
					admin.act({
						'statutory_parameters.create': [
							{
								employment_id: EMPLOYMENT,
								effective_from: '2026-11-01',
								parameters: { marital_status: 'MARRIED' }
							}
						]
					}),
					failed
				);
				const { employment } = yield* storedQuery(t, { employment: { limit: 10 } });
				const hired = employment.rows.find((row) => row.employee_id === HIRE);
				// the stint ends: an exit
				yield* attempt(
					t,
					'exit',
					admin.act({
						'employment.update': [
							{
								target: yield* current(t, 'employment', EMPLOYMENT),
								set: {
									effective_range: { from: '2025-01-01', to: '2026-11-30' },
									exit_ground: 'RESIGNATION',
									reason: 'Resignation'
								}
							}
						]
					}),
					failed
				);
				assert.deepEqual(failed, []);
				// a rule may refuse the bare hire; one that stands raised what its unconditional effects declare
				const raised = (yield* storedQuery(t, { obligation: { limit: 1000 } })).obligation.rows;
				if (declared && hired !== undefined)
					assert.ok(
						raised.some((row) => row.employment_id === hired.id),
						'nothing raised'
					);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		});
});

describe('a company raises what its effects declare', () => {
	for (const [code, zone] of COUNTRIES)
		it.live(code, () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				const failed: string[] = [];
				// a dated change: its effects read the company it leaves on its day
				yield* attempt(
					t,
					'entity_change',
					admin.act({
						'entity_change.create': [
							{ entity_id: ENTITY, effective_from: ON, statutory_parameters: EMPLOYER[code] ?? {} }
						]
					}),
					failed
				);
				// the company's particulars: their effects read the day of the write
				yield* attempt(
					t,
					'entity',
					admin.act({
						'entity.update': [
							{
								target: yield* current(t, 'entity', ENTITY),
								set: {
									name: 'Renamed',
									representative_name: 'Representative',
									registered_address: 'Address'
								}
							}
						]
					}),
					failed
				);
				assert.deepEqual(failed, []);
			}).pipe(Effect.provide(workspace({ seed: seedOf(code, zone), now: NOW })))
		);
});

describe('a month’s runs run every effect they declare', () => {
	for (const [code, zone] of COUNTRIES)
		it.live(code, () => {
			const seed = seedOf(code, zone);
			const refund = lawAt(code, ON).rows.adhoc_catalog.find(
				(row) => row.code === 'STATUTORY_REFUND'
			);
			assert.ok(refund !== undefined);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				const failed: string[] = [];
				const settle = t.run_due().pipe(Effect.map((due) => failed.push(...failures(due))));
				const run = (
					kind: 'ON_CYCLE' | 'OFF_CYCLE',
					links: Pick<CreateInput<'payroll_run'>, 'adhoc'>
				) =>
					Effect.gen(function* () {
						yield* admin.act({
							'payroll_run.create': [{ entity_id: ENTITY, period: '2026-11', kind, ...links }]
						});
						yield* settle;
						const rows = (yield* storedQuery(t, { payroll_run: { limit: 10 } })).payroll_run.rows;
						const open = rows.find((row) => row.kind === kind);
						assert.ok(open !== undefined);
						yield* admin.act({ 'payroll_run.update': [{ target: open, set: { state: 'PAID' } }] });
						yield* settle;
					});
				yield* run('ON_CYCLE', {});
				yield* admin.act({
					'adhoc_catalog_entry.create': [
						{
							entity_id: ENTITY,
							employment_id: EMPLOYMENT,
							catalog_code: String(refund.code),
							description: 'Sweep',
							quantity: '100',
							incurred_on: ON
						}
					]
				});
				yield* settle;
				const entry = (yield* storedQuery(t, { adhoc_catalog_entry: { limit: 1 } }))
					.adhoc_catalog_entry.rows[0];
				assert.ok(entry !== undefined);
				yield* run('OFF_CYCLE', { adhoc: [{ id: entry.id, revision: entry.revision }] });
				assert.deepEqual(failed, []);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		});
});

describe('a run effect on every pack', () => {
	it('looks for its own task first: raising one twice fails every effect after it', () => {
		// a law as it stands on each day it changed: every effect it ever held
		for (const country of seededLaws())
			for (const change of seedLaw(country).jurisdiction_change)
				for (const row of lawAt(country, String(change.effective_from)).rows.registered_effect)
					if (row.source_collection === 'payroll_run' && row.target_collection === 'obligation')
						assert.match(
							`${String(row.condition)}${String(row.effects)}`,
							/reads(\.obligation|, 'obligation'|\.obligation)/,
							`${country} ${String(change.effective_from)} ${String(row.code)}`
						);
	});
});
