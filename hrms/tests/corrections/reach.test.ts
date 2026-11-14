// How far a correction reaches and who carries it: a month nobody changed carries nothing, several months each carry
// their own difference, a ceiling is the earning month's, a correction over a year back stays in its tax year, and
// someone no on-cycle run pays any more is paid by an off-cycle run that carries their periods alone.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import {
	EMPLOYMENT,
	amendments,
	carriedFor,
	claimed,
	net,
	ownLines,
	overtimeKeyed,
	paidInAll,
	pay,
	raisedFrom,
	rostered,
	run,
	slip,
	claimAt
} from '../amendment_kit.ts';
import {
	ENTITY,
	lawAt,
	leaveCreate,
	wholeDays,
	workspace,
	storedQuery,
	stintOver
} from '../kit.ts';

type Seed = ReturnType<typeof rostered>;
/** The schemes the fixture assesses in the month paid: no correction works them out again for an earlier period. */
const PAID = lawAt('MY', '2026-02-01')
	.rows.statutory_contribution_catalog.filter((row) => row.assessed === 'PAID')
	.map((row) => String(row.code));
/** What was paid in all, but the schemes assessed when paid: those are charged on the paying month, so they round apart. */
const earned = (lines: Readonly<Record<string, number>>) =>
	Object.fromEntries(
		Object.entries(lines).filter(
			([key]) => !PAID.some((code) => key.startsWith(`${code}/`) || key.startsWith(`${code}_`))
		)
	);
/** A claim as stored now: a write targets it at its current revision. */
const at = (month: string) => `${month}-20T02:00:00.000Z`;
/** The same months paid on a seed that was never wrong, read the same way. */
const neverWrong = <A>(
	from: Seed,
	months: readonly string[],
	read: (t: Kit) => Effect.Effect<A, unknown, never>
) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		for (const month of months.slice(0, -1)) yield* pay(t, month);
		yield* run(t, String(months.at(-1)));
		return yield* read(t);
	}).pipe(Effect.provide(workspace({ seed: from, now: at(String(months.at(-1))) })));

