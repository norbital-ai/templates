// Shared parity test harness: workspace A pays January wrong, corrects at the source and runs February; workspace B
// keys the right record before January and pays the same months. What A paid in all and its leave ledger must equal B's.
import assert from 'node:assert/strict';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { DateTime, Effect } from 'effect';
import { verify } from '../integrity_oracle.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	EMPLOYMENT,
	amendments,
	carriedFor,
	monthTotals,
	paidInAll,
	pay,
	rostered,
	run,
	slip
} from '../amendment_kit.ts';
import {
	ENTITY,
	current,
	lawAt,
	leaveCreate,
	ledgerRows,
	projection,
	storedQuery,
	storedReader,
	syncAll,
	uuid,
	wholeDays,
	workspace
} from '../kit.ts';

export type Seed = ReturnType<typeof rostered>;
export type Step<A> = (t: Kit) => Effect.Effect<A, unknown, never>;
/** January is paid wrong; February's run carries the correction. No change of law falls between them. */
export const MONTHS = ['2026-01', '2026-02'] as const;
export const at = (month: string) => `${month}-20T02:00:00.000Z`;
/** The schemes assessed in the month paid: carried pay is charged on the paying month by design, so they round apart. */
const PAID = lawAt('MY', '2026-01-01')
	.rows.statutory_contribution_catalog.filter((row) => row.assessed === 'PAID')
	.map((row) => String(row.code));
const earned = (lines: Readonly<Record<string, number>>) =>
	Object.fromEntries(
		Object.entries(lines).filter(
			([key]) => !PAID.some((code) => key.startsWith(`${code}/`) || key.startsWith(`${code}_`))
		)
	);
/**
 * What a history leaves: every line paid in all (but schemes assessed when paid), and the leave ledger per key; with
 * `money`, each pay and statutory total of a month on the balance too.
 */
export const outcome = (t: Kit, periods: readonly string[], money = false) =>
	Effect.gen(function* () {
		return {
			paid: earned(yield* paidInAll(t, ...periods)),
			leave: (yield* projection(t)).filter((line) => line.startsWith('leave/')),
			...(money ? { months: yield* monthTotals(t) } : {})
		};
	});
/** Ledger work run again moves nothing, no queued work failed, and the integrity check finds nothing. */
export const settledOnce = (t: Kit) =>
	Effect.gen(function* () {
		assert.deepEqual((yield* t.run_due()).failed, []);
		const before = [(yield* ledgerRows(t)).length, yield* projection(t)];
		yield* syncAll(t);
		yield* t.run_due();
		assert.deepEqual(
			[(yield* ledgerRows(t)).length, yield* projection(t)],
			before,
			'sync again moved the ledger'
		);
		assert.deepEqual(
			(yield* verify(storedReader(t), t.clock.now().slice(0, 10)))
				.filter((finding) => finding.invariant !== 'W1')
				.map((finding) => `${finding.invariant} ${finding.message}`),
			[]
		);
	});

/**
 * Workspace A keys `wrong`, pays January, corrects at the source and runs February; workspace B keys `right` before
 * January and pays the same months. What A paid in all and its leave ledger must equal B's.
 */
