/**
 * Each automation the template declares, fired through the kit and judged by what it did: `behaviour_taps` applies a
 * run's holds (its pins: `entries.test.ts`), `calendar_tick` writes the version's holidays once, `late_arrival_notice` reminds for a shift
 * nobody clocked into. `invitation_profile` is `e2e/invitation-profile.test.ts`; `statutory_drift` is
 * `statutory-research.test.ts`.
 */
import assert from 'node:assert/strict';
import { layer } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt/test';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { fixtureId, nativeId } from './fixture_values.ts';
import { COMPANY, WORK, employer, employment, runOf, world } from './jurisdiction_kit.ts';

const Started = Schema.Struct({ id: Schema.String });
const Run = Schema.Struct({
	state: Schema.String,
	output: Schema.NullOr(Schema.Json),
	error: Schema.NullOr(Schema.Json)
});
/** Run the started automation to its end; it succeeded, and this is what it answered. */
const finished = Effect.fnUntraced(function* (t: Kit, output: unknown) {
	const { id } = Schema.decodeUnknownSync(Started)(output);
	yield* t.runDue();
	const [run] = yield* t.db.rows(Run, {
		text: 'SELECT state, output, error FROM sys_run WHERE id = $1',
		params: [id]
	});
	assert.ok(run, `run ${id} is recorded`);
	assert.equal(run.state, 'succeeded', JSON.stringify(run.error));
	return run.output;
});

const rows = employer([
	{ key: 'a', salary: 3000 },
	// the version's HELD_PAY validation holds this person's pay
	{ key: 'b', salary: 3000, facts: { held: true } }
]);
rows.set(
	'entity',
	(rows.get('entity') ?? []).map((entity) => ({
		...entity,
		late_arrival_grace_minutes: 15,
		// the Production Manager team
		late_arrival_team: 'production_manager'
	}))
);
const day = (key: string, worked_intervals: unknown) => ({
	id: nativeId('roster_entry', fixtureId(`xx-late-${key}`)),
	employment_id: employment(key),
	work_date: PlainDate('2026-03-03'),
	shift_definition_id: WORK,
	worked_intervals
});
rows.set('roster_entry', [
	day('a', null),
	day('b', [
		{ start: Instant('2026-03-03T09:05:00.000Z'), end: Instant('2026-03-03T18:00:00.000Z') }
	])
]);

layer(world(rows).layer)('automations', (it) => {
	it.effect('behaviour_taps holds the payslip a validation held', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			// February: the late-arrival days in March stay unsettled
			yield* hr.act('payroll_run.create', [
				{ company_id: COMPANY, period: '2026-02', kind: 'REGULAR' }
			]);
			const run = yield* runOf(hr, '2026-02');
			// the run itself only records it
			assert.equal(run.slip('b').status, 'DRAFT');
			yield* t.runDue();
			const after = yield* hr.query({
				payslip: {
					where: { id: { in: [run.slip('a').id, run.slip('b').id] } },
					fields: ['status']
				}
			});
			const status = (id: string) => after.payslip.rows.find((row) => row.id === id)?.status;
			assert.equal(status(run.slip('b').id), 'ON_HOLD');
			assert.equal(status(run.slip('a').id), 'DRAFT');
		})
	);

	it.effect('calendar_tick writes the holidays the version lists, once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const holidays = () =>
				t
					.as(t.admin)
					.query({ holiday: { where: { company_id: { eq: COMPANY } } } })
					.pipe(
						Effect.map(({ holiday }) =>
							holiday.rows.map((row) => [row.date, row.name, row.kind, row.published_at])
						)
					);
			for (let tick = 0; tick < 2; tick++) {
				const started = yield* t.as(t.admin).start('calendar_tick', {});
				assert.equal(started.kind, 'committed');
				yield* finished(t, started.kind === 'committed' ? started.output : null);
				// written unpublished: publishing a holiday stays a person's decision
				assert.deepEqual(yield* holidays(), [
					['2026-03-25', 'Founders Day', 'PUBLIC_HOLIDAY', null]
				]);
			}
		})
	);

	it.effect(
		'late_arrival_notice reminds for a rostered shift nobody clocked into past its grace',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				// the 09:00 shift plus fifteen minutes' grace has passed
				t.clock.set('2026-03-03T09:30:00.000Z');
				const started = yield* t.as(t.admin).start('late_arrival_notice', {});
				assert.equal(started.kind, 'committed');
				assert.deepEqual(yield* finished(t, started.kind === 'committed' ? started.output : null), {
					checked: 2,
					reminded: 1
				});
			})
	);
});
