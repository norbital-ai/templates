// A paid period corrected at its source: the record's own write leaves an amendment row, and the next run works the
// period out again and carries the difference. Every case goes through the models' own acts; the law pack is only the
// fixture, and a figure is compared with a history in which the record was never wrong.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	EMPLOYMENT,
	amendments,
	carriedFor,
	cents,
	claimed,
	net,
	overtimeKeyed,
	pay,
	raisedFrom,
	rostered,
	run,
	signed,
	slip
} from './amendment_kit.ts';
import { ENTITY, catalogRow, workspace, storedQuery } from './kit.ts';

const NOW = '2026-03-20T02:00:00.000Z';
/** A claim as stored now: a write targets it at its current revision. */
const claimAt = (t: Kit, id: Id<'claim_catalog_entry'>) =>
	storedQuery(t, { claim_catalog_entry: { where: { id: { eq: id } }, limit: 1 } }).pipe(
		Effect.map(({ claim_catalog_entry }) => {
			const [row] = claim_catalog_entry.rows;
			assert.ok(row !== undefined);
			return row;
		})
	);
const OVERTIME_DAY = '2026-02-10';
const seed = (overtime: boolean) =>
	rostered(['2026-02', '2026-03'], overtime ? OVERTIME_DAY : undefined);
type Seed = ReturnType<typeof rostered>;

/** The same months paid with no correction at all, on another seed: what the corrected history must add up to. */
const neverWrong = (from: Seed, paidMonths: readonly string[], last: string, now = NOW) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		for (const month of paidMonths) yield* pay(t, month);
		yield* run(t, last);
		return yield* net(t, ...paidMonths, last);
	}).pipe(Effect.provide(workspace({ seed: from, now })));

