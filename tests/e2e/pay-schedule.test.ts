/**
 * The entity's pay schedule is history, through a real entity write: a switch after the last paid day commits; one
 * on or before it, a changed starting frequency, or a switch to a frequency whose periods straddle months is refused
 * by the entity transform. Skipped when the build carries no sample pack.
 */
import { existsSync } from 'node:fs';
import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import type { Patch } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { company, recorded } from '../host_reads.ts';
import { nativeId } from '../fixture_values.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);
const MY = nativeId('entity', 'e7b313fc-e947-5b78-8066-97bea6644915');

it.live.skipIf(!sample)(
	'a pay frequency switch never rewrites a paid period',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t.runDue();
			const hr = t.as(t.admin);
			const reschedule = (set: Patch<'entity'>) => hr.act('entity.update', { target: MY, set });
			const rescheduled = (set: Patch<'entity'>) =>
				reschedule(set).pipe(
					Effect.match({
						onFailure: (failure) => `refused: ${failure.message}`,
						onSuccess: (outcome) => outcome.kind
					})
				);
			const january = yield* hr.act('payroll_run.create', {
				company_id: MY,
				period: '2026-01',
				kind: 'REGULAR'
			});
			expect(january.kind, JSON.stringify(january)).toBe('committed');
			// January is paid through the 31st: a switch inside it, or a new starting frequency, is refused
			expect(
				yield* rescheduled({
					pay_frequency_changes: [{ from: PlainDate('2026-01-16'), frequency: 'SEMI_MONTHLY' }]
				})
			).toMatch(/refused: .*2026-01-31/);
			expect(yield* rescheduled({ pay_frequency: 'SEMI_MONTHLY' })).toMatch(
				/refused: .*record a switch/
			);
			expect(
				yield* rescheduled({
					pay_frequency_changes: [{ from: PlainDate('2026-02-01'), frequency: 'WEEKLY' }]
				})
			).toMatch(/refused: .*straddle/);
			// a switch after it commits, and February's first half is then a period
			expect(
				yield* rescheduled({
					pay_frequency_changes: [{ from: PlainDate('2026-02-01'), frequency: 'SEMI_MONTHLY' }]
				})
			).toBe('committed');
			const half = yield* hr.act('payroll_run.create', {
				company_id: MY,
				period: '2026-02-1',
				kind: 'REGULAR'
			});
			expect(half.kind, JSON.stringify(half)).toBe('committed');
		}).pipe(
			Effect.provide(recorded({ now: '2026-02-10T04:00:00.000Z', pack: company(MY, 1) })),
			Effect.scoped
		),
	{ timeout: 600_000 }
);
