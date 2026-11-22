// Shared helpers for sweeping every declared effect across every jurisdiction pack.
import type { Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Option, Schema } from 'effect';
import { periodKey, windowOf } from '../../src/lib/ledger/core.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import { lawAt, pack, packTerms, uuid } from '../kit.ts';

export const NOW = '2026-11-06T02:00:00.000Z';
export const EMPLOYMENT = idOf('employment', uuid(6));
export const ON = '2026-11-02';
export const COUNTRIES = [
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
export type Seed = ReturnType<typeof pack>;

/** What a country's rows refuse to run without. */
export const EMPLOYER: Record<string, Parameters<typeof pack>[3]> = {
	TH: { wcf_rate_percent: 0.2 },
	CN: { region: 'SH', hpf_rate_percent: 7, work_injury_rate_percent: 0.2, union_established: true }
};
export const EMPLOYEE: Record<string, Parameters<typeof pack>[3]> = {
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

export const seedOf = (code: string, zone: string): Seed => {
	const seed = pack(code, zone, packTerms(5000), EMPLOYEE[code] ?? {}, [], []);
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
		entity_change: (seed.entity_change ?? []).map((row) => ({
			...row,
			...(EMPLOYER[code] === undefined ? {} : { statutory_parameters: EMPLOYER[code] })
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
export const failures = (due: unknown) =>
	Option.match(Schema.decodeUnknownOption(Due)(due), {
		onNone: () => [],
		onSome: ({ failed }) => failed.map((run) => `${run.automation}: ${run.error}`)
	});

/** A rule may refuse a bare entry. What must never fail is an effect's own expression. */
export const attempt = (
	t: Kit,
	code: unknown,
	write: Effect.Effect<unknown, unknown>,
	failed: string[]
) =>
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
