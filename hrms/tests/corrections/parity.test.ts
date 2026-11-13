// Every change that alters a paid month, corrected at its source after the month was paid, reconciles on the next
// payslip: a history that paid January wrong, corrected the source and ran February has paid in all exactly what a
// history that was right before January paid, line by line, and its leave ledger ends the same. Ledger work run again
// changes nothing. So does any sequence of adds, edits, moves and deletes on the person's terms rows. The Malaysian
// pack is only the fixture; every figure compared is one the system produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { DateTime, Effect } from 'effect';
import { verify } from '../../src/lib/integrity.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	EMPLOYMENT,
	amendments,
	carriedFor,
	paidInAll,
	pay,
	raisedFrom,
	rostered,
	run,
	slip
} from '../amendment_kit.ts';
import {
	ENTITY,
	PARAMETERS,
	TERMS,
	accountsIn,
	current,
	lawAt,
	leaveCreate,
	ledgerRows,
	measureOf,
	projection,
	storedQuery,
	storedReader,
	syncAll,
	uuid,
	wholeDays,
	workspace
} from '../kit.ts';

type Seed = ReturnType<typeof rostered>;
type Step<A> = (t: Kit) => Effect.Effect<A, unknown, never>;
/** January is paid wrong; February's run carries the correction. No change of law falls between them. */
const MONTHS = ['2026-01', '2026-02'] as const;
const at = (month: string) => `${month}-20T02:00:00.000Z`;
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

// ---- the person's facts ---------------------------------------------------------------------------------------------

/** The spouse the seed keys: the pack's first dependant. */
const SPOUSE = idOf('dependant', uuid(40));
const reliefs = (children: Readonly<Record<string, number>>) => ({ statutory: { PCB: children } });
/** A married earner whose PCB the family and the declared child reliefs move. */
const married = (has_income: boolean, children: Readonly<Record<string, number>>): Seed => {
	const base = rostered(MONTHS, undefined, 8000);
	return {
		...base,
		employee_profile: (base.employee_profile ?? []).map((row) => ({
			...row,
			date_of_birth: '1985-01-01'
		})),
		statutory_parameters: (base.statutory_parameters ?? []).map((row) => ({
			...row,
			marital_status: 'MARRIED',
			parameters: reliefs(children)
		})),
		dependant: [{ id: SPOUSE, employee_id: uuid(4), relation: 'SPOUSE', has_income }]
	};
};
/** A dependant is corrected on its own row: whether the spouse has an income. */
const spouseEarns = (has_income: boolean) => (t: Kit) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'dependant.update': [{ target: yield* current(t, 'dependant', SPOUSE), set: { has_income } }]
		});
		yield* t.run_due();
	});
/** What the law was told since the hire is corrected on the row that set it: the first parameters row. */
const declared = (children: Readonly<Record<string, number>>) => (t: Kit) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'statutory_parameters.update': [
				{
					target: yield* current(
						t,
						'statutory_parameters',
						idOf('statutory_parameters', PARAMETERS)
					),
					set: { parameters: reliefs(children) }
				}
			]
		});
		yield* t.run_due();
	});
const nothing = () => Effect.void;