describe('what a correction reaches', () => {
	it.live('paid months worked out again with nothing changed carry nothing', () => {
		const months = ['2026-02', '2026-03', '2026-04'];
		const from = rostered(months, '2026-02-10');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* claimed(t, 120, '2026-02-12');
			yield* pay(t, '2026-02');
			yield* pay(t, '2026-03');
			const paid = [yield* slip(t, '2026-02'), yield* slip(t, '2026-03')];
			// February is touched and put back: a claim keyed and deleted again
			const extra = yield* claimed(t, 55, '2026-02-13');
			yield* (yield* t.as(t.admin)).act({
				'claim_catalog_entry.delete': [{ target: yield* claimAt(t, extra) }]
			});
			yield* t.run_due();
			assert.deepEqual(
				(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
				[['2026-02', null]]
			);
			const april = yield* run(t, '2026-04');
			assert.deepEqual(yield* carriedFor(t, '2026-04', '2026-02'), {});
			assert.deepEqual(yield* carriedFor(t, '2026-04', '2026-03'), {});
			assert.deepEqual([yield* slip(t, '2026-02'), yield* slip(t, '2026-03')], paid);
			assert.equal((yield* amendments(t))[0]?.payroll_run_id, april.id);
		}).pipe(Effect.provide(workspace({ seed: from, now: at('2026-04') })));
	});

	it.live('a raise three months back: each month carries its own difference, on every line', () => {
		const months = ['2026-02', '2026-03', '2026-04', '2026-05'];
		const read = (t: Kit) => paidInAll(t, ...months).pipe(Effect.map(earned));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			for (const month of months.slice(0, -1)) yield* pay(t, month);
			yield* raisedFrom(t, '2026-02-01', 3300);
			assert.deepEqual(
				(yield* amendments(t)).map((row) => row.period).toSorted(),
				months.slice(0, -1)
			);
			yield* run(t, '2026-05');
			for (const month of months.slice(0, -1)) {
				const carried = yield* carriedFor(t, '2026-05', month);
				assert.equal(carried['BASIC/EMPLOYEE'], 500, month);
				// a scheme assessed when paid charges the back pay in May instead
				assert.deepEqual(carried, earned(carried), month);
			}
			return yield* read(t);
		}).pipe(
			Effect.provide(workspace({ seed: rostered(months), now: at('2026-05') })),
			Effect.flatMap((corrected) =>
				neverWrong(rostered(months, undefined, 3300), months, read).pipe(
					Effect.map((never) => assert.deepEqual(corrected, never))
				)
			)
		);
	});

	it.live(
		'a correction that crosses a contribution band: charged this month by a scheme assessed when paid',
		() => {
			const months = ['2026-02', '2026-03'];
			const read = (t: Kit) => paidInAll(t, ...months);
			// 2,800 a month is the top of an insured wage band; the missed overtime lifts the month into the next one
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02');
				yield* overtimeKeyed(t, '2026-02-10');
				yield* run(t, '2026-03');
				const february = yield* carriedFor(t, '2026-03', '2026-02');
				assert.ok((february['OVERTIME/EMPLOYEE'] ?? 0) > 20);
				// the insured schemes are assessed in the month paid: February's charge stands, and March is charged on
				// its own wages with the carried overtime, in the next band
				for (const scheme of ['SOCSO', 'EIS'])
					assert.deepEqual(
						[february[`${scheme}/EMPLOYEE`], february[`${scheme}_EMPLOYER/EMPLOYER`]],
						[undefined, undefined],
						scheme
					);
				const [paid, paying] = [yield* ownLines(t, '2026-02'), yield* ownLines(t, '2026-03')];
				assert.ok(
					Math.abs(paying['SOCSO/EMPLOYEE'] ?? 0) > Math.abs(paid['SOCSO/EMPLOYEE'] ?? 0),
					'March is charged in the band the carried overtime lifts it to'
				);
				return yield* read(t);
			}).pipe(
				Effect.provide(workspace({ seed: rostered(months), now: at('2026-03') })),
				Effect.flatMap((corrected) =>
					neverWrong(rostered(months, '2026-02-10'), months, read).pipe(
						Effect.map((never) => assert.deepEqual(corrected, never))
					)
				)
			);
		}
	);

	it.live('a day corrected under earlier terms is priced by the terms in force on its date', () => {
		const months = ['2026-02', '2026-03', '2026-04'];
		const read = (t: Kit) => paidInAll(t, ...months).pipe(Effect.map(earned));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, '2026-02');
			yield* raisedFrom(t, '2026-03-01', 3300);
			yield* pay(t, '2026-03');
			// the roster day is February's, before the raise
			yield* overtimeKeyed(t, '2026-02-10');
			yield* run(t, '2026-04');
			assert.ok(((yield* carriedFor(t, '2026-04', '2026-02'))['OVERTIME/EMPLOYEE'] ?? 0) > 0);
			assert.deepEqual(yield* carriedFor(t, '2026-04', '2026-03'), {});
			return yield* read(t);
		}).pipe(
			Effect.provide(workspace({ seed: rostered(months), now: at('2026-04') })),
			Effect.flatMap((corrected) =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* raisedFrom(t, '2026-03-01', 3300);
					yield* pay(t, '2026-02');
					yield* pay(t, '2026-03');
					yield* run(t, '2026-04');
					return yield* read(t);
				}).pipe(
					Effect.provide(workspace({ seed: rostered(months, '2026-02-10'), now: at('2026-04') })),
					Effect.map((never) => assert.deepEqual(corrected, never))
				)
			)
		);
	});

	it.live('a paid claim lowered: the next run takes back the difference and nothing else', () => {
		const from = rostered(['2026-02', '2026-03']);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const made = yield* claimed(t, 120, '2026-02-12');
			yield* pay(t, '2026-02');
			yield* (yield* t.as(t.admin)).act({
				'claim_catalog_entry.update': [{ target: yield* claimAt(t, made), set: { quantity: '20' } }]
			});
			yield* t.run_due();
			yield* run(t, '2026-03');
			assert.deepEqual(yield* carriedFor(t, '2026-03', '2026-02'), {
				'MEDICAL_CLAIM/EMPLOYEE': -100
			});
		}).pipe(Effect.provide(workspace({ seed: from, now: at('2026-03') })));
	});

	it.live(
		'over a year back: its own tax year is worked out again, and the years after it are not',
		() => {
			// two year ends, and the months of the amended year a run paid; the roster is left to the shift pattern
			const months = ['2025-12', '2026-01', '2026-02', '2026-12', '2027-01'];
			const from = rostered([]);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const made = yield* claimed(t, 120, '2026-01-15');
				for (const month of months.slice(0, -1)) yield* pay(t, month);
				yield* (yield* t.as(t.admin)).act({
					'claim_catalog_entry.delete': [{ target: yield* claimAt(t, made) }]
				});
				yield* t.run_due();
				yield* run(t, '2027-01');
				assert.deepEqual(yield* carriedFor(t, '2027-01', '2026-01'), {
					'MEDICAL_CLAIM/EMPLOYEE': -120
				});
				for (const month of ['2025-12', '2026-02', '2026-12'])
					assert.deepEqual(yield* carriedFor(t, '2027-01', month), {}, month);
				// the delete is all the year gives back: no month between carries anything of it
			}).pipe(Effect.provide(workspace({ seed: from, now: at('2027-01') })));
		}
	);

	it.live(
		'four years back, with the years between unpaid by this group: the amended year alone',
		() => {
			const from = rostered([]);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const made = yield* claimed(t, 120, '2026-01-15');
				yield* pay(t, '2026-01');
				yield* pay(t, '2029-12');
				yield* (yield* t.as(t.admin)).act({
					'claim_catalog_entry.delete': [{ target: yield* claimAt(t, made) }]
				});
				yield* t.run_due();
				yield* run(t, '2030-01');
				assert.deepEqual(yield* carriedFor(t, '2030-01', '2026-01'), {
					'MEDICAL_CLAIM/EMPLOYEE': -120
				});
				assert.deepEqual(yield* carriedFor(t, '2030-01', '2029-12'), {});
			}).pipe(Effect.provide(workspace({ seed: from, now: at('2030-01') })));
		}
	);

	it.live(
		'a paid no-pay day that was another kind of leave is deleted: its deduction comes back',
		() => {
			const months = ['2026-02', '2026-03'];
			const from = rostered(months);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* (yield* t.as(t.admin)).act({
					'leave_catalog_entry.create': [
						leaveCreate({
							entity_id: ENTITY,
							employment_id: EMPLOYMENT,
							catalog_code: 'NPL',
							days: wholeDays('2026-02-12')
						})
					]
				});
				yield* t.run_due();
				yield* pay(t, '2026-02');
				const taken = (yield* slip(t, '2026-02')).breakdown.lines.find(
					(line) => line.code === 'NPL'
				);
				assert.ok(taken !== undefined && taken.direction === 'DEDUCT' && taken.amount > 0);
				const { leave_catalog_entry } = yield* storedQuery(t, {
					leave_catalog_entry: { limit: 10 }
				});
				const [entry] = leave_catalog_entry.rows;
				assert.ok(entry !== undefined);
				yield* (yield* t.as(t.admin)).act({ 'leave_catalog_entry.delete': [{ target: entry }] });
				yield* t.run_due();
				yield* run(t, '2026-03');
				assert.equal((yield* carriedFor(t, '2026-03', '2026-02'))['NPL/EMPLOYEE'], taken.amount);
				return yield* net(t, ...months);
			}).pipe(
				Effect.provide(workspace({ seed: from, now: at('2026-03') })),
				Effect.flatMap((corrected) =>
					neverWrong(from, months, (t) => net(t, ...months)).pipe(
						Effect.map((never) => assert.equal(corrected, never))
					)
				)
			);
		}
	);
});

