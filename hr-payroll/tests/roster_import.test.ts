// The roster workbook writes as one `roster_entry.import`: a dry run through the same write first, whose refusal names
// every row a registered rule refuses (Malaysia's EA s.60A(7) daily total) and writes nothing; a clean file writes
// every row. Real sealed law, synthetic people; many people in one act stay inside the write callback's read budget.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	planRosterUpload,
	type RosterKnown,
	type RosterPlan
} from '../src/lib/payroll_engine/roster_workbook.ts';
import { ENTITY, WORK, pack, uuid, workspace, storedQuery } from './kit.ts';

const seed = pack('MY', 'Asia/Kuala_Lumpur', {}, {}, [], [], '2026-02-15');
const first = seed.employee_contract?.[0] ?? {};
const others = Array.from({ length: 12 }, (_, index) => index + 1);
const seeded = {
	...seed,
	employee_profile: [
		...(seed.employee_profile ?? []),
		...others.map((index) => ({ id: uuid(300 + index), name: `Worker ${index + 1}` }))
	],
	employee_contract: [
		...(seed.employee_contract ?? []),
		...others.map((index) => ({
			...first,
			id: uuid(400 + index),
			employee_id: uuid(300 + index),
			employee_number: `W${index + 1}`
		}))
	]
};
const known: RosterKnown = {
	entity_name: 'Entity',
	zone: 'Asia/Kuala_Lumpur',
	employees: [uuid(6), ...others.map((index) => uuid(400 + index))].map((id, index) => ({
		id: idOf('employee_contract', id),
		number: `W${index + 1}`,
		entity_id: ENTITY,
		from: '2025-01-01',
		to: null
	})),
	shifts: [
		{
			id: idOf('shift_definition', WORK),
			entity_id: ENTITY,
			code: 'DAY',
			from: '2025-01-01',
			to: null,
			start_time: '08:00',
			end_time: '16:00',
			ends_next_day: false
		}
	],
	entries: []
};
const DAYS = ['2026-02-02', '2026-02-03'];
/** Every person works both days with planned overtime from 16:00; `long` days run it to 21:00, five hours. */
const workbook = (...long: readonly string[]): RosterPlan =>
	planRosterUpload(
		new Map([
			[
				'Plan',
				[
					['employee_number', 'work_date', 'shift_code', 'planned_ot_start', 'planned_ot_end'],
					...known.employees.flatMap(({ number }) =>
						DAYS.map((day) => [
							number,
							day,
							'DAY',
							'16:00',
							long.includes(`${number} ${day}`) ? '21:00' : '17:00'
						])
					)
				]
			]
		]),
		known
	);
const importing = (t: Kit, plan: RosterPlan, dryRun: boolean) =>
	t.as(t.admin).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'roster_entry.import': {
					rows: plan.rows,
					on_conflict: 'update',
					...(dryRun ? { dry_run: true } : {})
				}
			})
		)
	);
const stored = (t: Kit) =>
	Effect.map(
		storedQuery(t, { roster_entry: { limit: 10000 } }),
		(answer) => answer.roster_entry.rows.length
	);

describe('roster workbook import', () => {
	it.live('a refused row writes nothing, and the dry run names every refused row', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const plan = workbook('W3 2026-02-03', 'W8 2026-02-02');
			const preview = yield* Effect.flip(importing(t, plan, true));
			assert.equal(preview._tag, 'ActRefused');
			assert.deepEqual(preview.message.split('\n').toSorted(), [
				'W3 2026-02-03: ROSTER_DAILY_TOTAL: the row is refused by its registered rule.',
				'W8 2026-02-02: ROSTER_DAILY_TOTAL: the row is refused by its registered rule.'
			]);
			assert.equal(yield* stored(t), 0);
			// the write itself is all or nothing
			yield* Effect.flip(importing(t, plan, false));
			assert.equal(yield* stored(t), 0);
		}).pipe(Effect.provide(workspace({ seed: seeded, now: '2026-02-20T02:00:00.000Z' })))
	);

	it.live('a clean workbook writes every row in one act; importing it again updates them', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const plan = workbook();
			const all = known.employees.length * DAYS.length;
			assert.equal(plan.rows.length, all);
			const preview = yield* importing(t, plan, true);
			assert.equal(preview.kind, 'committed');
			assert.equal(yield* stored(t), 0);
			const written = yield* importing(t, plan, false);
			assert.ok(written.kind === 'committed');
			assert.ok(
				written.output['roster_entry.import']?.rows.every((row) => row.action === 'created')
			);
			assert.equal(yield* stored(t), all);
			const again = yield* importing(t, plan, false);
			assert.ok(again.kind === 'committed');
			assert.ok(again.output['roster_entry.import']?.rows.every((row) => row.action === 'updated'));
			assert.equal(yield* stored(t), all);
		}).pipe(Effect.provide(workspace({ seed: seeded, now: '2026-02-20T02:00:00.000Z' })))
	);

	it.live('a streak that started before the file still warns', () => {
		const before = ['2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'];
		const days = ['2026-03-03', '2026-03-04', '2026-03-05'];
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const plan = planRosterUpload(
				new Map([
					[
						'Work entries',
						[
							['employee_number', 'work_date', 'clock_in', 'clock_out'],
							...days.map((day) => ['W1', day, '08:00', '16:00'])
						]
					]
				]),
				known
			);
			yield* importing(t, plan, false);
			const written = (yield* storedQuery(t, {
				roster_entry: { limit: 100 }
			})).roster_entry.rows.filter((row) => days.includes(String(row.work_date)));
			assert.equal(written.length, days.length);
			// the stored days and the new ones are one streak, longer than the fixture's rule allows
			for (const row of written)
				assert.ok(
					JSON.stringify(row.findings).includes('roster.consecutive_days'),
					`${row.work_date}: ${JSON.stringify(row.findings)}`
				);
		}).pipe(
			Effect.provide(
				workspace({
					seed: pack(
						'MY',
						'Asia/Kuala_Lumpur',
						{},
						{},
						before.map((date) => ({ date, shift: WORK, hours: 8 })),
						[],
						'2026-03-03'
					),
					now: '2026-03-20T02:00:00.000Z'
				})
			)
		);
	});
});
