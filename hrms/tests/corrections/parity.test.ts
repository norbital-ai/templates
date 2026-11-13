// Every change that alters a paid month, corrected at its source after the month was paid, reconciles on the next
// payslip: a history that paid January wrong, corrected the source and ran February has paid in all exactly what a
// history that was right before January paid, line by line, and its leave ledger ends the same. Ledger work run again
// changes nothing. The Malaysian pack is only the fixture; every figure compared is one the system produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { DateTime, Effect } from 'effect';
import { verify } from '../../src/lib/integrity.ts';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { isJsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	EMPLOYMENT,
	amendments,
	carriedFor,
	paidInAll,
	pay,
	rostered,
	run,
	slip
} from '../amendment_kit.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	current,
	leaveCreate,
	ledgerRows,
	measureOf,
	projection,
	storedQuery,
	storedReader,
	syncAll,
	wholeDays,
	workspace
} from '../kit.ts';

type Seed = ReturnType<typeof rostered>;
type Step<A> = (t: Kit) => Effect.Effect<A, unknown, never>;
/** January is paid wrong; February's run carries the correction. One law version covers both. */
const MONTHS = ['2026-01', '2026-02'] as const;
const at = (month: string) => `${month}-20T02:00:00.000Z`;
const BASE = rostered([]);
/** The schemes assessed in the month paid: carried pay is charged on the paying month by design, so they round apart. */
const PAID = (BASE.statutory_contribution_catalog ?? [])
	.filter((row) => row.assessed === 'PAID')
	.map((row) => String(row.code));
const earned = (lines: Readonly<Record<string, number>>) =>
	Object.fromEntries(
		Object.entries(lines).filter(
			([key]) => !PAID.some((code) => key.startsWith(`${code}/`) || key.startsWith(`${code}_`))
		)
	);
/** What a history leaves: every line paid in all (but schemes assessed when paid), and the leave ledger per key. */
const outcome = (t: Kit, periods: readonly string[]) =>
	Effect.gen(function* () {
		return {
			paid: earned(yield* paidInAll(t, ...periods)),
			leave: (yield* projection(t)).filter((line) => line.startsWith('leave/'))
		};
	});
/** Ledger work run again moves nothing, no queued work failed, and the integrity check finds nothing. */
const settledOnce = (t: Kit) =>
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
const parity = <A>(
	seed: Seed,
	history: {
		readonly wrong: Step<A>;
		readonly correct: (t: Kit, wrong: A) => Effect.Effect<unknown, unknown, never>;
		readonly right: Step<unknown>;
		/** false where the correction moves the ledger and no pay (a paid leave day for a paid leave day) */
		readonly carries?: boolean;
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
		return yield* outcome(t, MONTHS);
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
				return yield* outcome(t, MONTHS);
			}).pipe(
				Effect.provide(workspace({ seed, now: at(MONTHS[1]) })),
				Effect.map((never) => assert.deepEqual(corrected, never))
			)
		)
	);

// ---- contract facts -------------------------------------------------------------------------------------------------

const versions = (t: Kit) =>
	storedQuery(t, { employee_contract: { limit: 100 } }).pipe(
		Effect.map(({ employee_contract }) => employee_contract.rows)
	);
type Version = Effect.Success<ReturnType<typeof versions>>[number];
type Facts = Partial<Pick<Version, 'family' | 'employee_extension_data' | 'terms'>>;
/**
 * A sealed version is frozen: a fact is changed by a new version from its real date, the way HR makes one (the draft,
 * the open version ended the day before, the seal). Sealed over a paid month, its write amends that month.
 */
