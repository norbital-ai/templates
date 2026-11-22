// Parity tests for agreed allowances, contract week changes, balance totals and arbitrary sequences of terms edits.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	amendments,
	pay,
	raisedFrom,
	rostered,
	rosteredNeutral,
	run,
	slip
} from '../amendment_kit.ts';
import { TERMS, current, storedQuery, syncAll, workspace } from '../kit.ts';
import {
	MONTHS,
	NPL_DAYS,
	OVERTIME_DAY,
	STINT,
	at,
	keyed,
	nothing,
	outcome,
	parity,
	settledOnce,
	wrote,
	type Seed
} from './parity_kit.ts';

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

// ---- the contract's week --------------------------------------------------------------------------------------------

/** The week agreed again from January, on a terms row of its own. */
const weekAgreed =
	(week: { readonly normal_hours_per_week: number; readonly normal_days_per_week?: number }) =>
	(t: Kit) =>
		wrote(t, (hr) =>
			hr.act({
				'contract_terms.create': [{ employment_id: STINT, effective_from: '2026-01-01', ...week }]
			})
		);
/** The company pays overtime on its own hour, which divides the year's wage by the contract's weekly hours. */
const onContractHour = (seed: Seed): Seed => ({
	...seed,
	entity_change: (seed.entity_change ?? []).map((row) => ({
		...row,
		pay_methods: { overtime_hour_basis: 'CONTRACT_WEEKLY' }
	}))
});

describe('the contract’s hours or days a week corrected after their month was paid', () => {
	// the day and hour rates divide by the contract's week: January's overtime is priced again on the new rate
	it.live(
		'the hours a week, where the company’s hour divides by them: the overtime is priced again, as B',
		() => {
			const right = weekAgreed({ normal_hours_per_week: 40 });
			return parity(onContractHour(rostered(MONTHS, OVERTIME_DAY)), {
				wrong: nothing,
				correct: right,
				right
			});
		}
	);
	it.live(
		'the days a week: the day and hour rates move and the overtime is priced again, as B',
		() => {
			const right = weekAgreed({ normal_hours_per_week: 40, normal_days_per_week: 5 });
			return parity(rostered(MONTHS, OVERTIME_DAY), { wrong: nothing, correct: right, right });
		}
	);
});

// ---- the balance's pay and statutory totals ------------------------------------------------------------------------

describe('what a carry posts to the balance', () => {
	// the neutral law assesses every scheme in the month earned, so nothing is charged on the paying month instead
	it.live(
		'a raise keyed after its month was paid, every scheme assessed when earned: each month’s pay and statutory totals are B’s',
		() => {
			const right = (t: Kit) => raisedFrom(t, '2026-01-01', 3100);
			return parity(rosteredNeutral(MONTHS), {
				wrong: nothing,
				correct: right,
				right,
				money: true
			});
		}
	);
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