describe('a paid period corrected at its source', () => {
	it.live(
		'missed overtime keyed after its month is paid is carried by the next run, tagged with its month',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const february = yield* pay(t, '2026-02');
				const before = yield* slip(t, '2026-02');
				assert.deepEqual(yield* amendments(t), []);

				const { roster_entry } = yield* storedQuery(t, {
					roster_entry: { where: { work_date: { eq: OVERTIME_DAY } }, limit: 1 }
				});
				const [day] = roster_entry.rows;
				assert.ok(day !== undefined);
				yield* (yield* t.as(t.admin)).act({
					'roster_entry.update': [
						{
							target: day,
							set: {
								actual_worked_intervals: [
									{
										start: Instant(`${OVERTIME_DAY}T00:00:00.000Z`),
										end: Instant(`${OVERTIME_DAY}T10:00:00.000Z`)
									}
								],
								planned_overtime_intervals: [
									{
										start: Instant(`${OVERTIME_DAY}T08:00:00.000Z`),
										end: Instant(`${OVERTIME_DAY}T10:00:00.000Z`)
									}
								]
							}
						}
					]
				});
				// the correction left one open row for the person's February, and the paid payslip stands
				const open = yield* amendments(t);
				assert.equal(open.length, 1);
				assert.equal(open[0]?.period, '2026-02');
				assert.equal(open[0]?.payroll_run_id, null);
				assert.deepEqual(yield* slip(t, '2026-02'), before);

				const march = yield* run(t, '2026-03');
				const carried = (yield* slip(t, '2026-03')).breakdown.lines.filter(
					(line) => line.period === '2026-02'
				);
				assert.ok(
					carried.some(
						(line) => line.code === 'OVERTIME' && line.direction === 'ADD' && line.amount > 0
					),
					'overtime for February is on the March payslip'
				);
				const taken = yield* amendments(t);
				assert.equal(taken[0]?.payroll_run_id, march.id);
				assert.notEqual(february.id, march.id);
				return {
					march: (yield* slip(t, '2026-03')).net,
					february: before.net,
					carried: carried.map((line) => [line.code, line.party, signed(line)])
				};
			}).pipe(
				Effect.provide(workspace({ seed: seed(false), now: NOW })),
				Effect.flatMap((corrected) =>
					// a history in which the overtime was keyed in time
					Effect.gen(function* () {
						const t = yield* TestWorkspace;
						yield* pay(t, '2026-02');
						yield* run(t, '2026-03');
						const total = (yield* slip(t, '2026-02')).net + (yield* slip(t, '2026-03')).net;
						assert.equal(
							Number((corrected.february + corrected.march).toFixed(2)),
							Number(total.toFixed(2)),
							`paid in all equals a history that was never wrong; carried ${JSON.stringify(corrected.carried)}`
						);
					}).pipe(Effect.provide(workspace({ seed: seed(true), now: NOW })))
				)
			)
	);

	it.live(
		'a claim a run paid is deleted: the next run takes back exactly what was paid for it',
		() => {
			const from = seed(false);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const made = yield* claimed(t, from, 120, '2026-02-12');
				yield* pay(t, '2026-02');
				yield* (yield* t.as(t.admin)).act({
					'claim_catalog_entry.delete': [{ target: yield* claimAt(t, made) }]
				});
				yield* t.run_due();
				assert.equal((yield* amendments(t)).length, 1);
				yield* run(t, '2026-03');
				assert.deepEqual(yield* carriedFor(t, '2026-03', '2026-02'), {
					'MEDICAL_CLAIM/EMPLOYEE': -120
				});
				return yield* net(t, '2026-02', '2026-03');
			}).pipe(
				Effect.provide(workspace({ seed: from, now: NOW })),
				Effect.flatMap((corrected) =>
					neverWrong(from, ['2026-02'], '2026-03').pipe(
						Effect.map((never) => assert.equal(corrected, never))
					)
				)
			);
		}
	);

	it.live(
		'a paid claim moved to an unpaid month: taken back for the month it left, paid by the month it joined',
		() => {
			const from = seed(false);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const made = yield* claimed(t, from, 120, '2026-02-12');
				yield* pay(t, '2026-02');
				yield* (yield* t.as(t.admin)).act({
					'claim_catalog_entry.update': [
						{ target: yield* claimAt(t, made), set: { incurred_on: PlainDate('2026-03-05') } }
					]
				});
				yield* t.run_due();
				yield* run(t, '2026-03');
				const march = yield* slip(t, '2026-03');
				assert.deepEqual(yield* carriedFor(t, '2026-03', '2026-02'), {
					'MEDICAL_CLAIM/EMPLOYEE': -120
				});
				assert.ok(
					march.breakdown.lines.some(
						(line) =>
							line.code === 'MEDICAL_CLAIM' && line.period === undefined && line.amount === 120
					),
					'March pays the claim as its own'
				);
			}).pipe(Effect.provide(workspace({ seed: from, now: NOW })));
		}
	);

	it.live('edited many times and back to what it was: one open row, and nothing to carry', () => {
		const from = seed(false);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const made = yield* claimed(t, from, 120, '2026-02-12');
			yield* pay(t, '2026-02');
			for (const quantity of [200, 80, 120]) {
				yield* (yield* t.as(t.admin)).act({
					'claim_catalog_entry.update': [{ target: yield* claimAt(t, made), set: { quantity } }]
				});
				yield* t.run_due();
				assert.equal((yield* amendments(t)).length, 1, 'however many edits, one open row');
			}
			const march = yield* run(t, '2026-03');
			assert.deepEqual(yield* carriedFor(t, '2026-03', '2026-02'), {});
			assert.equal(
				(yield* amendments(t))[0]?.payroll_run_id,
				march.id,
				'the run still takes the row'
			);
		}).pipe(Effect.provide(workspace({ seed: from, now: NOW })));
	});

	it.live('nothing of a person moves while an unpaid run holds them', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, '2026-02');
			const march = yield* run(t, '2026-03');
			assert.match(
				String(yield* Effect.flip(overtimeKeyed(t, OVERTIME_DAY))),
				/Run \d+ holds this person and is not paid yet\. Delete it, correct this, and run again\./
			);
			yield* (yield* t.as(t.admin)).act({ 'payroll_run.delete': [{ target: march }] });
			yield* t.run_due();
			yield* overtimeKeyed(t, OVERTIME_DAY);
			assert.equal((yield* amendments(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed: seed(false), now: NOW })))
	);

	it.live(
		'a run that carried is deleted: its rows open again, and the run made again is the same payslip',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02');
				yield* overtimeKeyed(t, OVERTIME_DAY);
				const first = yield* run(t, '2026-03');
				const made = yield* slip(t, '2026-03');
				yield* (yield* t.as(t.admin)).act({ 'payroll_run.delete': [{ target: first }] });
				yield* t.run_due();
				assert.equal((yield* amendments(t))[0]?.payroll_run_id, null);
				yield* run(t, '2026-03');
				assert.deepEqual(yield* slip(t, '2026-03'), made);
			}).pipe(Effect.provide(workspace({ seed: seed(false), now: NOW })))
	);

	it.live(
		'a recovery larger than the pay: net pay stops at zero, and the next run takes the rest once',
		() => {
			const from = rostered(['2026-02', '2026-03', '2026-04']);
			const now = '2026-04-20T02:00:00.000Z';
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* (yield* t.as(t.admin)).act({
					'adhoc_catalog_entry.create': [
						{
							entity_id: ENTITY,
							employment_id: EMPLOYMENT,
							catalog_id: idOf('adhoc_catalog', catalogRow(from, 'adhoc_catalog', 'BONUS')),
							description: 'Paid by mistake',
							quantity: 4000,
							unit: 'MONEY',
							incurred_on: PlainDate('2026-02-20')
						}
					]
				});
				yield* t.run_due();
				yield* pay(t, '2026-02');
				const { adhoc_catalog_entry } = yield* storedQuery(t, {
					adhoc_catalog_entry: { limit: 10 }
				});
				const [bonus] = adhoc_catalog_entry.rows;
				assert.ok(bonus !== undefined);
				yield* (yield* t.as(t.admin)).act({ 'adhoc_catalog_entry.delete': [{ target: bonus }] });
				yield* t.run_due();
				// made, deleted and made again: the row the first making left for March serves the second
				const first = yield* run(t, '2026-03');
				yield* (yield* t.as(t.admin)).act({ 'payroll_run.delete': [{ target: first }] });
				yield* t.run_due();
				yield* pay(t, '2026-03');
				const march = yield* slip(t, '2026-03');
				assert.equal(march.net, 0);
				// someone a later run still pays is asked nothing: the next run takes the rest
				assert.deepEqual(
					(yield* storedQuery(t, { obligation: { limit: 500 } })).obligation.rows.filter((row) =>
						row.occurrence_key.startsWith('recovery:')
					),
					[]
				);
				const deferred = march.breakdown.lines.find((line) => line.code === 'RECOVERY_CARRIED');
				assert.ok(deferred !== undefined && deferred.direction === 'ADD' && deferred.amount > 0);
				// the run left its own month to be worked out again: that is where the rest is taken
				assert.ok(
					(yield* amendments(t)).some(
						(row) => row.period === '2026-03' && row.payroll_run_id === null
					)
				);
				yield* run(t, '2026-04');
				assert.deepEqual(yield* carriedFor(t, '2026-04', '2026-03'), {
					'RECOVERY_CARRIED/EMPLOYEE': -cents(deferred.amount)
				});
				return yield* net(t, '2026-02', '2026-03', '2026-04');
			}).pipe(
				Effect.provide(workspace({ seed: from, now })),
				Effect.flatMap((corrected) =>
					neverWrong(from, ['2026-02', '2026-03'], '2026-04', now).pipe(
						Effect.map((never) => assert.equal(corrected, never))
					)
				)
			);
		}
	);

	it.live('a correction after its tax year closed: that year alone is worked out again', () => {
		const months = ['2025-12', '2026-01', '2026-02'];
		const day = '2025-12-09';
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, '2025-12');
			yield* pay(t, '2026-01');
			yield* overtimeKeyed(t, day);
			yield* run(t, '2026-02');
			const december = yield* carriedFor(t, '2026-02', '2025-12');
			assert.ok((december['OVERTIME/EMPLOYEE'] ?? 0) > 0);
			assert.deepEqual(
				yield* carriedFor(t, '2026-02', '2026-01'),
				{},
				'the new year reads nothing of it'
			);
			return yield* net(t, ...months);
		}).pipe(
			Effect.provide(workspace({ seed: rostered(months), now: '2026-02-20T02:00:00.000Z' })),
			Effect.flatMap((corrected) =>
				neverWrong(
					rostered(months, day),
					['2025-12', '2026-01'],
					'2026-02',
					'2026-02-20T02:00:00.000Z'
				).pipe(Effect.map((never) => assert.equal(corrected, never)))
			)
		);
	});

	it.live(
		'a raise sealed after its first month was paid is carried for that month, on every line',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02');
				yield* raisedFrom(t, '2026-02-01', 3300);
				assert.ok((yield* amendments(t)).some((row) => row.period === '2026-02'));
				yield* run(t, '2026-03');
				const february = yield* carriedFor(t, '2026-03', '2026-02');
				assert.equal(february['BASIC/EMPLOYEE'], 500);
				assert.ok(
					(february['EPF/EMPLOYEE'] ?? 0) < 0,
					'the contribution on the raise is carried too'
				);
				return yield* net(t, '2026-02', '2026-03');
			}).pipe(
				Effect.provide(workspace({ seed: seed(false), now: NOW })),
				Effect.flatMap((corrected) =>
					neverWrong(
						rostered(['2026-02', '2026-03'], undefined, 3300),
						['2026-02'],
						'2026-03'
					).pipe(Effect.map((never) => assert.equal(corrected, never)))
				)
			)
	);
});