const factsFrom = (from: string, facts: Facts) => (t: Kit) =>
	Effect.gen(function* () {
		const admin = yield* t.as(t.admin);
		const held = (yield* versions(t)).find(
			(row) => row.status === 'SEALED' && row.effective_range.to === null
		);
		assert.ok(held !== undefined, 'No open version');
		yield* admin.act({
			'employee_contract.create': [
				{
					employee_id: held.employee_id,
					entity_id: held.entity_id,
					engagement: held.engagement,
					employee_number: held.employee_number,
					terms: facts.terms ?? held.terms,
					payroll: held.payroll,
					bank: held.bank,
					family: facts.family ?? held.family,
					employee_extension_data: facts.employee_extension_data ?? held.employee_extension_data,
					service_started_on: held.service_started_on,
					effective_range: { from, to: null },
					status: 'DRAFT',
					reason: 'A fact corrected'
				}
			]
		});
		const draft = (yield* versions(t)).find((row) => row.status === 'DRAFT');
		assert.ok(draft !== undefined, 'No draft version');
		yield* admin.act({
			'employee_contract.update': [
				{
					target: held,
					set: {
						effective_range: {
							from: held.effective_range.from,
							to: DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(from), { days: -1 }))
						}
					}
				}
			]
		});
		yield* admin.act({
			'employee_contract.update': [{ target: draft, set: { status: 'SEALED' } }]
		});
		yield* t.run_due();
	});
/** A married earner whose PCB the family and the declared child reliefs move. */
const married = (
	family: readonly JsonObject[],
	children: Readonly<Record<string, number>>
): Seed => {
	const base = rostered(MONTHS, undefined, 8000);
	return {
		...base,
		employee_contract: (base.employee_contract ?? []).map((row) => ({
			...row,
			payroll: { date_of_birth: '1985-01-01', gender: 'MALE', marital_status: 'MARRIED' },
			family: [...family],
			employee_extension_data: { statutory: { PCB: children } }
		}))
	};
};
const spouse = (has_income: boolean) => [{ relation: 'SPOUSE' as const, has_income }];
const reliefs = (children: Readonly<Record<string, number>>) => ({ statutory: { PCB: children } });
const nothing = () => Effect.void;

describe('a contract fact corrected after its month was paid', () => {
	for (const [was, is] of [
		[true, false],
		[false, true]
	] as const)
		it.live(
			`spouse ${was ? 'with' : 'without'} income corrected to ${is ? 'with' : 'without'}: the next payslip carries the PCB difference`,
			() => {
				const right = factsFrom('2026-01-01', { family: spouse(is) });
				return parity(married(spouse(was), {}), { wrong: nothing, correct: right, right });
			}
		);

	for (const [was, is] of [
		[1, 2],
		[2, 1]
	] as const)
		it.live(
			`children corrected from ${was} to ${is}: the next payslip carries the difference`,
			() => {
				const right = factsFrom('2026-01-01', {
					employee_extension_data: reliefs({ children_under_18_or_studying: is })
				});
				return parity(married(spouse(true), { children_under_18_or_studying: was }), {
					wrong: nothing,
					correct: right,
					right
				});
			}
		);
});

// ---- leave ----------------------------------------------------------------------------------------------------------

/** A leave entry on whole days, keyed by HR; one a policy holds is approved by an HR controller. Answers its id. */
const keyed = (t: Kit, code: string, dates: readonly string[]) =>
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
					catalog_id: idOf('leave_catalog', catalogRow(BASE, 'leave_catalog', code)),
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
const shortened = (t: Kit, entry: Id<'leave_catalog_entry'>, dates: readonly string[]) =>
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
const lengthened = (t: Kit, entry: Id<'leave_catalog_entry'>, dates: readonly string[]) =>
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
const removed = (t: Kit, entry: Id<'leave_catalog_entry'>) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'leave_catalog_entry.delete': [{ target: yield* current(t, 'leave_catalog_entry', entry) }]
		});
		yield* t.run_due();
	});
const NPL_DAYS = ['2026-01-12', '2026-01-13', '2026-01-14'];

