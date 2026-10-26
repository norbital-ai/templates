/**
 * Each automation the template declares, fired through the kit and judged by what it did: `behaviour_taps` applies a
 * run's pins and holds, `calendar_tick` writes the version's holidays once, `late_arrival_notice` reminds for a shift
 * nobody clocked into. `invitation_profile` is `e2e/invitation-profile.test.ts`; `statutory_drift` is
 * `statutory-research.test.ts`.
 */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt/test';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect, Schema } from 'effect';
import { fixtureId, nativeId } from './fixture_values.ts';
import { CATALOG, COMPANY, WORK, employer, employment, runOf, world } from './jurisdiction_kit.ts';

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

it.effect(
	'behaviour_taps pins what a run settled onto its payslip and holds what a validation held',
	() =>
		world(
			employer([
				{ key: 'a', salary: 3000 },
				// the version's HELD_PAY validation holds this person's pay
				{ key: 'b', salary: 3000, facts: { held: true } }
			])
		).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				yield* hr.act('adhoc_catalog_entry.create', {
					catalog_id: CATALOG.BONUS,
					employment_id: employment('a'),
					occurred_on: PlainDate('2026-03-10'),
					amount: Decimal.of('100')
				});
				yield* hr.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-03',
					kind: 'REGULAR'
				});
				const run = yield* runOf(hr, '2026-03');
				const [bonus] = (yield* hr.query('adhoc_catalog_entry', { all: true })).rows;
				assert.ok(bonus);
				// the run itself only records them
				assert.equal(bonus.payslip_id, null);
				assert.equal(run.slip('b').status, 'DRAFT');
				yield* t.runDue();
				assert.equal(
					(yield* hr.query('adhoc_catalog_entry', { id: bonus.id }))?.payslip_id,
					run.slip('a').id
				);
				assert.equal((yield* hr.query('payslip', { id: run.slip('b').id }))?.status, 'ON_HOLD');
				assert.equal((yield* hr.query('payslip', { id: run.slip('a').id }))?.status, 'DRAFT');
				const failed = yield* t.db.rows(Schema.Struct({ error: Schema.NullOr(Schema.Json) }), {
					text: "SELECT error FROM sys_run WHERE automation = 'behaviour_taps' AND state = 'failed'",
					params: []
				});
				assert.deepEqual(failed, []);
			})
		)
);

it.effect('calendar_tick writes the holidays the version lists, once', () =>
	world(employer([{ key: 'a', salary: 3000 }])).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const holidays = () =>
				t
					.as(t.admin)
					.query('holiday', { where: { company_id: { eq: COMPANY } }, all: true })
					.pipe(
						Effect.map((page) =>
							page.rows.map((row) => [row.date, row.name, row.kind, row.published_at])
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
	)
);

it.effect(
	'late_arrival_notice reminds for a rostered shift nobody clocked into past its grace',
	() => {
		const rows = employer([
			{ key: 'a', salary: 3000 },
			{ key: 'b', salary: 3000 }
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
		// the 09:00 shift plus fifteen minutes' grace has passed
		return world(rows, '2026-03-03T09:30:00.000Z').withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const started = yield* t.as(t.admin).start('late_arrival_notice', {});
				assert.equal(started.kind, 'committed');
				assert.deepEqual(yield* finished(t, started.kind === 'committed' ? started.output : null), {
					checked: 2,
					reminded: 1
				});
			})
		);
	}
);
