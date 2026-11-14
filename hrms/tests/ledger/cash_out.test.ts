// A cash-out settles days a leave row holds in money: the entry draws the balance as it is written and the next run,
// whatever the entry's dates, pays the row's `payout` once. A day in lieu is such a balance, granted by HR's manual
// adjustment; a holiday named to one person is the other kind and is a calendar row. Synthetic: the in-lieu row pays a
// flat 100 a day, so no law's rate is under test.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { verify } from '../../src/lib/integrity.ts';
import { jsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { pay, run } from '../amendment_kit.ts';
import {
	ENTITY,
	accountsIn,
	leaveCreate,
	ledgerRows,
	measureOf,
	lawWith,
	pack,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	refusal,
	storedQuery,
	decimalNumber,
	packTerms
} from '../kit.ts';

/** The half-day slots a leave entry holds. */
const slotsOf = (t: Kit, entry: Id<'leave_catalog_entry'>) =>
	storedQuery(t, {
		leave_catalog_entry_day: {
			where: { leave_entry_id: { eq: entry } },
			fields: ['incurred_on', 'part'],
			limit: 100
		}
	}).pipe(
		Effect.map(({ leave_catalog_entry_day }) =>
			leave_catalog_entry_day.rows.map((row) => ({
				date: String(row.incurred_on),
				part: row.part
			}))
		)
	);

const NOW = '2026-08-20T02:00:00.000Z';
const IN_LIEU = 'PUBLIC_HOLIDAY_IN_LIEU';
const PAYOUT = 100;
const EMPLOYMENT = idOf('employment', uuid(6));
const BALANCE = idOf('employee_balance', uuid(5));
const TERMS = packTerms(3120, 'MANUAL_LABOUR');
type Seed = ReturnType<typeof pack>;
/** The in-lieu row pays a flat amount a day, from the law's first day on. */
const flat = (seed: Seed): Seed =>
	lawWith(seed, {
		leave_catalog: { [IN_LIEU]: { payout: `return ${PAYOUT} * ctx.entry.quantity;` } }
	});
const seed = flat(pack('MY', 'Asia/Kuala_Lumpur', TERMS, {}, [], []));
/** A business refusal's text: the passthrough key the ledger's refusals travel under. */
const refused = <A, E>(effect: Effect.Effect<A, E>) =>
	refusal(effect).pipe(
		Effect.map((error) => {
			assert.equal(error.key, 'errors.payroll_refused');
			return error.message;
		})
	);

/** HR grants days on a leave row by hand, as the employee profile does. */
const grant = (t: Kit, days: number, on = '2026-08-03') =>
	t.as(t.member(['hr_controller'])).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'ledger_entry.create': [
					{
						balance_id: BALANCE,
						operation: 'ADD',
						account: 'leave',
						code: IN_LIEU,
						measure: 'entitled',
						amount: String(days),
						unit: 'DAY',
						effective_on: on,
						note: 'worked the holiday'
					}
				]
			})
		)
	);
/** A leave entry on a row, a cash-out unless told otherwise. */
const enter = (
	t: Kit,
	code: string,
	dates: readonly string[],
	options: { encashment?: boolean } = {}
) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'leave_catalog_entry.create': [
				leaveCreate({
					entity_id: ENTITY,
					employment_id: EMPLOYMENT,
					catalog_code: code,
					encashment: options.encashment ?? true,
					days: wholeDays(...dates)
				})
			]
		});
		yield* t.run_due();
	});
const cashOut = (t: Kit, ...dates: readonly string[]) => enter(t, IN_LIEU, dates);
/** The open amendment rows' periods. */
const amended = (t: Kit) =>
	storedQuery(t, {
		pay_amendment: { where: { payroll_run_id: { is_null: true } }, limit: 100 }
	}).pipe(Effect.map(({ pay_amendment }) => pay_amendment.rows.map((row) => row.period)));
/** What every line of `paid` comes to, a deduction negative. */
const net = (lines: readonly (readonly unknown[])[]) =>
	lines.reduce(
		(total, [, direction, amount]) => total + (direction === 'DEDUCT' ? -1 : 1) * Number(amount),
		0
	);
/** Every payslip line of a code, in period order: `[period, direction, amount, days]`. */
const paid = (t: Kit, code = IN_LIEU) =>
	storedQuery(t, { payslip: { limit: 100 } }).pipe(
		Effect.map(({ payslip }) =>
			payslip.rows
				.toSorted((left, right) => String(left.period).localeCompare(String(right.period)))
				.flatMap((slip) =>
					Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown)
						.lines.filter((line) => line.code === code)
						.map((line) => [slip.period, line.direction, line.amount, line.quantity])
				)
		)
	);
const held = (t: Kit, code = IN_LIEU) =>
	accountsIn(t).pipe(
		Effect.map((accounts) => ({
			entitled: measureOf(accounts, 'leave', code, 'entitled'),
			used: measureOf(accounts, 'leave', code, 'used')
		}))
	);