describe('leave changed after its month was paid', () => {
	it.live(
		'no-pay leave of three days shortened to one: the two days’ pay comes back, ledger as B',
		() =>
			parity(rostered(MONTHS), {
				wrong: (t) => keyed(t, 'NPL', NPL_DAYS),
				correct: (t, entry) => shortened(t, entry, NPL_DAYS.slice(1)),
				right: (t) => keyed(t, 'NPL', NPL_DAYS.slice(0, 1))
			})
	);

	it.live('no-pay leave of one day lengthened to three: two more days are taken, ledger as B', () =>
		parity(rostered(MONTHS), {
			wrong: (t) => keyed(t, 'NPL', NPL_DAYS.slice(0, 1)),
			correct: (t, entry) => lengthened(t, entry, NPL_DAYS.slice(1)),
			right: (t) => keyed(t, 'NPL', NPL_DAYS)
		})
	);

	it.live('annual leave of three days shortened to one: no pay moves, the days used are B’s', () =>
		parity(rostered(MONTHS), {
			wrong: (t) => keyed(t, 'ANNUAL_LEAVE', NPL_DAYS),
			correct: (t, entry) => shortened(t, entry, NPL_DAYS.slice(1)),
			right: (t) => keyed(t, 'ANNUAL_LEAVE', NPL_DAYS.slice(0, 1)),
			carries: false
		})
	);

	// A leave entry's catalogue item is not editable (`leave_catalog_entry` update columns are its days and evidence),
	// so the wrong kind is corrected the way section 0 names: the entry deleted, the days keyed as the leave they were.
	it.live(
		'annual leave that was no-pay leave: the deduction is carried and the days come back, as B',
		() =>
			parity(rostered(MONTHS), {
				wrong: (t) => keyed(t, 'ANNUAL_LEAVE', NPL_DAYS),
				correct: (t, entry) => removed(t, entry).pipe(Effect.andThen(keyed(t, 'NPL', NPL_DAYS))),
				right: (t) => keyed(t, 'NPL', NPL_DAYS)
			})
	);

	it.live(
		'no-pay leave that was annual leave: the deduction comes back and the days are used, as B',
		() =>
			parity(rostered(MONTHS), {
				wrong: (t) => keyed(t, 'NPL', NPL_DAYS),
				correct: (t, entry) =>
					removed(t, entry).pipe(Effect.andThen(keyed(t, 'ANNUAL_LEAVE', NPL_DAYS))),
				right: (t) => keyed(t, 'ANNUAL_LEAVE', NPL_DAYS)
			})
	);
});

// ---- the clock ------------------------------------------------------------------------------------------------------

const OVERTIME_DAY = '2026-01-15';
const MISSED_DAY = '2026-01-22';
/** January's roster with two hours of planned overtime clocked on one day and no punch at all on another. */
const clocked = (): Seed => {
	const base = rostered(MONTHS, OVERTIME_DAY);
	return {
		...base,
		roster_entry: (base.roster_entry ?? []).map((row) =>
			row.work_date === MISSED_DAY ? { ...row, actual_worked_intervals: [] } : row
		)
	};
};
/** The day's clocked intervals as eight ordinary hours. */
const punched = (date: string) => (t: Kit) =>
	Effect.gen(function* () {
		const { roster_entry } = yield* storedQuery(t, {
			roster_entry: { where: { work_date: { eq: date } }, limit: 1 }
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
								start: DateTime.formatIso(DateTime.makeUnsafe(`${date}T00:00:00.000Z`)),
								end: DateTime.formatIso(DateTime.makeUnsafe(`${date}T08:00:00.000Z`))
							}
						]
					}
				}
			]
		});
		yield* t.run_due();
	});

describe('a paid day’s clock corrected', () => {
	it.live('the clock-out corrected so the overtime goes, and a missed punch added: as B', () => {
		const right = (t: Kit) => punched(OVERTIME_DAY)(t).pipe(Effect.andThen(punched(MISSED_DAY)(t)));
		return parity(clocked(), { wrong: nothing, correct: right, right });
	});
});

// ---- an exit --------------------------------------------------------------------------------------------------------

