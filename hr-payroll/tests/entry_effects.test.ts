// A registered effect on an entry fires when HR raises the entry, as one on a contract or a payslip does.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Option, Schema } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, read, uuid, workspace } from './kit.ts';

const NOW = '2026-11-06T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const ON = PlainDate('2026-11-02');
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
		facts: {
			statutory: {
				NHI: { elections: { insured_amount: 20_000 } },
				INCOME_TAX: {
					elections: {
						tax_residency_reviews: {
							2026: { resident_from: '2025-01-01', valid_through: '2026-12-31' }
						}
					}
				}
			}
		}
	}
};
const seedOf = (code: string, zone: string): Seed => {
	const seed = pack(code, zone, terms, EMPLOYEE[code] ?? {}, [], [], '2026-11-06');
	const leave = Object.fromEntries((seed.leave_catalog ?? []).map((row) => [row.code, 100]));
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
const rowsOf = (seed: Seed, model: string) => {
	const version = seed.employee_contract?.[0]?.input_schema_version_id;
	return (seed[model] ?? []).filter((row) => row.settings_id === version);
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
		Effect.andThen(t.runDue()),
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
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = t.as(t.admin);
				const failed: string[] = [];
				for (const row of rowsOf(seed, 'workplace_case_catalog'))
					yield* attempt(
						t,
						row.code,
						admin.act('workplace_case_catalog_entry.create', [
							{
								catalog_id: idOf('workplace_case_catalog', String(row.id)),
								entity_id: ENTITY,
								kind: String(row.code),
								opened_on: ON,
								inputs: {}
							}
						]),
						failed
					);
				for (const row of rowsOf(seed, 'leave_catalog'))
					yield* attempt(
						t,
						row.code,
						admin.act('leave_catalog_entry.create', [
							{
								entity_id: ENTITY,
								employment_id: CONTRACT,
								catalog_id: idOf('leave_catalog', String(row.id)),
								days: [
									{ date: ON, part: 'AM' },
									{ date: ON, part: 'PM' }
								]
							}
						]),
						failed
					);
				for (const row of rowsOf(seed, 'adhoc_catalog'))
					yield* attempt(
						t,
						row.code,
						admin.act('adhoc_catalog_entry.create', [
							{
								entity_id: ENTITY,
								employment_id: CONTRACT,
								catalog_id: idOf('adhoc_catalog', String(row.id)),
								description: 'Sweep',
								quantity: 100,
								unit: 'MONEY',
								incurred_on: ON
							}
						]),
						failed
					);
				assert.deepEqual(failed, []);
				const declared = (seed.registered_effect ?? []).some(
					(row) =>
						row.settings_id === seed.employee_contract?.[0]?.input_schema_version_id &&
						row.source_collection === 'workplace_case_catalog_entry'
				);
				const raised = (yield* t.storedQuery({ obligation: { limit: 1000 } })).obligation.rows;
				if (declared) assert.ok(raised.length > 0, 'nothing raised');
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		});
});

describe('a month’s runs run every effect they declare', () => {
	for (const [code, zone] of COUNTRIES)
		it.live(code, () => {
			const seed = seedOf(code, zone);
			const refund = rowsOf(seed, 'adhoc_catalog').find((row) => row.code === 'STATUTORY_REFUND');
			assert.ok(refund !== undefined);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = t.as(t.admin);
				const failed: string[] = [];
				const settle = t.runDue().pipe(Effect.map((due) => failed.push(...failures(due))));
				const run = (kind: 'ON_CYCLE' | 'OFF_CYCLE', attaches: object) =>
					Effect.gen(function* () {
						yield* admin.act('payroll_run.create', [
							{ entity_id: ENTITY, period: '2026-11', kind, ...attaches }
						]);
						yield* settle;
						const rows = (yield* t.storedQuery({ payroll_run: { limit: 10 } })).payroll_run.rows;
						const open = rows.find((row) => row.kind === kind);
						assert.ok(open !== undefined);
						yield* admin.act('payroll_run.update', [{ target: open.id, set: { state: 'PAID' } }]);
						yield* settle;
					});
				yield* run('ON_CYCLE', {});
				yield* admin.act('adhoc_catalog_entry.create', [
					{
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: idOf('adhoc_catalog', String(refund.id)),
						description: 'Sweep',
						quantity: 100,
						unit: 'MONEY',
						incurred_on: ON
					}
				]);
				yield* settle;
				const entry = (yield* t.storedQuery({ adhoc_catalog_entry: { limit: 1 } }))
					.adhoc_catalog_entry.rows[0];
				assert.ok(entry !== undefined);
				yield* run('OFF_CYCLE', { attaches: { adhoc: [idOf('adhoc_catalog_entry', entry.id)] } });
				assert.deepEqual(failed, []);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		});
});

describe('a run effect', () => {
	it('looks for its own task first: raising one twice fails every effect after it', () => {
		const root = 'seed/public/jurisdiction';
		for (const country of readdirSync(root))
			for (const version of readdirSync(join(root, country)))
				for (const row of read(join(root, country, version, 'registered_effect.json')))
					if (row.source_collection === 'payroll_run' && row.target_collection === 'obligation')
						assert.match(
							`${String(row.condition)}${String(row.effects)}`,
							/reads(\.obligation|, 'obligation'|\.obligation)/,
							`${country} ${version} ${String(row.code)}`
						);
	});
});