describe('a fact of the person corrected after its month was paid', () => {
	for (const [was, is] of [
		[true, false],
		[false, true]
	] as const)
		it.live(
			`spouse ${was ? 'with' : 'without'} income corrected to ${is ? 'with' : 'without'}: the next payslip carries the PCB difference`,
			() => {
				const right = spouseEarns(is);
				return parity(married(was, {}), { wrong: nothing, correct: right, right });
			}
		);

	for (const [was, is] of [
		[1, 2],
		[2, 1]
	] as const)
		it.live(
			`children corrected from ${was} to ${is}: the next payslip carries the difference`,
			() => {
				const right = declared({ children_under_18_or_studying: is });
				return parity(married(true, { children_under_18_or_studying: was }), {
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
			const { employment } = yield* storedQuery(t, {
				employment: { where: { id: { eq: EMPLOYMENT } }, limit: 1 }
			});
			const [held] = employment.rows;
			assert.ok(held !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'employment.update': [
					{
						target: held,
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
/** The seed with these agreed allowances on the hire's terms. */
const allowing = (allowances: Allowances, base: Seed = rostered(MONTHS)): Seed => ({
	...base,
	contract_terms: (base.contract_terms ?? []).map((row) => ({ ...row, allowances }))
});
/** The agreed allowances were wrong since the hire: corrected on the row that set them, the first terms row. */
const allowed = (allowances: Allowances) => (t: Kit) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'contract_terms.update': [
				{
					target: yield* current(t, 'contract_terms', idOf('contract_terms', TERMS)),
					set: { allowances }
				}
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

	// every Malaysian allowance row prices `amount × calendar days ÷ month days × ctx.paid_share`: a joiner's month. The
	// stint starts mid-month, and its first rows are dated its first day
	const HIRED = '2026-01-12';
	const joiner = (allowances: Allowances): Seed => {
		const base = allowing(allowances);
		return {
			...base,
			employment: (base.employment ?? []).map((row) => ({
				...row,
				effective_range: { from: HIRED, to: null }
			})),
			contract_terms: (base.contract_terms ?? []).map((row) => ({ ...row, effective_from: HIRED })),
			statutory_parameters: (base.statutory_parameters ?? []).map((row) => ({
				...row,
				effective_from: HIRED
			})),
			roster_entry: (base.roster_entry ?? []).filter((row) => String(row.work_date) >= HIRED)
		};
	};
	it.live('a joiner’s first month: the added allowance takes the days employed, as B', () => {
		const right = allowed(SUA(300));
		return parity(joiner(NONE), { wrong: nothing, correct: right, right });
	});
});

// ---- any sequence of changes to the terms ---------------------------------------------------------------------------

/** January and February are paid before the terms move; March's run carries what they now owe. */
const THREE = ['2026-01', '2026-02', '2026-03'] as const;
const HIRE = '2025-01-01';
/** The rate `rostered` hires on. */
const RATE = 2800;
const FIRSTS = ['2026-01-01', '2026-02-01', '2026-03-01'];
type Change =
	| { readonly kind: 'add' | 'edit'; readonly on: string; readonly amount: number }
	| { readonly kind: 'move'; readonly on: string; readonly to: string }
	| { readonly kind: 'delete'; readonly on: string };
/**
 * A sequence of changes to a person's rate rows, the same on every run of one `seed`, and the rate each date holds
 * after them. The hire's row is only ever edited; a raise is added on a free first of a month, edited, moved to a free
 * one or deleted.
 */
const sequence = (seed: number, length: number) => {
	let state = seed;
	const next = () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)];
	const rates = new Map([[HIRE, RATE]]);
	const changes: Change[] = [];
	while (changes.length < length) {
		const kind = pick(['add', 'edit', 'move', 'delete'] as const);
		const amount = 2600 + 50 * Math.floor(next() * 16);
		const raise = pick([...rates.keys()].filter((on) => on !== HIRE));
		const free = pick(FIRSTS.filter((on) => !rates.has(on)));
		const held = pick([...rates.keys()]);
		if (kind === 'add' && free !== undefined) {
			rates.set(free, amount);
			changes.push({ kind, on: free, amount });
		} else if (kind === 'edit' && held !== undefined) {
			rates.set(held, amount);
			changes.push({ kind, on: held, amount });
		} else if (kind === 'move' && raise !== undefined && free !== undefined) {
			rates.set(free, rates.get(raise) ?? amount);
			rates.delete(raise);
			changes.push({ kind, on: raise, to: free });
		} else if (kind === 'delete' && raise !== undefined) {
			rates.delete(raise);
			changes.push({ kind, on: raise });
		}
	}
	return { changes, rates };
};
/** One change, made on the row itself. */
const changed = (t: Kit, change: Change) =>
	Effect.gen(function* () {
		if (change.kind === 'add') return yield* raisedFrom(t, change.on, change.amount);
		const { contract_terms } = yield* storedQuery(t, {
			contract_terms: { where: { effective_from: { eq: change.on } }, limit: 1 }
		});
		const [target] = contract_terms.rows;
		assert.ok(target !== undefined, `No terms row on ${change.on}`);
		const admin = yield* t.as(t.admin);
		if (change.kind === 'delete') yield* admin.act({ 'contract_terms.delete': [{ target }] });
		else
			yield* admin.act({
				'contract_terms.update': [
					{
						target,
						set:
							change.kind === 'move'
								? { effective_from: change.to }
								: { rate: { amount: change.amount, unit: 'MONTHLY' } }
					}
				]
			});
		yield* t.run_due();
	});

describe('any sequence of changes to a paid person’s terms', () => {
	// 11 ends where it began; 202 moves a raise between months and leaves one on each
	for (const seed of [11, 47, 202])
		it.live(
			`sequence ${seed} of adds, edits, moves and deletes: every period has been paid what a never-wrong history pays`,
			() => {
				const { changes, rates } = sequence(seed, 6);
				const from = rostered(THREE);
				const now = at(THREE[2]);
				return Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* syncAll(t);
					yield* pay(t, THREE[0]);
					yield* pay(t, THREE[1]);
					const paid = [yield* slip(t, THREE[0]), yield* slip(t, THREE[1])];
					for (const change of changes) yield* changed(t, change);
					const march = yield* run(t, THREE[2]);
					assert.ok(
						(yield* amendments(t)).every((row) => row.payroll_run_id === march.id),
						'March took every row'
					);
					assert.deepEqual(
						[yield* slip(t, THREE[0]), yield* slip(t, THREE[1])],
						paid,
						'the paid payslips stand'
					);
					yield* settledOnce(t);
					return yield* outcome(t, THREE);
				}).pipe(
					Effect.provide(workspace({ seed: from, now })),
					Effect.flatMap((corrected) =>
						Effect.gen(function* () {
							const t = yield* TestWorkspace;
							yield* syncAll(t);
							// the rows as the sequence left them, keyed before anything was paid
							for (const [on, amount] of rates)
								if (on !== HIRE) yield* changed(t, { kind: 'add', on, amount });
								else if (amount !== RATE) yield* changed(t, { kind: 'edit', on, amount });
							yield* pay(t, THREE[0]);
							yield* pay(t, THREE[1]);
							yield* run(t, THREE[2]);
							assert.deepEqual(yield* amendments(t), []);
							return yield* outcome(t, THREE);
						}).pipe(
							Effect.provide(workspace({ seed: from, now })),
							Effect.map((never) => assert.deepEqual(corrected, never))
						)
					)
				);
			}
		);
});