describe('a leave day corrected after the exit payslip was paid', () => {
	const LAST = '2026-02-28';
	const LEAVE_DAY = '2026-02-10';
	const left = (t: Kit) =>
		accountsIn(t).pipe(
			Effect.map(
				(accounts) =>
					measureOf(accounts, 'leave', 'ANNUAL_LEAVE', 'entitled') -
					measureOf(accounts, 'leave', 'ANNUAL_LEAVE', 'used')
			)
		);
	const ended = (t: Kit) =>
		Effect.gen(function* () {
			const target = yield* current(t, 'employee_contract', EMPLOYMENT);
			const [held] = (yield* versions(t)).filter((row) => row.id === EMPLOYMENT);
			assert.ok(held !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'employee_contract.update': [
					{
						target,
						set: {
							effective_range: { from: held.effective_range.from, to: LAST },
							reason: 'Resignation'
						}
					}
				]
			});
			yield* t.run_due();
		});
	const seed = rostered(['2026-02']);
	const now = at('2026-03');

	it.live(
		'the day deleted: an off-cycle run pays out the day the encashment missed, the balance ends at zero, as B',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const day = yield* keyed(t, 'ANNUAL_LEAVE', [LEAVE_DAY]);
				yield* ended(t);
				yield* pay(t, '2026-02');
				assert.equal(yield* left(t), 0, 'the last payslip settled the leave');
				const last = yield* slip(t, '2026-02');
				yield* removed(t, day);
				const open = (yield* amendments(t)).filter((row) => row.payroll_run_id === null);
				assert.deepEqual(
					open.map((row) => row.period),
					['2026-02']
				);
				// nobody's on-cycle run pays them any more: an off-cycle run carries the waiting period
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.create': [
						{
							entity_id: ENTITY,
							period: '2026-03',
							kind: 'OFF_CYCLE',
							amendments: open.map(({ id, revision }) => ({ id, revision }))
						}
					]
				});
				yield* t.run_due();
				assert.ok(((yield* carriedFor(t, '2026-03', '2026-02'))['ANNUAL_LEAVE/EMPLOYEE'] ?? 0) > 0);
				assert.deepEqual(yield* slip(t, '2026-02'), last, 'the paid payslip stands');
				assert.equal(yield* left(t), 0, 'the day returned is paid out and used');
				yield* settledOnce(t);
				return yield* outcome(t, ['2026-02', '2026-03']);
			}).pipe(
				Effect.provide(workspace({ seed, now })),
				Effect.flatMap((corrected) =>
					Effect.gen(function* () {
						const t = yield* TestWorkspace;
						yield* syncAll(t);
						yield* ended(t);
						yield* pay(t, '2026-02');
						assert.equal(yield* left(t), 0);
						return yield* outcome(t, ['2026-02']);
					}).pipe(
						Effect.provide(workspace({ seed, now })),
						Effect.map((never) => assert.deepEqual(corrected, never))
					)
				)
			)
	);
});

// ---- allowances -----------------------------------------------------------------------------------------------------

/** The Malaysian rows price `terms.allowances.<code>.amount` by the days employed and the paid share, and SUA is in the rate. */
type Allowances = Readonly<Record<string, { readonly amount: number }>>;
/** The seed with these agreed allowances on its one contract. */
const allowing = (allowances: Allowances, base: Seed = rostered(MONTHS)): Seed => ({
	...base,
	employee_contract: (base.employee_contract ?? []).map((row) => ({
		...row,
		...(isJsonObject(row.terms) ? { terms: { ...row.terms, allowances } } : {})
	}))
});
const openVersion = (t: Kit) =>
	versions(t).pipe(
		Effect.map((rows) => {
			const held = rows.find((row) => row.status === 'SEALED' && row.effective_range.to === null);
			assert.ok(held !== undefined, 'No open version');
			return held;
		})
	);
/** The agreed allowances corrected by a version over the paid months, made the way HR makes one. */
const allowed = (allowances: Allowances) => (t: Kit) =>
	openVersion(t).pipe(
		Effect.flatMap((held) => factsFrom('2026-01-01', { terms: { ...held.terms, allowances } })(t))
	);
/**
 * The version itself replaced over its own days (mistakes.test.ts, 'a contract version sealed with a wrong term'). A
 * joiner's version starts mid-month, so no successor from the first can correct it, and a mid-month draft is refused
 * while a sealed version reaches the day before (employee_contract `startsMidMonth`): the wrong one is voided first,
 * then the replacement drafted and sealed. With no version left in between, nothing reads as an exit.
 */