export const parity = <A>(
	seed: Seed,
	history: {
		readonly wrong: Step<A>;
		readonly correct: (t: Kit, wrong: A) => Effect.Effect<unknown, unknown, never>;
		readonly right: Step<unknown>;
		/** false where the correction moves the ledger and no pay (a paid leave day for a paid leave day) */
		readonly carries?: boolean;
		/** the month totals on the balance are compared too: for a law whose schemes are all assessed when earned */
		readonly money?: boolean;
	}
) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* syncAll(t);
		const wrong = yield* history.wrong(t);
		yield* pay(t, MONTHS[0]);
		const january = yield* slip(t, MONTHS[0]);
		yield* history.correct(t, wrong);
		yield* t.run_due();
		assert.deepEqual(
			(yield* amendments(t)).filter((row) => row.payroll_run_id === null).map((row) => row.period),
			[MONTHS[0]],
			'the correction leaves one open row for January'
		);
		const february = yield* run(t, MONTHS[1]);
		assert.ok(
			(yield* amendments(t)).every((row) => row.payroll_run_id === february.id),
			'February took the row'
		);
		assert.deepEqual(yield* slip(t, MONTHS[0]), january, 'the paid payslip stands');
		const carried = yield* carriedFor(t, MONTHS[1], MONTHS[0]);
		if (history.carries === false) assert.deepEqual(carried, {});
		else assert.notDeepEqual(carried, {}, 'February carries a difference for January');
		yield* settledOnce(t);
		return yield* outcome(t, MONTHS, history.money);
	}).pipe(
		Effect.provide(workspace({ seed, now: at(MONTHS[1]) })),
		Effect.flatMap((corrected) =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* history.right(t);
				yield* pay(t, MONTHS[0]);
				yield* run(t, MONTHS[1]);
				assert.deepEqual(yield* amendments(t), []);
				return yield* outcome(t, MONTHS, history.money);
			}).pipe(
				Effect.provide(workspace({ seed, now: at(MONTHS[1]) })),
				Effect.map((never) => assert.deepEqual(corrected, never))
			)
		)
	);

export const nothing = () => Effect.void;
export const STINT = idOf('employment', EMPLOYMENT);
export const PERSON = idOf('employee_profile', uuid(4));
export const DAY = '2026-01-15';
export const OVERTIME_DAY = '2026-01-15';
export const NPL_DAYS = ['2026-01-12', '2026-01-13', '2026-01-14'];

/** One write by HR, and the work it queues. */
export const wrote = <A, E>(
	t: Kit,
	write: (caller: Effect.Success<ReturnType<Kit['as']>>) => Effect.Effect<A, E>
) =>
	Effect.gen(function* () {
		yield* write(yield* t.as(t.admin));
		yield* t.run_due();
	});

/** A leave entry on whole days, keyed by HR; one a policy holds is approved by an HR controller. Answers its id. */
export const keyed = (t: Kit, code: string, dates: readonly string[]) =>
	Effect.gen(function* () {
		const before = new Set(
			(yield* storedQuery(t, { leave_catalog_entry: { limit: 100 } })).leave_catalog_entry.rows.map(
				(row) => row.id
			)
		);
		const result = yield* (yield* t.as(t.admin)).act({
			'leave_catalog_entry.create': [
				leaveCreate({
					entity_id: ENTITY,
					employment_id: EMPLOYMENT,
					catalog_code: code,
					days: wholeDays(...dates)
				})
			]
		});
		if (result.kind === 'pending_approval')
			yield* (yield* t.as(t.member(['hr_controller']))).approvals.decide(result.request_id, {
				decision: 'approve'
			});
		yield* t.run_due();
		const made = (yield* storedQuery(t, {
			leave_catalog_entry: { limit: 100 }
		})).leave_catalog_entry.rows.find((row) => !before.has(row.id));
		assert.ok(made !== undefined, 'No leave entry');
		return made.id;
	});

/** The entry's slots on these dates removed, on the entry itself. */
export const shortened = (t: Kit, entry: Id<'leave_catalog_entry'>, dates: readonly string[]) =>
	Effect.gen(function* () {
		const { leave_catalog_entry_day } = yield* storedQuery(t, {
			leave_catalog_entry_day: {
				where: { leave_entry_id: { eq: entry } },
				fields: ['id', 'revision', 'incurred_on'],
				limit: 100
			}
		});
		const gone = leave_catalog_entry_day.rows
			.filter((row) => dates.includes(String(row.incurred_on)))
			.map(({ id, revision }) => ({ id, revision }));
		assert.equal(gone.length, dates.length * 2);
		yield* (yield* t.as(t.admin)).act({
			'leave_catalog_entry.update': [
				{
					target: yield* current(t, 'leave_catalog_entry', entry),
					set: { leave_catalog_entry_day: { delete: gone } }
				}
			]
		});
		yield* t.run_due();
	});