const entries = (t: Kit) =>
	storedQuery(t, { leave_catalog_entry: { limit: 100 } }).pipe(
		Effect.map(({ leave_catalog_entry }) => leave_catalog_entry.rows)
	);
/** What one entry's own postings have drawn of `used`, net. */
const drawnBy = (t: Kit, entry: string) =>
	ledgerRows(t).pipe(
		Effect.map((rows) =>
			rows
				.filter((row) => row.source === `leave_catalog_entry:${entry}` && row.measure === 'used')
				.reduce(
					(total, row) =>
						total + (row.operation === 'DEDUCT' ? -1 : 1) * (decimalNumber(row.amount) ?? 0),
					0
				)
		)
	);

describe('a cash-out of days HR granted', () => {
	it.live('draws the balance as it is entered and the next run pays days × payout, once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* grant(t, 2);
			yield* cashOut(t, '2026-08-05', '2026-08-06');
			// the entry posts, not the run: the days are gone before anything is paid
			assert.deepEqual(yield* held(t), { entitled: 2, used: 2 });
			assert.deepEqual(yield* paid(t), []);
			yield* run(t, '2026-08');
			assert.deepEqual(yield* paid(t), [['2026-08', 'ADD', 2 * PAYOUT, 2]]);
			assert.deepEqual(yield* held(t), { entitled: 2, used: 2 });
			// a later run finds nothing left to pay
			yield* run(t, '2026-09');
			assert.deepEqual(yield* paid(t), [['2026-08', 'ADD', 2 * PAYOUT, 2]]);
			assert.deepEqual(yield* held(t), { entitled: 2, used: 2 });
			const [entry] = yield* entries(t);
			assert.ok(entry !== undefined);
			assert.equal(yield* drawnBy(t, entry.id), 2);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'is unpaid until a run takes it: its dates are placeholders, so a paid period is not amended, and it is paid once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* grant(t, 1);
				yield* pay(t, '2026-08');
				// its dates only place the days in a balance window: the next run pays it as its own
				yield* cashOut(t, '2026-08-05');
				assert.deepEqual(yield* amended(t), []);
				assert.deepEqual(yield* paid(t), []);
				yield* run(t, '2026-09');
				assert.deepEqual(yield* amended(t), []);
				assert.equal(net(yield* paid(t)), PAYOUT);
				yield* run(t, '2026-10');
				assert.equal(net(yield* paid(t)), PAYOUT);
				assert.deepEqual(yield* held(t), { entitled: 1, used: 1 });
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('for more days than the row holds is refused and posts nothing; granted, it goes', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			// nothing held at all, then one day held and two asked
			assert.match(yield* refused(cashOut(t, '2026-08-05')), /insufficient balance/);
			yield* grant(t, 1);
			assert.match(
				yield* refused(cashOut(t, '2026-08-05', '2026-08-06')),
				/PUBLIC_HOLIDAY_IN_LIEU: insufficient balance/
			);
			assert.deepEqual(yield* held(t), { entitled: 1, used: 0 });
			assert.deepEqual(yield* entries(t), []);
			// the way out is HR's: the missing day granted, the same cash-out is accepted
			yield* grant(t, 1);
			yield* cashOut(t, '2026-08-05', '2026-08-06');
			yield* run(t, '2026-08');
			assert.deepEqual(yield* paid(t), [['2026-08', 'ADD', 2 * PAYOUT, 2]]);
			// and the row is empty again: a third day has nothing to draw
			assert.match(yield* refused(cashOut(t, '2026-08-07')), /insufficient balance/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('on a row with no payout is refused: nothing is drawn that no run can pay', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			// medical leave holds days after sync and declares no payout, so it is not cashable
			const before = yield* held(t, 'MEDICAL_LEAVE');
			assert.ok(before.entitled > 0);
			assert.match(yield* refused(enter(t, 'MEDICAL_LEAVE', ['2026-08-05'])), /payout|cash/i);
			assert.deepEqual(yield* held(t, 'MEDICAL_LEAVE'), before);
			assert.deepEqual(yield* entries(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a cash-out whose days fall past the run window', () => {
	// a mid-month cutoff ends the September run's attendance on 9 September, so the second day lies past it
	const late: Seed = {
		...seed,
		pay_group: (seed.pay_group ?? []).map((row) => ({
			...row,
			payment_schedule: { ...jsonObject(row.payment_schedule), pay_cutoff_day: 10 }
		}))
	};
	it.live('is priced whole by the next run, which seals every slot and draws what it pays', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* grant(t, 2);
			yield* enter(t, IN_LIEU, ['2026-08-28', '2026-09-14']);
			yield* run(t, '2026-09');
			assert.deepEqual(yield* paid(t), [['2026-09', 'ADD', 2 * PAYOUT, 2]]);
			const [entry] = yield* entries(t);
			assert.ok(entry !== undefined);
			assert.equal(yield* drawnBy(t, entry.id), 2);
			const { leave_catalog_entry_day } = yield* storedQuery(t, {
				leave_catalog_entry_day: {
					where: { leave_entry_id: { eq: entry.id } },
					fields: ['payroll_run_id'],
					limit: 100
				}
			});
			assert.equal(leave_catalog_entry_day.rows.length, 4);
			assert.ok(leave_catalog_entry_day.rows.every((row) => row.payroll_run_id != null));
		}).pipe(Effect.provide(workspace({ seed: late, now: '2026-09-24T02:00:00.000Z' })))
	);
});

describe('a cash-out deleted', () => {
	it.live('before any run has paid it, the days come back and nothing is paid', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* grant(t, 2);
			yield* cashOut(t, '2026-08-05', '2026-08-06');
			const [open] = yield* entries(t);
			assert.ok(open !== undefined);
			yield* (yield* t.as(t.admin)).act({ 'leave_catalog_entry.delete': [{ target: open }] });
			yield* t.run_due();
			assert.deepEqual(yield* held(t), { entitled: 2, used: 0 });
			assert.equal(yield* drawnBy(t, open.id), 0);
			assert.deepEqual(yield* amended(t), []);
			yield* run(t, '2026-08');
			assert.deepEqual(yield* paid(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'after payment, the days come back at once, its period is amended and the next run takes the payout back',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* grant(t, 2);
				yield* cashOut(t, '2026-08-05', '2026-08-06');
				yield* pay(t, '2026-08');
				const [original] = yield* entries(t);
				assert.ok(original !== undefined);
				assert.ok(original.payroll_run_id != null);
				yield* (yield* t.as(t.admin)).act({ 'leave_catalog_entry.delete': [{ target: original }] });
				yield* t.run_due();
				// the movement is undone at once; the money follows in the next run, and the paid payslip stands
				assert.deepEqual(yield* held(t), { entitled: 2, used: 0 });
				assert.equal(yield* drawnBy(t, original.id), 0);
				assert.deepEqual(yield* amended(t), ['2026-08']);
				assert.deepEqual(yield* paid(t), [['2026-08', 'ADD', 2 * PAYOUT, 2]]);
				yield* run(t, '2026-09');
				assert.deepEqual(yield* amended(t), []);
				assert.equal(net(yield* paid(t)), 0);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

// The two ways a day in lieu exists: a balance HR grants (taken as leave or cashed out), and a holiday named to one
// person. Both on one person and one date, the day is still paid once.
describe('a day in lieu held both ways for one person and date', () => {
	const DAY = '2026-02-10';
	const FEBRUARY = '2026-02-20T02:00:00.000Z';
	const base = flat(pack('MY', 'Asia/Kuala_Lumpur', TERMS, {}, [], []));
	const named = flat(
		pack('MY', 'Asia/Kuala_Lumpur', TERMS, {}, [], [{ date: DAY, kind: 'PUBLIC_HOLIDAY' }])
	);
	const theirs: Seed = {
		...named,
		holiday: (named.holiday ?? []).map((row) => ({ ...row, employee_id: uuid(4) }))
	};
	/** February's payslip lines by code, after what `before` enters. */
	const february = (from: Seed, before: (t: Kit) => Effect.Effect<unknown, unknown>) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* before(t);
			yield* run(t, '2026-02');
			const [slip, ...more] = (yield* storedQuery(t, { payslip: { limit: 10 } })).payslip.rows;
			assert.equal(more.length, 0);
			return {
				lines: Object.fromEntries(
					Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown).lines.map((line) => [
						line.code,
						(line.direction === 'DEDUCT' ? -1 : 1) * line.amount
					])
				),
				used: (yield* held(t)).used
			};
		}).pipe(Effect.provide(workspace({ seed: from, now: FEBRUARY })));

	it.live('taken as leave on their own holiday, the month pays what it pays without either', () =>
		Effect.gen(function* () {
			const plain = yield* february(base, () => Effect.void);
			const holiday = yield* february(theirs, () => Effect.void);
			const both = yield* february(theirs, (t) =>
				grant(t, 1, '2026-02-02').pipe(
					Effect.andThen(enter(t, IN_LIEU, [DAY], { encashment: false }))
				)
			);
			assert.deepEqual(holiday.lines, plain.lines);
			assert.deepEqual(both.lines, plain.lines);
			assert.equal(both.lines[IN_LIEU], undefined);
		})
	);

	it.live('cashed out on their own holiday, the payout is the only line added, once', () =>
		Effect.gen(function* () {
			const plain = yield* february(base, () => Effect.void);
			const both = yield* february(theirs, (t) =>
				grant(t, 1, '2026-02-02').pipe(Effect.andThen(enter(t, IN_LIEU, [DAY])))
			);
			// the payout is the one new line; the schemes that count it as wages follow it, and nothing else appears
			assert.deepEqual(
				Object.keys(both.lines).toSorted(),
				[...Object.keys(plain.lines), IN_LIEU].toSorted()
			);
			assert.equal(both.lines[IN_LIEU], PAYOUT);
			assert.equal(both.lines.BASIC, plain.lines.BASIC);
			assert.equal(both.used, 1);
		})
	);
});