const replaced = (allowances: Allowances) => (t: Kit) =>
	Effect.gen(function* () {
		const admin = yield* t.as(t.admin);
		const held = yield* openVersion(t);
		yield* admin.act({
			'employee_contract.update': [
				{ target: held, set: { status: 'VOID', reason: 'Keyed with the wrong allowances' } }
			]
		});
		yield* t.run_due();
		yield* admin.act({
			'employee_contract.create': [
				{
					employee_id: held.employee_id,
					entity_id: held.entity_id,
					engagement: held.engagement,
					employee_number: held.employee_number,
					terms: { ...held.terms, allowances },
					payroll: held.payroll,
					bank: held.bank,
					family: held.family,
					employee_extension_data: held.employee_extension_data,
					service_started_on: held.service_started_on,
					effective_range: { from: held.effective_range.from, to: null },
					status: 'DRAFT',
					reason: 'The agreed allowances'
				}
			]
		});
		const draft = (yield* versions(t)).find((row) => row.status === 'DRAFT');
		assert.ok(draft !== undefined, 'No draft version');
		yield* admin.act({
			'employee_contract.update': [
				{ target: yield* current(t, 'employee_contract', draft.id), set: { status: 'SEALED' } }
			]
		});
		yield* t.run_due();
	});
const SUA = (amount: number): Allowances => ({ SUA: { amount } });
const NONE: Allowances = {};

describe('an agreed allowance corrected after its month was paid', () => {
	it.live('missing from the paid month: added, the next payslip carries it, as B', () => {
		const right = allowed(SUA(300));
		return parity(allowing(NONE), { wrong: nothing, correct: right, right });
	});

	for (const [was, is] of [
		[200, 300],
		[300, 200]
	] as const)
		it.live(`${was} corrected to ${is}: the next payslip carries the difference, as B`, () => {
			const right = allowed(SUA(is));
			return parity(allowing(SUA(was)), { wrong: nothing, correct: right, right });
		});

	it.live('paid but not agreed: removed, the next payslip takes it back, as B', () => {
		const right = allowed(NONE);
		return parity(allowing(SUA(300)), { wrong: nothing, correct: right, right });
	});

	// SUA is `include_in_rate`: it moves the wage the day rate divides. The no-pay day itself takes the salary's share of
	// that rate (engine.ts `nplUnit`), and the allowance loses its own share through `ctx.paid_share` on its own line.
	it.live(
		'in a month with a no-pay day: the day and the allowance’s share are worked out again, as B',
		() =>
			parity(allowing(NONE), {
				wrong: (t) => keyed(t, 'NPL', NPL_DAYS.slice(0, 1)),
				correct: (t) => allowed(SUA(300))(t),
				right: (t) =>
					keyed(t, 'NPL', NPL_DAYS.slice(0, 1)).pipe(Effect.andThen(allowed(SUA(300))(t)))
			})
	);

	// the hour overtime pays divides the wage SUA is part of: the clocked overtime is priced again on the new hour
	it.live(
		'in a month with overtime: the hour rate moves and the overtime is priced again, as B',
		() => {
			const right = allowed(SUA(300));
			return parity(allowing(NONE, rostered(MONTHS, OVERTIME_DAY)), {
				wrong: nothing,
				correct: right,
				right
			});
		}
	);

	// every Malaysian allowance row prices `amount × calendar days ÷ month days × ctx.paid_share`: a joiner's month
	const HIRED = '2026-01-12';
	const joiner = (allowances: Allowances): Seed => {
		const base = allowing(allowances);
		return {
			...base,
			employee_contract: (base.employee_contract ?? []).map((row) => ({
				...row,
				effective_range: { from: HIRED, to: null }
			})),
			roster_entry: (base.roster_entry ?? []).filter((row) => String(row.work_date) >= HIRED)
		};
	};
	it.live('a joiner’s first month: the added allowance takes the days employed, as B', () => {
		const right = replaced(SUA(300));
		return parity(joiner(NONE), { wrong: nothing, correct: right, right });
	});
});
