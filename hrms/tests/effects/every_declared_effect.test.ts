// Every pack: each effect a pack declares on an entry or a run fires without failing its own expression, and every run
// effect that raises a task looks for it first. A mechanism check across all packs, not a check of any one law.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { CreateInput } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Option, Schema } from 'effect';
import { periodKey, windowOf } from '../../src/lib/ledger/core.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	lawAt,
	pack,
	seedLaw,
	seededLaws,
	uuid,
	workspace,
	leaveCreate,
	storedQuery
} from '../kit.ts';

const NOW = '2026-11-06T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const ON = '2026-11-02';
const terms = {
	rate: { amount: 5000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const COUNTRIES = [
	['MY', 'Asia/Kuala_Lumpur'],
	['SG', 'Asia/Singapore'],
	['ID', 'Asia/Jakarta'],
	['PH', 'Asia/Manila'],
	['TH', 'Asia/Bangkok'],
	['VN', 'Asia/Ho_Chi_Minh'],
	['JP', 'Asia/Tokyo'],
	['CN', 'Asia/Shanghai'],
	['TW', 'Asia/Taipei']
] as const;
type Seed = ReturnType<typeof pack>;

/** What a country's rows refuse to run without. */
const EMPLOYER: Record<string, Parameters<typeof pack>[3]> = {
	TH: { wcf_rate_percent: 0.2 },
	CN: { region: 'SH', hpf_rate_percent: 7, work_injury_rate_percent: 0.2, union_established: true }
};
const EMPLOYEE: Record<string, Parameters<typeof pack>[3]> = {
	TW: {
		statutory: {
			NHI: { insured_amount: 20_000 },
			INCOME_TAX: {
				tax_residency_reviews: {
					2026: { resident_from: '2025-01-01', valid_through: '2026-12-31' }
				}
			}
		}
	}
};

const seedOf = (code: string, zone: string): Seed => {
	const seed = pack(code, zone, terms, EMPLOYEE[code] ?? {}, [], []);
	// every row has days in the window the entries below fall in
	const leave = Object.fromEntries(
		lawAt(code, ON).rows.leave_catalog.map((row) => [
			row.code,
			{
				[periodKey(code, windowOf(objectValue(row.lookup ?? {})), String(ON), '2025-01-01')]: {
					entitled: 100
				}
			}
		])
	);
	return {
		...seed,
		entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
			...row,
			...(EMPLOYER[code] === undefined ? {} : { entity_extension_data: EMPLOYER[code] })
		})),
		employee_balance: (seed.employee_balance ?? []).map((row) => ({
			...row,
			account: { leave: { ...leave } }
		}))
	};
};
/** What `runDue` says failed: a Bolt before 0.0.14 answers nothing. */
const Due = Schema.Struct({
	failed: Schema.Array(Schema.Struct({ automation: Schema.String, error: Schema.String }))
});
const failures = (due: unknown) =>
	Option.match(Schema.decodeUnknownOption(Due)(due), {
		onNone: () => [],
		onSome: ({ failed }) => failed.map((run) => `${run.automation}: ${run.error}`)
	});

/** A rule may refuse a bare entry. What must never fail is an effect's own expression. */
const attempt = (t: Kit, code: unknown, write: Effect.Effect<unknown, unknown>, failed: string[]) =>
	write.pipe(
		Effect.andThen(t.run_due()),
		Effect.map((due) => failed.push(...failures(due).map((run) => `${String(code)}: ${run}`))),
		Effect.catch((error) =>
			Effect.sync(() => {
				if (/\.effects|\.condition|Missing or unavailable|crossings/.test(String(error)))
					failed.push(`${String(code)}: ${String(error).slice(0, 200)}`);
			})
		)
	);

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
									employment_id: CONTRACT,
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
									employment_id: CONTRACT,
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
									employment_id: CONTRACT,
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
							employment_id: CONTRACT,
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
