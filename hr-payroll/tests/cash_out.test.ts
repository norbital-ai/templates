// A cash-out settles days a leave row holds in money: the entry draws the balance as it is written and the next run,
// whatever the entry's dates, pays the row's `payout` once. A day in lieu is such a balance, granted by HR's manual
// adjustment; a holiday named to one person is the other kind and is a calendar row. Synthetic: the in-lieu row pays a
// flat 100 a day, so no law's rate is under test.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { verify } from '../src/lib/integrity.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	leaveCreate,
	ledgerRows,
	measureOf,
	pack,
	reversalSlots,
	sealedLeave,
	syncAll,
	uuid,
	wholeDays,
	workspace
} from './kit.ts';

const NOW = '2026-08-20T02:00:00.000Z';
const IN_LIEU = 'PUBLIC_HOLIDAY_IN_LIEU';
const PAYOUT = 100;
const CONTRACT = idOf('employee_contract', uuid(6));
const BALANCE = idOf('employee_balance', uuid(5));
const TERMS = {
	rate: { amount: 3120, unit: 'MONTHLY' },
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
type Seed = ReturnType<typeof pack>;
/** The in-lieu row pays a flat amount a day, on every version of the law the pack holds. */
const flat = (seed: Seed): Seed => ({
	...seed,
	leave_catalog: (seed.leave_catalog ?? []).map((row) =>
		row.code === IN_LIEU ? { ...row, payout: `return ${PAYOUT} * ctx.entry.quantity;` } : row
	)
});
const seed = flat(pack('MY', 'Asia/Kuala_Lumpur', TERMS, {}, [], [], '2026-08-15'));
const rowOf = (from: Seed, code: string) =>
	idOf('leave_catalog', catalogRow(from, 'leave_catalog', code));
const refused = (effect: Effect.Effect<unknown, unknown>) =>
	Effect.flip(effect).pipe(Effect.map(String));

/** HR grants days on a leave row by hand, as the employee profile does. */
const grant = (t: Kit, days: number, on = '2026-08-03') =>
	t.as(t.member(['hr_controller'])).act('ledger_entry.create', [
		{
			balance_id: BALANCE,
			operation: 'ADD',
			account: 'leave',
			code: IN_LIEU,
			measure: 'entitled',
			amount: days,
			unit: 'DAY',
			effective_on: PlainDate(on),
			note: 'worked the holiday'
		}
	]);
/**
 * A leave entry on a row, a cash-out unless told otherwise; with `reverses` it selects the original's slots. A cash-out
 * a policy holds for review is approved by an HR controller, so what the test reads next has posted.
 */
const enter = (
	t: Kit,
	from: Seed,
	code: string,
	dates: readonly string[],
	options: { reverses?: Id<'leave_catalog_entry'>; encashment?: boolean } = {}
) =>
	Effect.gen(function* () {
		const days =
			options.reverses === undefined
				? wholeDays(...dates)
				: yield* reversalSlots(t, options.reverses);
		const result = yield* t.as(t.admin).act('leave_catalog_entry.create', [
			leaveCreate({
				entity_id: ENTITY,
				employment_id: CONTRACT,
				catalog_id: rowOf(from, code),
				encashment: options.encashment ?? true,
				reverses: options.reverses ?? null,
				days
			})
		]);
		if (result.kind === 'pendingApproval')
			yield* t
				.as(t.member(['hr_controller']))
				.approvals.decide(result.requestId, { decision: 'approve' });
		yield* t.runDue();
	});
const cashOut = (t: Kit, ...dates: readonly string[]) => enter(t, seed, IN_LIEU, dates);
const run = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
/** Every payslip line of a code, in period order: `[period, direction, amount, days]`. */
const paid = (t: Kit, code = IN_LIEU) =>
	t.storedQuery({ payslip: { limit: 100 } }).pipe(
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
	t
		.storedQuery({ leave_catalog_entry: { limit: 100 } })
		.pipe(Effect.map(({ leave_catalog_entry }) => leave_catalog_entry.rows));
/** What one entry's own postings have drawn of `used`, net. */
const drawnBy = (t: Kit, entry: string) =>
	ledgerRows(t).pipe(
		Effect.map((rows) =>
			rows
				.filter((row) => row.source === `leave_catalog_entry:${entry}` && row.measure === 'used')
				.reduce(
					(total, row) =>
						total + (row.operation === 'DEDUCT' ? -1 : 1) * (row.amount?.toNumber() ?? 0),
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
			// paid, it is sealed: the way to undo it is a reversal, and the refusal says so
			const entry = yield* sealedLeave(t);
			assert.match(
				yield* refused(t.as(t.admin).act('leave_catalog_entry.delete', [{ target: entry }])),
				/Create a reversal/
			);
			assert.equal(yield* drawnBy(t, entry), 2);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'is unpaid until a run takes it: dated in a period that has run, the next run pays it',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* grant(t, 1);
				yield* run(t, '2026-08');
				// its dates only place the days in a balance window; no attendance window has to hold them
				yield* cashOut(t, '2026-08-05');
				yield* run(t, '2026-09');
				assert.deepEqual(yield* paid(t), [['2026-09', 'ADD', PAYOUT, 1]]);
				yield* run(t, '2026-10');
				assert.deepEqual(yield* paid(t), [['2026-09', 'ADD', PAYOUT, 1]]);
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
			assert.match(yield* refused(enter(t, seed, 'MEDICAL_LEAVE', ['2026-08-05'])), /payout|cash/i);
			assert.deepEqual(yield* held(t, 'MEDICAL_LEAVE'), before);
			assert.deepEqual(yield* entries(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a cash-out reversed', () => {
	it.live('before any run has paid it, is deleted instead, and the days come back', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* grant(t, 2);
			yield* cashOut(t, '2026-08-05', '2026-08-06');
			const [open] = yield* entries(t);
			assert.ok(open !== undefined);
			assert.match(
				yield* refused(enter(t, seed, IN_LIEU, [], { reverses: open.id })),
				/deleted instead/
			);
			yield* t.as(t.admin).act('leave_catalog_entry.delete', [{ target: open.id }]);
			yield* t.runDue();
			assert.deepEqual(yield* held(t), { entitled: 2, used: 0 });
			assert.equal(yield* drawnBy(t, open.id), 0);
			yield* run(t, '2026-08');
			assert.deepEqual(yield* paid(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'after payment keeps its nature: the next run takes the payout back and the days return, once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* grant(t, 2);
				yield* cashOut(t, '2026-08-05', '2026-08-06');
				yield* run(t, '2026-08');
				const original = yield* sealedLeave(t);
				yield* enter(t, seed, IN_LIEU, [], { reverses: original });
				// the movement is the inverse, at once; the money follows in the next run
				assert.deepEqual(yield* held(t), { entitled: 2, used: 0 });
				const reversal = (yield* entries(t)).find((row) => row.reverses === original);
				assert.ok(reversal !== undefined);
				assert.equal(reversal.encashment, true);
				// a second reversal of the same entry is refused, and moves nothing
				assert.match(
					yield* refused(enter(t, seed, IN_LIEU, [], { reverses: original })),
					/already/
				);
				assert.deepEqual(yield* held(t), { entitled: 2, used: 0 });
				// nor is a reversal itself reversed
				assert.match(
					yield* refused(enter(t, seed, IN_LIEU, [], { reverses: reversal.id })),
					/A reversal undoes a sealed entry/
				);
				yield* run(t, '2026-09');
				const flipped = [
					['2026-08', 'ADD', 2 * PAYOUT, 2],
					['2026-09', 'DEDUCT', 2 * PAYOUT, 2]
				];
				assert.deepEqual(yield* paid(t), flipped);
				// paid back, the reversal can no longer be cancelled
				assert.match(
					yield* refused(
						t.as(t.admin).act('leave_catalog_entry.delete', [{ target: reversal.id }])
					),
					/paid this reversal back/
				);
				// no dead end: the returned days are held again and cash out afresh, once more
				yield* cashOut(t, '2026-10-06', '2026-10-07');
				assert.deepEqual(yield* held(t), { entitled: 2, used: 2 });
				yield* run(t, '2026-10');
				yield* run(t, '2026-11');
				assert.deepEqual(yield* paid(t), [...flipped, ['2026-10', 'ADD', 2 * PAYOUT, 2]]);
				assert.deepEqual(yield* held(t), { entitled: 2, used: 2 });
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('never returns the days without the money: a reversal that drops the cash-out flag', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* grant(t, 2);
			yield* cashOut(t, '2026-08-05', '2026-08-06');
			yield* run(t, '2026-08');
			// refused, or priced as the cash-out it reverses: either way days returned × payout is what comes off
			yield* Effect.exit(
				enter(t, seed, IN_LIEU, [], { reverses: yield* sealedLeave(t), encashment: false })
			);
			yield* run(t, '2026-09');
			const returned = 2 - (yield* held(t)).used;
			const takenBack = (yield* paid(t))
				.filter(([, direction]) => direction === 'DEDUCT')
				.reduce((total, [, , amount]) => total + Number(amount), 0);
			assert.equal(takenBack, returned * PAYOUT);
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
			const [slip, ...more] = (yield* t.storedQuery({ payslip: { limit: 10 } })).payslip.rows;
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
					Effect.andThen(enter(t, theirs, IN_LIEU, [DAY], { encashment: false }))
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
				grant(t, 1, '2026-02-02').pipe(Effect.andThen(enter(t, theirs, IN_LIEU, [DAY])))
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

// An exit raises one cash-out request a cashable row, held for an HR controller, and the request names its exit
// (`occurrence_key`). When the exit is cancelled or moved, one routine settles what it left by where the cash-out
// stands: a pending request is withdrawn by the system; approved and in no run, it is withdrawn; under an
// unpaid run nothing moves until the run is deleted or paid; once a paid run took it, one task asks HR to reverse it.
describe('an exit’s cash-out', () => {
	const OCTOBER = '2026-10-20T02:00:00.000Z';
	const exitSeed: Seed = {
		...seed,
		sys_user: [
			...(seed.sys_user ?? []),
			{
				id: uuid(41),
				name: 'Payroll',
				email: 'payroll@example.test',
				kind: 'staff',
				team: 'hr_controller'
			}
		]
	};
	const end = (t: Kit, to: string | null, reason = 'Resignation') =>
		t
			.as(t.admin)
			.act('employee_contract.update', [
				{
					target: CONTRACT,
					set: {
						effective_range: {
							from: PlainDate('2025-01-01'),
							to: to === null ? null : PlainDate(to)
						},
						reason
					}
				}
			])
			.pipe(Effect.andThen(t.runDue()));
	/** The exit cancelled by a successor: a draft version of the same terms from `from`. */
	const succeed = (t: Kit, from: string) =>
		Effect.gen(function* () {
			const [ended] = (yield* t.storedQuery({
				employee_contract: { where: { id: { eq: CONTRACT } }, limit: 1 }
			})).employee_contract.rows;
			assert.ok(ended !== undefined);
			yield* t.as(t.admin).act('employee_contract.create', [
				{
					employee_id: ended.employee_id,
					entity_id: ended.entity_id,
					engagement: ended.engagement,
					employee_number: ended.employee_number,
					terms: ended.terms,
					payroll: ended.payroll,
					bank: ended.bank,
					employee_extension_data: ended.employee_extension_data,
					service_started_on: ended.service_started_on,
					effective_range: { from: PlainDate(from), to: null },
					status: 'DRAFT',
					reason: 'Termination withdrawn'
				}
			]);
			yield* t.runDue();
			const next = (yield* t.storedQuery({
				employee_contract: { where: { status: { eq: 'DRAFT' } }, limit: 1 }
			})).employee_contract.rows[0];
			assert.ok(next !== undefined);
			return next.id;
		});
	const requests = (t: Kit) =>
		entries(t).pipe(Effect.map((rows) => rows.filter((row) => row.encashment)));
	/** The requests an HR controller still has to decide. */
	const waiting = (t: Kit) =>
		Effect.gen(function* () {
			const hr = t.as(yield* t.signIn('payroll@example.test'));
			const { leave_catalog_entry } = yield* hr.query({
				leave_catalog_entry: { where: { encashment: { eq: true } }, limit: 10 }
			});
			return {
				hr,
				ids: leave_catalog_entry.rows.flatMap((row) =>
					row.$approval?.requestId === undefined ? [] : [row.$approval.requestId]
				)
			};
		});
	/** The exit's one waiting request approved by the HR controller: the one cash-out, now posted. */
	const approve = (t: Kit) =>
		Effect.gen(function* () {
			const { hr, ids } = yield* waiting(t);
			const [requestId, ...waits] = ids;
			assert.ok(requestId !== undefined);
			assert.equal(waits.length, 0);
			yield* hr.approvals.decide(requestId, { decision: 'approve' });
			yield* t.runDue();
			const [request, ...more] = yield* requests(t);
			assert.ok(request !== undefined);
			assert.equal(more.length, 0);
			return request;
		});
	/** How every approval request stands, in order. */
	const statuses = (t: Kit) =>
		t
			.storedQuery({ approval_request: { limit: 100 } })
			.pipe(
				Effect.map(({ approval_request }) =>
					approval_request.rows.map((row) => row.status).toSorted()
				)
			);
	const sizeOf = (t: Kit, entry: Id<'leave_catalog_entry'>) =>
		reversalSlots(t, entry).pipe(Effect.map((slots) => slots.length));
	/** The routine again, as any of its triggers would start it. */
	const again = (t: Kit) =>
		t
			.as(t.admin)
			.start('encashment', { employments: [CONTRACT] })
			.pipe(Effect.andThen(t.runDue()));
	const duties = (t: Kit) =>
		t
			.storedQuery({ obligation: { limit: 500 } })
			.pipe(
				Effect.map(({ obligation }) =>
					obligation.rows.filter((row) => row.occurrence_key.includes(':exit:'))
				)
			);
	const runs = (t: Kit) =>
		t
			.storedQuery({ payroll_run: { limit: 10 } })
			.pipe(Effect.map(({ payroll_run }) => payroll_run.rows));
	const slipsOf = (t: Kit) =>
		t.storedQuery({ payslip: { limit: 10 } }).pipe(Effect.map(({ payslip }) => payslip.rows));
	const settle = (t: Kit) =>
		Effect.gen(function* () {
			const [final] = yield* runs(t);
			assert.ok(final !== undefined);
			yield* t
				.as(t.admin)
				.act('payroll_run.update', [{ target: final.id, set: { state: 'PAID' } }]);
			yield* t.runDue();
			return final;
		});
	/** The tasks asking HR to reverse a paid cash-out, as `[key, state]`. */
	const reverseTasks = (t: Kit) =>
		t
			.storedQuery({ obligation: { limit: 500 } })
			.pipe(
				Effect.map(({ obligation }) =>
					obligation.rows
						.filter((row) => row.occurrence_key.startsWith('reverse:'))
						.map((row) => [row.occurrence_key, row.state])
				)
			);
	/** The integrity findings by invariant, on the clock's day. */
	const findings = (t: Kit) =>
		verify(t.storedQuery, t.clock.now().slice(0, 10)).pipe(
			Effect.map((rows) => rows.map((row) => row.invariant).filter((name) => name !== 'W1'))
		);
	const CAPTURED = /Payroll run \d+ already captured this period/;
	const adds = (lines: readonly (readonly unknown[])[]) =>
		lines.filter(([, direction]) => direction === 'ADD');

	it.live(
		'still pending when the exit moves or is cancelled: the system withdraws it; moved, one request of the new size waits; cancelled, nothing waits and nothing posted',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const before = (yield* held(t, 'ANNUAL_LEAVE')).used;
				yield* end(t, '2026-11-30');
				const [request, ...more] = yield* requests(t);
				assert.ok(request !== undefined);
				assert.equal(more.length, 0);
				assert.equal(request.occurrence_key, `exit:${CONTRACT}:2026-11-30`);
				const first = yield* waiting(t);
				assert.equal(first.ids.length, 1);
				const whole = yield* sizeOf(t, request.id);
				// the routine again while nothing changed: the same request
				yield* again(t);
				assert.deepEqual((yield* waiting(t)).ids, first.ids);
				// the last day moves earlier: the old request is withdrawn and one for the new day waits
				yield* end(t, '2026-10-16');
				const [moved, ...beside] = yield* requests(t);
				assert.ok(moved !== undefined && moved.id !== request.id);
				assert.equal(beside.length, 0);
				// a moved last day is another fact: the new request names it, and is sized for it
				assert.equal(moved.occurrence_key, `exit:${CONTRACT}:2026-10-16`);
				assert.ok((yield* sizeOf(t, moved.id)) <= whole);
				const second = yield* waiting(t);
				assert.equal(second.ids.length, 1);
				assert.notDeepEqual(second.ids, first.ids);
				assert.deepEqual(yield* statuses(t), ['ONGOING', 'WITHDRAWN']);
				assert.deepEqual(yield* findings(t), []);
				yield* again(t);
				assert.deepEqual((yield* waiting(t)).ids, second.ids);
				assert.deepEqual(yield* statuses(t), ['ONGOING', 'WITHDRAWN']);
				// the exit is cancelled by a successor: the request is withdrawn, its record gone, and nothing waits for HR
				yield* succeed(t, '2026-11-01');
				assert.deepEqual(yield* requests(t), []);
				assert.deepEqual((yield* waiting(t)).ids, []);
				assert.deepEqual(yield* statuses(t), ['WITHDRAWN', 'WITHDRAWN']);
				assert.deepEqual(yield* findings(t), []);
				assert.equal(yield* drawnBy(t, moved.id), 0);
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, before);
				yield* again(t);
				assert.deepEqual(yield* requests(t), []);
				assert.deepEqual(yield* statuses(t), ['WITHDRAWN', 'WITHDRAWN']);
				// the month the first contract ended in runs without a cash-out line
				yield* run(t, '2026-10');
				assert.equal((yield* slipsOf(t)).length, 1);
				assert.deepEqual(yield* paid(t, 'ANNUAL_LEAVE'), []);
			}).pipe(Effect.provide(workspace({ seed: exitSeed, now: OCTOBER })))
	);

	/** The exit's tasks as `[id, state]`, in id order; `day` narrows them to one last day's. */
	const tasksOf = (t: Kit, day?: string) =>
		duties(t).pipe(
			Effect.map((rows) =>
				rows
					.filter((row) => day === undefined || row.occurrence_key.endsWith(`:${day}`))
					.map((row) => [row.id, row.state] as const)
					.toSorted(([left], [right]) => left.localeCompare(right))
			)
		);
	/** The last day set or taken off, with no run of it left failed. */
	const ends = (t: Kit, to: string | null) =>
		t
			.as(t.admin)
			.act('employee_contract.update', [
				{
					target: CONTRACT,
					set: {
						effective_range: {
							from: PlainDate('2025-01-01'),
							to: to === null ? null : PlainDate(to)
						},
						reason: to === null ? 'Ended in error' : 'Resignation'
					}
				}
			])
			.pipe(
				Effect.andThen(t.runDue()),
				Effect.map((due) => assert.deepEqual(due.failed, []))
			);
	const stateOf = (rows: readonly (readonly [string, string])[], state: string) =>
		rows.map(([id]) => [id, state]);

	it.live(
		'ended, cancelled and ended again on the same day: the same tasks are open again, none twice; ended on another day instead, the first day’s stay waived and the new day’s are open',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* ends(t, '2026-10-16');
				const raised = yield* tasksOf(t);
				assert.ok(raised.length > 0);
				assert.deepEqual(raised, stateOf(raised, 'OPEN'));
				yield* ends(t, null);
				assert.deepEqual(yield* tasksOf(t), stateOf(raised, 'WAIVED'));
				// the fact stands again: what the routine waived, it reopens
				yield* ends(t, '2026-10-16');
				assert.deepEqual(yield* tasksOf(t), raised);
				yield* again(t);
				assert.deepEqual(yield* tasksOf(t), raised);
				yield* ends(t, null);
				yield* ends(t, '2026-10-30');
				assert.deepEqual(yield* tasksOf(t, '2026-10-16'), stateOf(raised, 'WAIVED'));
				const later = yield* tasksOf(t, '2026-10-30');
				assert.equal(later.length, raised.length);
				assert.deepEqual(later, stateOf(later, 'OPEN'));
				assert.equal((yield* tasksOf(t)).length, raised.length * 2);
			}).pipe(Effect.provide(workspace({ seed: exitSeed, now: OCTOBER })))
	);

	it.live(
		'raised again reopens only what the routine waived: a task HR waived for its own reason stays waived until HR reopens it, and a fulfilled one never reopens',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = t.as(t.admin);
				yield* syncAll(t);
				yield* ends(t, '2026-10-16');
				const [byHand, done, ...rest] = yield* tasksOf(t);
				assert.ok(byHand !== undefined && done !== undefined);
				const move = (id: string, set: { state: 'OPEN' | 'WAIVED' | 'FULFILLED' }) =>
					admin.act('obligation.update', [{ target: idOf('obligation', id), set }]);
				yield* admin.act('obligation.update', [
					{
						target: idOf('obligation', byHand[0]),
						set: { state: 'WAIVED', waiver_reason: 'Not owed at this company' }
					}
				]);
				yield* move(done[0], { state: 'FULFILLED' });
				yield* t.runDue();
				yield* ends(t, null);
				yield* ends(t, '2026-10-16');
				const standing = [
					[byHand[0], 'WAIVED'],
					[done[0], 'FULFILLED'],
					...stateOf(rest, 'OPEN')
				].toSorted(([left = ''], [right = '']) => left.localeCompare(right));
				assert.deepEqual(yield* tasksOf(t), standing);
				// HR's own waiver is HR's to take back; a completed task keeps its state
				yield* move(byHand[0], { state: 'OPEN' });
				assert.match(
					yield* refused(move(done[0], { state: 'OPEN' })),
					/'FULFILLED' cannot move to 'OPEN'/
				);
				yield* t.runDue();
				assert.deepEqual(
					yield* tasksOf(t),
					standing.map(([id, state]) => [id, id === byHand[0] ? 'OPEN' : state])
				);
			}).pipe(Effect.provide(workspace({ seed: exitSeed, now: OCTOBER })))
	);

	it.live('cannot be named by a person: only the system says what an entry was raised for', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* grant(t, 1);
			assert.match(
				yield* refused(
					t.as(t.member(['hr_controller'])).act('leave_catalog_entry.create', [
						{
							...leaveCreate({
								entity_id: ENTITY,
								employment_id: CONTRACT,
								catalog_id: rowOf(exitSeed, IN_LIEU),
								encashment: true,
								days: wholeDays('2026-10-05')
							}),
							occurrence_key: `exit:${CONTRACT}:2026-10-16`
						}
					])
				),
				/Only the system names the event/
			);
			assert.deepEqual(yield* entries(t), []);
		}).pipe(Effect.provide(workspace({ seed: exitSeed, now: OCTOBER })))
	);

	it.live(
		'approved and in no run when the exit is cancelled: withdrawn with its days; raised again with the exit, there is one, never two',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const before = yield* held(t, 'ANNUAL_LEAVE');
				yield* end(t, '2026-10-16');
				const request = yield* approve(t);
				// approved, it has posted: the days are drawn, and no run has paid it
				const drawn = yield* drawnBy(t, request.id);
				assert.ok(drawn > 0);
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, before.used + drawn);
				assert.equal(request.payroll_run_id, null);
				assert.ok((yield* duties(t)).some((row) => row.state === 'OPEN'));
				// the routine again finds nothing to do while the exit stands
				yield* again(t);
				assert.deepEqual(
					(yield* requests(t)).map((row) => row.id),
					[request.id]
				);
				assert.equal(yield* drawnBy(t, request.id), drawn);

				yield* end(t, null, 'Termination withdrawn');
				// on its own: the duties are waived, the proration is given back, and the cash-out is gone with its days
				const after = yield* duties(t);
				assert.ok(after.length > 0 && after.every((row) => row.state === 'WAIVED'));
				assert.deepEqual(yield* requests(t), []);
				assert.equal(yield* drawnBy(t, request.id), 0);
				assert.deepEqual(yield* held(t, 'ANNUAL_LEAVE'), before);
				assert.deepEqual(yield* findings(t), []);
				yield* again(t);
				assert.deepEqual(yield* requests(t), []);
				assert.deepEqual(yield* held(t, 'ANNUAL_LEAVE'), before);

				// the exit raised again asks again, once, however often the routine runs
				yield* end(t, '2026-10-16');
				yield* again(t);
				const [second, ...more] = yield* requests(t);
				assert.ok(second !== undefined && second.id !== request.id);
				assert.equal(more.length, 0);
				assert.equal((yield* waiting(t)).ids.length, 1);
				// and cancelled while it waits, it is withdrawn: an ordinary month, and the days to take
				yield* end(t, null, 'Termination withdrawn');
				assert.deepEqual(yield* requests(t), []);
				assert.deepEqual((yield* waiting(t)).ids, []);
				yield* run(t, '2026-10');
				assert.equal((yield* slipsOf(t)).length, 1);
				assert.deepEqual(yield* paid(t, 'ANNUAL_LEAVE'), []);
				yield* enter(t, exitSeed, 'ANNUAL_LEAVE', ['2026-11-03'], { encashment: false });
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, before.used + 1);
			}).pipe(Effect.provide(workspace({ seed: exitSeed, now: OCTOBER })))
	);

	it.live(
		'paid in the final run, the exit cannot move under that run; the run deleted, it moves, and one cash-out is paid once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* end(t, '2026-10-16');
				const request = yield* approve(t);
				assert.ok((yield* drawnBy(t, request.id)) > 0);
				yield* run(t, '2026-10');
				assert.equal(adds(yield* paid(t, 'ANNUAL_LEAVE')).length, 1);
				// the exit moves later, into days the final run has captured: refused, naming the run
				assert.match(yield* refused(end(t, '2026-11-13')), CAPTURED);
				// the way out: the unpaid run comes off, the exit moves, and the runs go again
				const [final] = yield* runs(t);
				assert.ok(final !== undefined);
				yield* t.as(t.admin).act('payroll_run.delete', [{ target: final.id }]);
				yield* t.runDue();
				assert.deepEqual(yield* paid(t, 'ANNUAL_LEAVE'), []);
				// open again and its exit standing, it is kept as it is
				assert.deepEqual(
					(yield* requests(t)).map((row) => row.id),
					[request.id]
				);
				yield* end(t, '2026-11-13');
				// the later last day leaves more earned: the cash-out is the same one, or one raised afresh for HR
				const { hr, ids } = yield* waiting(t);
				for (const requestId of ids) yield* hr.approvals.decide(requestId, { decision: 'approve' });
				yield* t.runDue();
				const [current, ...more] = yield* requests(t);
				assert.ok(current !== undefined);
				assert.equal(more.length, 0);
				assert.equal(current.occurrence_key, `exit:${CONTRACT}:2026-11-13`);
				const drawn = yield* drawnBy(t, current.id);
				assert.ok(drawn > 0);
				yield* run(t, '2026-10');
				yield* run(t, '2026-11');
				// one cash-out, drawn once and paid once across both runs, whichever of them took it
				const lines = adds(yield* paid(t, 'ANNUAL_LEAVE'));
				assert.equal(lines.length, 1);
				assert.equal(lines[0]?.[3], drawn);
				assert.equal(yield* drawnBy(t, current.id), drawn);
				assert.deepEqual(yield* findings(t), []);
			}).pipe(Effect.provide(workspace({ seed: exitSeed, now: OCTOBER })))
	);

	it.live(
		'in an unpaid final run when the exit is cancelled: nothing moves under the run; the run deleted, it is withdrawn and the period runs again without it',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const before = yield* held(t, 'ANNUAL_LEAVE');
				yield* end(t, '2026-10-16');
				const request = yield* approve(t);
				const drawn = yield* drawnBy(t, request.id);
				yield* run(t, '2026-10');
				assert.equal((yield* paid(t, 'ANNUAL_LEAVE')).length, 1);
				// under the run the last day cannot come off, and the cash-out it sealed cannot be deleted
				assert.match(yield* refused(end(t, null, 'Termination withdrawn')), CAPTURED);
				assert.match(
					yield* refused(t.as(t.admin).act('leave_catalog_entry.delete', [{ target: request.id }])),
					/Create a reversal/
				);
				// the employment continues on a new version from the next month: the exit no longer stands
				yield* succeed(t, '2026-11-01');
				assert.deepEqual(
					(yield* duties(t)).filter((row) => row.state === 'OPEN'),
					[]
				);
				// and nothing under the unpaid run moved: the same entry, sealed and drawn, no reversal beside it
				const [sealed, ...more] = yield* requests(t);
				assert.equal(sealed?.id, request.id);
				assert.equal(more.length, 0);
				assert.ok(sealed?.payroll_run_id != null);
				assert.equal(yield* drawnBy(t, request.id), drawn);
				assert.deepEqual((yield* waiting(t)).ids, []);
				assert.deepEqual(yield* findings(t), []);
				yield* again(t);
				assert.equal((yield* requests(t)).length, 1);
				// the run deleted, the entry is open again and is withdrawn at once, with its days
				const [final] = yield* runs(t);
				assert.ok(final !== undefined);
				yield* t.as(t.admin).act('payroll_run.delete', [{ target: final.id }]);
				yield* t.runDue();
				assert.deepEqual(yield* slipsOf(t), []);
				assert.deepEqual(yield* requests(t), []);
				assert.equal(yield* drawnBy(t, request.id), 0);
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, before.used);
				assert.deepEqual(yield* findings(t), []);
				// the same period again pays no cash-out
				yield* run(t, '2026-10');
				assert.equal((yield* slipsOf(t)).length, 1);
				assert.deepEqual(yield* paid(t, 'ANNUAL_LEAVE'), []);
			}).pipe(Effect.provide(workspace({ seed: exitSeed, now: OCTOBER })))
	);

	it.live(
		'in an unpaid final run that is then paid: only then is HR asked to reverse it, once; the exit standing again waives the task, and cancelled a second time the same task is open again',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const before = yield* held(t, 'ANNUAL_LEAVE');
				yield* end(t, '2026-10-16');
				const request = yield* approve(t);
				const drawn = yield* drawnBy(t, request.id);
				yield* run(t, '2026-10');
				const next = yield* succeed(t, '2026-11-01');
				assert.deepEqual(yield* reverseTasks(t), []);
				yield* settle(t);
				// paid, it is settled: one task asks HR for the reversal, and nothing has moved
				const asked = [[`reverse:${request.id}`, 'OPEN']];
				assert.deepEqual(yield* reverseTasks(t), asked);
				yield* again(t);
				assert.deepEqual(yield* reverseTasks(t), asked);
				assert.deepEqual(
					(yield* requests(t)).map((row) => row.id),
					[request.id]
				);
				assert.deepEqual((yield* waiting(t)).ids, []);
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, before.used + drawn);
				// the successor sealed and then voided, the first contract is an exit again: the payout stands, the task goes
				const admin = t.as(t.admin);
				yield* admin.act('employee_contract.update', [{ target: next, set: { status: 'SEALED' } }]);
				yield* t.runDue();
				yield* admin.act('employee_contract.update', [
					{ target: next, set: { status: 'VOID', reason: 'The person leaves after all' } }
				]);
				yield* t.runDue();
				const waived = [[`reverse:${request.id}`, 'WAIVED']];
				assert.deepEqual(yield* reverseTasks(t), waived);
				assert.deepEqual(
					(yield* requests(t)).map((row) => row.id),
					[request.id]
				);
				// cancelled once more, the reversal is due again: the same task reopens, and no second one is raised
				const later = yield* succeed(t, '2026-11-01');
				yield* again(t);
				assert.deepEqual(yield* reverseTasks(t), asked);
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, before.used + drawn);
				yield* admin.act('employee_contract.update', [
					{ target: later, set: { status: 'SEALED' } }
				]);
				yield* t.runDue();
				yield* run(t, '2026-11');
				assert.deepEqual(yield* paid(t, 'ANNUAL_LEAVE'), adds(yield* paid(t, 'ANNUAL_LEAVE')));
				assert.equal((yield* paid(t, 'ANNUAL_LEAVE')).length, 1);
			}).pipe(Effect.provide(workspace({ seed: exitSeed, now: OCTOBER })))
	);

	it.live(
		'in a paid final run when the person stays: one task asks HR to reverse it; keyed, the days return, the next run takes the money back once, and the task is waived',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const before = yield* held(t, 'ANNUAL_LEAVE');
				yield* end(t, '2026-09-16');
				const request = yield* approve(t);
				const drawn = yield* drawnBy(t, request.id);
				yield* run(t, '2026-09');
				const final = yield* settle(t);
				const [cashed] = yield* paid(t, 'ANNUAL_LEAVE');
				assert.ok(cashed !== undefined);
				const [, , amount, days] = cashed;
				assert.equal(days, drawn);
				// paid, the month is the record: the exit cannot be cancelled in it, the run cannot come off, the entry stays
				assert.match(yield* refused(end(t, null, 'Termination withdrawn')), CAPTURED);
				assert.match(
					yield* refused(t.as(t.admin).act('payroll_run.delete', [{ target: final.id }])),
					/A paid run is locked/
				);
				assert.match(
					yield* refused(t.as(t.admin).act('leave_catalog_entry.delete', [{ target: request.id }])),
					/Create a reversal/
				);
				assert.deepEqual(yield* reverseTasks(t), []);
				// the way forward: the employment continues on a new contract from the first month no run holds
				const next = yield* succeed(t, '2026-10-01');
				yield* t
					.as(t.admin)
					.act('employee_contract.update', [{ target: next, set: { status: 'SEALED' } }]);
				yield* t.runDue();
				// on its own: the duties close and one task asks HR to reverse the paid cash-out; nothing has moved
				assert.deepEqual(
					(yield* duties(t)).filter((row) => row.state === 'OPEN'),
					[]
				);
				yield* again(t);
				assert.deepEqual(yield* reverseTasks(t), [[`reverse:${request.id}`, 'OPEN']]);
				assert.deepEqual(
					(yield* requests(t)).map((row) => row.id),
					[request.id]
				);
				assert.deepEqual((yield* waiting(t)).ids, []);
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, before.used + drawn);
				// HR keys it, and only as a cash-out, so the days never come back without the money
				assert.match(
					yield* refused(
						enter(t, exitSeed, 'ANNUAL_LEAVE', [], { reverses: request.id, encashment: false })
					),
					/a cash-out is reversed as a cash-out/
				);
				yield* enter(t, exitSeed, 'ANNUAL_LEAVE', [], { reverses: request.id });
				// the days return at once, once
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, before.used);
				assert.match(
					yield* refused(enter(t, exitSeed, 'ANNUAL_LEAVE', [], { reverses: request.id })),
					/already/
				);
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, before.used);
				// the routine's next pass finds the reversal and waives the task
				yield* again(t);
				assert.deepEqual(yield* reverseTasks(t), [[`reverse:${request.id}`, 'WAIVED']]);
				assert.equal((yield* requests(t)).length, 2);
				// the next run, on the new contract, takes the money back; the one after takes nothing
				yield* run(t, '2026-10');
				const taken = [
					['2026-09', 'ADD', amount, days],
					['2026-10', 'DEDUCT', amount, days]
				];
				assert.deepEqual(yield* paid(t, 'ANNUAL_LEAVE'), taken);
				assert.equal(
					(yield* slipsOf(t)).find((slip) => slip.period === '2026-10')?.employment_id,
					next
				);
				// the returned days are held: one is taken as leave on the new contract
				yield* t.as(t.admin).act('leave_catalog_entry.create', [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: next,
						catalog_id: rowOf(exitSeed, 'ANNUAL_LEAVE'),
						days: wholeDays('2026-11-03')
					})
				]);
				yield* t.runDue();
				yield* run(t, '2026-11');
				assert.deepEqual(yield* paid(t, 'ANNUAL_LEAVE'), taken);
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, before.used + 1);
			}).pipe(Effect.provide(workspace({ seed: exitSeed, now: '2026-09-20T02:00:00.000Z' })))
	);

	it.live(
		'is sized under leave still waiting for its decision: those days are not cashed out as well',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				// the exit alone: what the last day leaves, cashed out whole
				yield* end(t, '2026-10-30');
				const [alone, ...more] = yield* requests(t);
				assert.ok(alone !== undefined);
				assert.equal(more.length, 0);
				const whole = yield* sizeOf(t, alone.id);
				yield* end(t, null, 'Termination withdrawn');
				assert.deepEqual(yield* requests(t), []);
				// the employee asks for a day, which waits for its reviewers; then the same exit
				const asked = yield* t
					.as(t.member(['employee'], { id: uuid(3) }))
					.act('leave_catalog_entry.create', [
						leaveCreate({
							entity_id: ENTITY,
							employment_id: CONTRACT,
							catalog_id: rowOf(exitSeed, 'ANNUAL_LEAVE'),
							days: wholeDays('2026-10-22')
						})
					]);
				assert.equal(asked.kind, 'pendingApproval');
				yield* t.runDue();
				yield* end(t, '2026-10-30');
				const [under, ...rest] = yield* requests(t);
				assert.ok(under !== undefined);
				assert.equal(rest.length, 0);
				// the request is raised, not refused for want of balance, and leaves the waiting day alone
				assert.equal(yield* sizeOf(t, under.id), whole - 2);
				assert.equal((yield* waiting(t)).ids.length, 1);
			}).pipe(Effect.provide(workspace({ seed: exitSeed, now: OCTOBER })))
	);
});