describe('someone no on-cycle run pays any more', () => {
	/** The person's stint ended with February. */
	const left = (from: Seed): Seed => stintOver(from, '2026-01-01', '2026-02-28');
	const offCycle = (t: Kit) =>
		Effect.gen(function* () {
			const open = (yield* amendments(t)).filter((row) => row.payroll_run_id === null);
			return yield* (yield* t.as(t.admin)).act({
				'payroll_run.create': [
					{
						entity_id: ENTITY,
						period: '2026-03',
						kind: 'OFF_CYCLE',
						amendments: open.map((row) => ({ id: row.id, revision: row.revision }))
					}
				]
			});
		});

	it.live('an off-cycle run carries what they are owed, on a payslip of its own', () => {
		const months = ['2026-02', '2026-03'];
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, '2026-02');
			yield* overtimeKeyed(t, '2026-02-10');
			yield* offCycle(t);
			yield* t.run_due();
			const carried = yield* slip(t, '2026-03');
			assert.ok(carried.net > 0);
			assert.ok(carried.breakdown.lines.every((line) => line.period === '2026-02'));
			assert.ok(carried.breakdown.lines.some((line) => line.code === 'OVERTIME'));
			const [row] = yield* amendments(t);
			assert.ok(row !== undefined && row.payroll_run_id !== null, 'the run took the row');
			return earned(yield* paidInAll(t, ...months));
		}).pipe(
			Effect.provide(workspace({ seed: left(rostered(months)), now: at('2026-03') })),
			Effect.flatMap((corrected) =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* pay(t, '2026-02');
					return earned(yield* paidInAll(t, '2026-02'));
				}).pipe(
					Effect.provide(
						workspace({ seed: left(rostered(months, '2026-02-10')), now: at('2026-03') })
					),
					Effect.map((never) => assert.deepEqual(corrected, never))
				)
			)
		);
	});

	it.live('what they owe is not taken by a run that pays them nothing', () => {
		const from = left(rostered(['2026-02', '2026-03']));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* (yield* t.as(t.admin)).act({
				'adhoc_catalog_entry.create': [
					{
						entity_id: ENTITY,
						employment_id: EMPLOYMENT,
						catalog_code: 'BONUS',
						description: 'Paid by mistake',
						quantity: '400',
						unit: 'MONEY',
						incurred_on: '2026-02-20'
					}
				]
			});
			yield* t.run_due();
			yield* pay(t, '2026-02');
			const { adhoc_catalog_entry } = yield* storedQuery(t, { adhoc_catalog_entry: { limit: 10 } });
			const [bonus] = adhoc_catalog_entry.rows;
			assert.ok(bonus !== undefined);
			yield* (yield* t.as(t.admin)).act({ 'adhoc_catalog_entry.delete': [{ target: bonus }] });
			yield* t.run_due();
			assert.match(
				String(yield* Effect.flip(offCycle(t))),
				/would take money back from someone it pays too little/
			);
			assert.equal((yield* amendments(t))[0]?.payroll_run_id, null, 'the row still waits');
		}).pipe(Effect.provide(workspace({ seed: from, now: at('2026-03') })));
	});

	it.live('what they still owe after their last payslip is one task for HR', () => {
		const from = stintOver(rostered(['2026-02', '2026-03']), '2026-01-01', '2026-03-31');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* (yield* t.as(t.admin)).act({
				'adhoc_catalog_entry.create': [
					{
						entity_id: ENTITY,
						employment_id: EMPLOYMENT,
						catalog_code: 'BONUS',
						description: 'Paid by mistake',
						quantity: '4000',
						unit: 'MONEY',
						incurred_on: '2026-02-20'
					}
				]
			});
			yield* t.run_due();
			yield* pay(t, '2026-02');
			const { adhoc_catalog_entry } = yield* storedQuery(t, { adhoc_catalog_entry: { limit: 10 } });
			const [bonus] = adhoc_catalog_entry.rows;
			assert.ok(bonus !== undefined);
			yield* (yield* t.as(t.admin)).act({ 'adhoc_catalog_entry.delete': [{ target: bonus }] });
			yield* t.run_due();
			yield* run(t, '2026-03');
			const last = yield* slip(t, '2026-03');
			assert.equal(last.net, 0);
			const { obligation } = yield* storedQuery(t, { obligation: { limit: 500 } });
			const tasks = obligation.rows.filter((row) => row.occurrence_key.startsWith('recovery:'));
			assert.equal(tasks.length, 1);
			assert.equal(tasks[0]?.occurrence_key, `recovery:${EMPLOYMENT}:2026-03`);
			assert.match(String(tasks[0]?.title), /^Recover \d+\.\d\d outside payroll/);
		}).pipe(Effect.provide(workspace({ seed: from, now: at('2026-03') })));
	});
});
