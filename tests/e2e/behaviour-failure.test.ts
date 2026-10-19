/**
 * A record whose expression fails fails the tap run, visibly: the run is `failed` and its error names the behaviour
 * rule, the record's code and the evaluator's message — never a success that silently raised nothing. Here the MY
 * wage-payment duty's `when` reads a field no row carries and its `applies_when` is false, the pair CEL's commutative
 * `&&` would read as a quiet no. Skipped when the build carries no sample pack.
 */
import { existsSync } from 'node:fs';
import type { Pack } from '@norbital-ai/bolt/engine';
import { expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { company, recorded } from '../host_reads.ts';
import { nativeId } from '../fixture_values.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);
const MY = 'e7b313fc-e947-5b78-8066-97bea6644915';
const DUTY = 'WAGE_PAYMENT_DEADLINE';

const broken = (pack: Pack): Pack => ({
	...pack,
	rows: {
		...pack.rows,
		rule_set: (pack.rows['rule_set'] ?? []).map((row) =>
			row['code'] === DUTY
				? {
						...row,
						rules: {
							...Schema.decodeUnknownSync(Schema.JsonObject)(row['rules']),
							when: 'row.no_such_field.flag == true',
							applies_when: 'false'
						}
					}
				: row
		)
	}
});

it.live.skipIf(!sample)(
	'a duty whose expression fails fails the tap run with the rule code and the message',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t.runDue();
			const hr = t.as(t.member(['hr_manager']));
			const run = yield* hr.act('payroll_run.create', {
				company_id: nativeId('entity', MY),
				period: '2026-01',
				kind: 'REGULAR'
			});
			expect(run.kind, JSON.stringify(run)).toBe('committed');
			yield* t.runDue();
			const runs = yield* t.db.rows(
				Schema.Struct({ state: Schema.String, error: Schema.NullOr(Schema.String) }),
				{
					text: `SELECT state, error::text AS error FROM sys_run WHERE automation = 'behaviour_taps' AND state <> 'queued'`,
					params: []
				}
			);
			const failed = runs.filter((row) => row.state === 'failed');
			expect(failed.length, JSON.stringify(runs)).toBeGreaterThan(0);
			const failure = failed[0];
			if (failure === undefined) throw new Error('The behaviour tap did not record its failure');
			expect(String(failure.error)).toMatch(new RegExp(`raise-tasks.*${DUTY}.*no_such_field`, 's'));
		}).pipe(
			Effect.provide(
				recorded({
					now: '2026-02-10T04:00:00.000Z',
					pack: (pack) => broken(company(MY, 1)(pack))
				})
			),
			Effect.scoped
		),
	{ timeout: 600_000 }
);