/** Whole days added to the entry, on the entry itself. */
export const lengthened = (t: Kit, entry: Id<'leave_catalog_entry'>, dates: readonly string[]) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'leave_catalog_entry.update': [
				{
					target: yield* current(t, 'leave_catalog_entry', entry),
					set: {
						leave_catalog_entry_day: {
							create: wholeDays(...dates).map((day) => ({ incurred_on: day.date, part: day.part }))
						}
					}
				}
			]
		});
		yield* t.run_due();
	});

export const removed = (t: Kit, entry: Id<'leave_catalog_entry'>) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'leave_catalog_entry.delete': [{ target: yield* current(t, 'leave_catalog_entry', entry) }]
		});
		yield* t.run_due();
	});

/** A medical claim on a January day; answers its id. */
export const claimed = (t: Kit, quantity: number) =>
	Effect.gen(function* () {
		yield* wrote(t, (hr) =>
			hr.act({
				'claim_catalog_entry.create': [
					{
						entity_id: ENTITY,
						employment_id: STINT,
						catalog_code: 'MEDICAL_CLAIM',
						quantity: String(quantity),
						incurred_on: DAY
					}
				]
			})
		);
		const [made] = (yield* storedQuery(t, { claim_catalog_entry: { limit: 10 } }))
			.claim_catalog_entry.rows;
		assert.ok(made !== undefined, 'No claim');
		return made.id;
	});

/** An ad hoc payment on a January day; answers its id. */
export const awarded = (t: Kit, code: string, quantity: number) =>
	Effect.gen(function* () {
		yield* wrote(t, (hr) =>
			hr.act({
				'adhoc_catalog_entry.create': [
					{
						entity_id: ENTITY,
						employment_id: STINT,
						catalog_code: code,
						description: code,
						quantity: String(quantity),
						incurred_on: DAY
					}
				]
			})
		);
		const [made] = (yield* storedQuery(t, { adhoc_catalog_entry: { limit: 10 } }))
			.adhoc_catalog_entry.rows;
		assert.ok(made !== undefined, 'No ad hoc entry');
		return made.id;
	});

export const holidayDeclared = (t: Kit) =>
	wrote(t, (hr) =>
		hr.act({
			'holiday.create': [
				{
					entity_id: ENTITY,
					date: DAY,
					name: 'Declared late',
					kind: 'PUBLIC_HOLIDAY',
					given_to: 'EVERYONE',
					published_at: DateTime.formatIso(DateTime.makeUnsafe('2025-12-01T00:00:00.000Z'))
				}
			]
		})
	);

export const rosterDayGone = (t: Kit, on: string = DAY) =>
	Effect.gen(function* () {
		const [day] = (yield* storedQuery(t, {
			roster_entry: { where: { work_date: { eq: on } }, limit: 1 }
		})).roster_entry.rows;
		assert.ok(day !== undefined);
		yield* wrote(t, (hr) => hr.act({ 'roster_entry.delete': [{ target: day }] }));
	});

export const contractHour = (t: Kit) =>
	wrote(t, (hr) =>
		hr.act({
			'entity_change.create': [
				{
					entity_id: ENTITY,
					effective_from: '2026-01-01',
					pay_methods: { overtime_hour_basis: 'CONTRACT_WEEKLY' }
				}
			]
		})
	);

export const bornEarlier = (t: Kit) =>
	Effect.gen(function* () {
		const target = yield* current(t, 'employee_profile', PERSON);
		yield* wrote(t, (hr) =>
			hr.act({ 'employee_profile.update': [{ target, set: { date_of_birth: '1960-01-01' } }] })
		);
	});
