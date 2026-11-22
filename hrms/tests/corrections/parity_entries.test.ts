// Parity tests for leave edits, exit leave settlement, law/loan corrections and multi-record correction mixes.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	EMPLOYMENT,
	amendments,
	carriedFor,
	pay,
	raisedFrom,
	rostered,
	slip
} from '../amendment_kit.ts';
import {
	ENTITY,
	accountsIn,
	current,
	endStint,
	measureOf,
	storedQuery,
	syncAll,
	uuid,
	workspace
} from '../kit.ts';
import {
	MONTHS,
	NPL_DAYS,
	STINT,
	at,
	awarded,
	bornEarlier,
	claimed,
	contractHour,
	holidayDeclared,
	keyed,
	lengthened,
	nothing,
	outcome,
	parity,
	removed,
	rosterDayGone,
	settledOnce,
	shortened,
	wrote,
	type Seed,
	type Step
} from './parity_kit.ts';

// ---- leave ----------------------------------------------------------------------------------------------------------

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

// ---- the law, and a loan --------------------------------------------------------------------------------------------

/** The law's overtime premium raised from a day of January: a run prices on the law of its pay date. */
const premiumRaised = (t: Kit) =>
	wrote(t, (hr) =>
		hr.act({
			'jurisdiction_change.create': [
				{
					jurisdiction_code: 'MY',
					effective_from: '2026-01-15',
					law: { overtime_catalog: { OVERTIME: { lookup: { standard_premium: 2 } } } }
				}
			]
		})
	);
const LOAN = idOf('loan_catalog_entry', uuid(300));
/** A festive advance repaid from January. */
const lent = (): Seed => ({
	...rostered(MONTHS),
	loan_catalog_entry: [
		{
			id: LOAN,
			entity_id: ENTITY,
			employment_id: EMPLOYMENT,
			catalog_code: 'LOAN_RECOVERY_FESTIVE_ADVANCE',
			quantity: 6000,
			repayment_period: { from: '2026-01-01', to: '2026-06-30' }
		}
	]
});
/** An instalment dated in January; answers it. */
const instalment = (t: Kit, amount: number) =>
	Effect.gen(function* () {
		yield* wrote(t, (hr) =>
			hr.act({
				'loan_catalog_entry_repayment.create': [
					{
						entity_id: ENTITY,
						employment_id: STINT,
						loan_id: LOAN,
						amount: String(amount),
						paid_on: '2026-01-10'
					}
				]
			})
		);
		const [made] = (yield* storedQuery(t, { loan_catalog_entry_repayment: { limit: 10 } }))
			.loan_catalog_entry_repayment.rows;
		assert.ok(made !== undefined, 'No instalment');
		return made.id;
	});

describe('the law or a loan corrected after its month was paid', () => {
	it.live('a change of law dated in the paid month: the overtime is priced again, as B', () =>
		parity(rostered(MONTHS, '2026-01-20'), {
			wrong: nothing,
			correct: premiumRaised,
			right: premiumRaised
		})
	);
	it.live('a loan instalment’s amount: the next payslip carries the difference, as B', () =>
		parity(lent(), {
			wrong: (t) => instalment(t, 100),
			correct: (t, id) =>
				Effect.gen(function* () {
					const target = yield* current(t, 'loan_catalog_entry_repayment', id);
					yield* wrote(t, (hr) =>
						hr.act({ 'loan_catalog_entry_repayment.update': [{ target, set: { amount: '50' } }] })
					);
				}),
			right: (t) => instalment(t, 50)
		})
	);
	it.live('a loan instalment that never was: deleted, the next payslip gives it back, as B', () =>
		parity(lent(), {
			wrong: (t) => instalment(t, 100),
			correct: (t, id) =>
				Effect.gen(function* () {
					const target = yield* current(t, 'loan_catalog_entry_repayment', id);
					yield* wrote(t, (hr) => hr.act({ 'loan_catalog_entry_repayment.delete': [{ target }] }));
				}),
			right: nothing
		})
	);
	it.live('a loan that never was: deleted with its instalment, as B', () =>
		parity(lent(), {
			wrong: (t) => instalment(t, 100),
			correct: (t) =>
				Effect.gen(function* () {
					const target = yield* current(t, 'loan_catalog_entry', LOAN);
					yield* wrote(t, (hr) => hr.act({ 'loan_catalog_entry.delete': [{ target }] }));
				}),
			right: (t) =>
				Effect.gen(function* () {
					const target = yield* current(t, 'loan_catalog_entry', LOAN);
					yield* wrote(t, (hr) => hr.act({ 'loan_catalog_entry.delete': [{ target }] }));
				})
		})
	);
});

// ---- several corrections at once ------------------------------------------------------------------------------------

/** Corrections that touch different records and days of January: any of them, in any order. */
const MENU: Readonly<Record<string, Step<unknown>>> = {
	claim: (t) => claimed(t, 80),
	award: (t) => awarded(t, 'BONUS', 500),
	no_pay_leave: (t) => keyed(t, 'NPL', NPL_DAYS),
	day_not_worked: (t) => rosterDayGone(t, '2026-01-22'),
	holiday: holidayDeclared,
	raise: (t) => raisedFrom(t, '2026-01-01', 3100),
	company_hour: contractHour,
	date_of_birth: bornEarlier
};
/** A mix of the menu, the same on every run of one `seed`: at least three, in a shuffled order. */
const mix = (seed: number) => {
	let state = seed;
	const next = () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	const shuffled = Object.keys(MENU)
		.map((name) => [next(), name] as const)
		.toSorted(([left], [right]) => left - right)
		.map(([, name]) => name);
	return shuffled.slice(0, 3 + Math.floor(next() * (shuffled.length - 2)));
};
const all =
	(names: readonly string[]): Step<void> =>
	(t) =>
		Effect.gen(function* () {
			for (const name of names) yield* MENU[name]?.(t) ?? Effect.void;
		});

describe('several records corrected at once after their month was paid', () => {
	for (const seed of [3, 29, 71, 404]) {
		const names = mix(seed);
		it.live(`mix ${seed} (${names.join(', ')}): paid in all what a never-wrong history pays`, () =>
			parity(rostered(MONTHS, '2026-01-20'), {
				wrong: nothing,
				correct: all(names),
				// keyed before anything was paid, in the opposite order: the order they are made in does not matter
				right: all(names.toReversed())
			})
		);
	}
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
	const ended = (t: Kit) => endStint(t, LAST, 'Resignation').pipe(Effect.andThen(t.run_due()));
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
