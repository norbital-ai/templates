// Random sequences of the real acts an HR user and an employee can take, on one small workspace a seed, with the acts
// that try to break it mixed in: the same act twice in a row, an exit raised, moved and cancelled, entries on a void
// contract, a run made and deleted, and direct writes to the ledger, the balance and a payslip by HR, the employee and
// an administrator. After every step: no queued work failed, a refused act wrote nothing, the integrity check has no
// hard finding, the balance is what an independent sum of the ledger says, and the payslips hold (a paid one never
// changes, each belongs to a run, each seal names a run, what a sealed entry pays is on payslips once). A refusal is an
// expected answer; anything else an act fails with is not. The ledger and a payslip declare no update or delete, so
// those acts do not exist to try. Replay one sequence with HR_SEED=<n>, soak with HR_STEPS=<n>.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate, addMonths } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { verify } from '../src/lib/integrity.ts';
import { stableJson } from '../src/lib/payroll_engine/foundation.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	flat,
	leaveCreate,
	ledgerRows,
	pack,
	projection,
	reversalSlots,
	syncAll,
	uuid,
	wholeDays,
	workspace
} from './kit.ts';

const SEEDS =
	process.env['HR_SEED'] === undefined ? [11, 23, 37, 41, 53] : [Number(process.env['HR_SEED'])];
const STEPS = Number(process.env['HR_STEPS'] ?? 40);
// one version of the law the template holds (8 July to 30 November 2026): the clock stays inside it
const START = '2026-08-05T02:00:00.000Z';
const LAST_MONTH = '2026-11';
const CONTRACT = idOf('employee_contract', uuid(6));
const VOIDED = idOf('employee_contract', uuid(7));
const BALANCE = idOf('employee_balance', uuid(5));
const base = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{
		rate: { amount: 3120, unit: 'MONTHLY' },
		statutory_work_category: 'MANUAL_LABOUR',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{},
	[],
	[],
	'2026-08-15'
);
const seed = {
	...base,
	// an earlier version keyed in error and voided: nothing may be entered or paid on it
	employee_contract: [
		...(base.employee_contract ?? []),
		{
			...(base.employee_contract?.[0] ?? {}),
			id: VOIDED,
			status: 'VOID',
			effective_range: { from: '2024-01-01', to: '2024-12-31' },
			reason: 'Keyed in error'
		}
	],
	sys_user: [
		...(base.sys_user ?? []),
		// an HR manager may decide any step of a held request
		{ id: uuid(42), name: 'Chief', email: 'chief@example.test', kind: 'staff', team: 'hr_manager' }
	]
};
const catalog = <M extends 'leave_catalog' | 'claim_catalog' | 'adhoc_catalog'>(
	model: M,
	code: string
) => idOf(model, catalogRow(base, model, code));

/** mulberry32: a few lines, the same sequence for a seed everywhere. Its state can be put back, to draw the same again. */
const random = (seed: number) => {
	const dice = {
		state: seed,
		next: () => {
			dice.state = (dice.state + 0x6d2b79f5) | 0;
			let mixed = Math.imul(dice.state ^ (dice.state >>> 15), 1 | dice.state);
			mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
			return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
		}
	};
	return dice;
};
type Caller = ReturnType<Kit['as']>;
type World = {
	readonly t: Kit;
	readonly next: () => number;
	readonly admin: Caller;
	readonly hr: Caller;
	readonly me: Caller;
	readonly chief: Caller;
	readonly requests: string[];
	/** Each payslip of a paid run as it stood when first seen paid. */
	readonly paid: Map<string, string>;
	readonly log: string[];
};
const pick = <T>(w: World, items: readonly T[]) => items[Math.floor(w.next() * items.length)];
const today = (w: World) => w.t.clock.now().slice(0, 10);
/** A day of this month or the one before. */
const day = (w: World) => {
	const month = String(addMonths(today(w), w.next() < 0.5 ? 0 : -1)).slice(0, 7);
	return `${month}-${String(1 + Math.floor(w.next() * 28)).padStart(2, '0')}`;
};
const note = (w: World, text: string) => Effect.sync(() => void w.log.push(text));
/** A held request is remembered, for a later step to decide. */
const asked = (w: World, done: { readonly kind: string; readonly requestId?: string }) => {
	if (done.kind === 'pendingApproval' && done.requestId !== undefined)
		w.requests.push(done.requestId);
};
const stored = (w: World) =>
	w.t.storedQuery({
		leave_catalog_entry: { limit: 1000 },
		leave_catalog_entry_day: { limit: 10000 },
		claim_catalog_entry: { limit: 1000 },
		adhoc_catalog_entry: { limit: 1000 },
		payroll_run: { limit: 1000 },
		payslip: { limit: 1000 }
	});
const leaveOn = (w: World, by: Caller, code: string, employment = CONTRACT) =>
	Effect.gen(function* () {
		const date = day(w);
		yield* note(w, `leave ${code} ${date}${employment === VOIDED ? ' on the void contract' : ''}`);
		asked(
			w,
			yield* by.act('leave_catalog_entry.create', [
				leaveCreate({
					entity_id: ENTITY,
					employment_id: employment,
					catalog_id: catalog('leave_catalog', code),
					days: wholeDays(date)
				})
			])
		);
	});
const entryOf = (w: World, quantity: number) => ({
	entity_id: ENTITY,
	employment_id: CONTRACT,
	quantity,
	incurred_on: PlainDate(day(w))
});
const amount = (w: World) => pick(w, [10, 50, 200, 600, 1500]) ?? 10;
const manual = (w: World, sign: 1 | -1) =>
	Effect.gen(function* () {
		const days = pick(w, [0.5, 1, 2, 5, 40]) ?? 1;
		yield* note(w, `manual ${sign * days}`);
		yield* w.hr.act('ledger_entry.create', [
			{
				balance_id: BALANCE,
				operation: sign < 0 ? 'DEDUCT' : 'ADD',
				account: 'leave',
				code: 'ANNUAL_LEAVE',
				measure: 'entitled',
				amount: days,
				unit: 'DAY',
				effective_on: PlainDate(today(w)),
				note: 'keyed by hand'
			}
		]);
	});

/** The last day goes on the contract, moves, or comes off. */
const exit = (w: World, to: string | null) =>
	Effect.gen(function* () {
		yield* note(w, to === null ? 'exit cancelled' : `exit ${to}`);
		yield* w.admin.act('employee_contract.update', [
			{
				target: CONTRACT,
				set: {
					effective_range: {
						from: PlainDate('2025-01-01'),
						to: to === null ? null : PlainDate(to)
					},
					reason: to === null ? 'Termination withdrawn' : 'Resignation'
				}
			}
		]);
	});
/** Whoever tries: an HR controller, the employee, an administrator. */
const anyone = (w: World) => {
	const who = Math.floor(w.next() * 3);
	return (
		[
			{ by: w.hr, name: 'hr' },
			{ by: w.me, name: 'employee' },
			{ by: w.admin, name: 'admin' }
		][who] ?? { by: w.hr, name: 'hr' }
	);
};
const failures = (w: World) =>
	// research needs a host tool the kit lacks; nothing else may fail
	w.t
		.runDue()
		.pipe(
			Effect.map(({ failed }) => failed.filter((run) => run.automation !== 'statutory_research'))
		);
/** What every key of the ledger holds and what every entry is sealed by: what a deleted run must give back exactly. */
const standing = (w: World) =>
	Effect.all([projection(w.t), stored(w)]).pipe(
		Effect.map(([ledger, rows]) => ({
			ledger,
			seals: [
				...rows.leave_catalog_entry.rows,
				...rows.leave_catalog_entry_day.rows,
				...rows.claim_catalog_entry.rows,
				...rows.adhoc_catalog_entry.rows
			]
				.map((row) => `${row.id} ${row.payroll_run_id ?? '-'}`)
				.toSorted()
		}))
	);
const signed = (direction: string, amount: number) => (direction === 'DEDUCT' ? -amount : amount);
/** The payslip invariants, read from outside the run. */
const payslipsHold = (w: World) =>
	Effect.gen(function* () {
		const rows = yield* stored(w);
		const runs = new Map(rows.payroll_run.rows.map((run) => [run.id, run]));
		const slips = new Map(rows.payslip.rows.map((slip) => [String(slip.id), slip]));
		let bonusPaid = 0;
		for (const slip of rows.payslip.rows) {
			const run = runs.get(slip.payroll_run_id);
			assert.ok(run !== undefined, `payslip ${slip.id} belongs to no run`);
			const lines = Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown).lines;
			for (const line of lines)
				if (line.source === 'adhoc_catalog_entry' && line.code === 'BONUS')
					bonusPaid += signed(line.direction, line.amount);
			if (run.state !== 'PAID') continue;
			const print = `${slip.net_pay.toNumber()} ${stableJson(slip.breakdown)}`;
			const first = w.paid.get(String(slip.id));
			if (first === undefined) w.paid.set(String(slip.id), print);
			else assert.equal(print, first, `paid payslip ${slip.id} changed`);
		}
		for (const id of w.paid.keys()) assert.ok(slips.has(id), `paid payslip ${id} is gone`);
		for (const entry of [
			...rows.leave_catalog_entry.rows,
			...rows.leave_catalog_entry_day.rows,
			...rows.claim_catalog_entry.rows,
			...rows.adhoc_catalog_entry.rows
		])
			assert.ok(
				entry.payroll_run_id == null || runs.has(entry.payroll_run_id),
				`${entry.id} is sealed by a run that is gone`
			);
		// a bonus pays its quantity: what the sealed ones come to, a reversal the other way, is on payslips exactly once
		const bonusSealed = rows.adhoc_catalog_entry.rows
			.filter((entry) => entry.payroll_run_id != null)
			.reduce(
				(total, entry) =>
					total + signed(entry.reverses == null ? 'ADD' : 'DEDUCT', entry.quantity.toNumber()),
				0
			);
		assert.equal(Math.round(bonusPaid * 100), Math.round(bonusSealed * 100), 'bonus paid ≠ sealed');
	});

const ACTIONS: readonly ((w: World) => Effect.Effect<void, unknown>)[] = [
	(w) => leaveOn(w, w.admin, 'ANNUAL_LEAVE'),
	(w) => leaveOn(w, w.admin, 'MEDICAL_LEAVE'),
	(w) => leaveOn(w, w.me, 'ANNUAL_LEAVE'),
	(w) =>
		Effect.gen(function* () {
			const row = pick(w, (yield* stored(w)).leave_catalog_entry.rows);
			yield* note(w, `delete leave ${row?.id}`);
			if (row !== undefined) yield* w.admin.act('leave_catalog_entry.delete', [{ target: row.id }]);
		}),
	(w) =>
		Effect.gen(function* () {
			const row = pick(w, (yield* stored(w)).leave_catalog_entry.rows);
			yield* note(w, `reverse leave ${row?.id}`);
			if (row === undefined) return;
			asked(
				w,
				yield* w.admin.act('leave_catalog_entry.create', [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: row.catalog_id,
						encashment: false,
						reverses: row.id,
						days: yield* reversalSlots(w.t, row.id)
					})
				])
			);
		}),
	(w) =>
		Effect.gen(function* () {
			const by = w.next() < 0.5 ? w.admin : w.me;
			const quantity = amount(w);
			yield* note(w, `claim ${quantity}${by === w.me ? ' asked' : ''}`);
			asked(
				w,
				yield* by.act('claim_catalog_entry.create', [
					{ ...entryOf(w, quantity), catalog_id: catalog('claim_catalog', 'MEDICAL_CLAIM') }
				])
			);
		}),
	(w) =>
		Effect.gen(function* () {
			const row = pick(w, (yield* stored(w)).claim_catalog_entry.rows);
			const quantity = amount(w);
			yield* note(w, `edit claim ${row?.id} ${quantity}`);
			if (row !== undefined)
				asked(
					w,
					yield* w.admin.act('claim_catalog_entry.update', [{ target: row.id, set: { quantity } }])
				);
		}),
	(w) =>
		Effect.gen(function* () {
			const row = pick(w, (yield* stored(w)).claim_catalog_entry.rows);
			yield* note(w, `delete claim ${row?.id}`);
			if (row !== undefined) yield* w.admin.act('claim_catalog_entry.delete', [{ target: row.id }]);
		}),
	(w) =>
		Effect.gen(function* () {
			const row = pick(w, (yield* stored(w)).claim_catalog_entry.rows);
			yield* note(w, `reverse claim ${row?.id}`);
			if (row !== undefined)
				yield* w.admin.act('claim_catalog_entry.create', [
					{
						...entryOf(w, row.quantity.toNumber()),
						catalog_id: row.catalog_id,
						reverses: row.id
					}
				]);
		}),
	(w) =>
		Effect.gen(function* () {
			const quantity = amount(w);
			yield* note(w, `adhoc ${quantity}`);
			yield* w.admin.act('adhoc_catalog_entry.create', [
				{
					...entryOf(w, quantity),
					catalog_id: catalog('adhoc_catalog', 'BONUS'),
					description: 'BONUS'
				}
			]);
		}),
	(w) =>
		Effect.gen(function* () {
			const row = pick(w, (yield* stored(w)).adhoc_catalog_entry.rows);
			const quantity = amount(w);
			yield* note(w, `edit adhoc ${row?.id} ${quantity}`);
			if (row !== undefined)
				yield* w.admin.act('adhoc_catalog_entry.update', [{ target: row.id, set: { quantity } }]);
		}),
	(w) =>
		Effect.gen(function* () {
			const row = pick(w, (yield* stored(w)).adhoc_catalog_entry.rows);
			yield* note(w, `delete adhoc ${row?.id}`);
			if (row !== undefined) yield* w.admin.act('adhoc_catalog_entry.delete', [{ target: row.id }]);
		}),
	(w) =>
		Effect.gen(function* () {
			const row = pick(w, (yield* stored(w)).adhoc_catalog_entry.rows);
			yield* note(w, `reverse adhoc ${row?.id}`);
			if (row !== undefined)
				yield* w.admin.act('adhoc_catalog_entry.create', [
					{
						...entryOf(w, row.quantity.toNumber()),
						catalog_id: row.catalog_id,
						description: 'BONUS',
						reverses: row.id
					}
				]);
		}),
	(w) => manual(w, 1),
	(w) => manual(w, -1),
	(w) =>
		Effect.gen(function* () {
			const period = String(addMonths(today(w), -Math.floor(w.next() * 3))).slice(0, 7);
			yield* note(w, `run ${period}`);
			yield* w.admin.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }]);
		}),
	(w) =>
		Effect.gen(function* () {
			const row = pick(w, (yield* stored(w)).payroll_run.rows);
			yield* note(w, `delete run ${row?.period}`);
			if (row !== undefined) yield* w.admin.act('payroll_run.delete', [{ target: row.id }]);
		}),
	(w) =>
		Effect.gen(function* () {
			const row = pick(w, (yield* stored(w)).payroll_run.rows);
			yield* note(w, `pay run ${row?.period}`);
			if (row !== undefined)
				yield* w.admin.act('payroll_run.update', [{ target: row.id, set: { state: 'PAID' } }]);
		}),
	(w) =>
		Effect.gen(function* () {
			// what the system raised waits beside what a person asked: an exit's cash-out or take-back
			const waiting = yield* w.chief.query({ leave_catalog_entry: { limit: 1000 } });
			for (const row of waiting.leave_catalog_entry.rows) {
				const id = row.$approval?.requestId;
				if (id !== undefined && !w.requests.includes(id)) w.requests.push(id);
			}
			const request = pick(w, w.requests);
			const approve = w.next() < 0.7;
			yield* note(w, `${approve ? 'approve' : 'reject'} ${request}`);
			if (request !== undefined)
				yield* w.chief.approvals.decide(
					request,
					approve ? { decision: 'approve' } : { decision: 'reject', reason: 'Not agreed' }
				);
		}),
	// a request taken back: by the employee who asked, or refused for one that is not theirs
	(w) =>
		Effect.gen(function* () {
			const request = pick(w, w.requests);
			yield* note(w, `withdraw ${request}`);
			if (request !== undefined) yield* w.me.approvals.decide(request, { decision: 'withdraw' });
		}),
	(w) =>
		Effect.gen(function* () {
			const next = `${String(addMonths(today(w), 1))}${START.slice(10)}`;
			yield* note(w, `clock ${next.slice(0, 10)}`);
			if (next.slice(0, 7) <= LAST_MONTH) w.t.clock.set(next);
		}),
	(w) =>
		Effect.gen(function* () {
			yield* note(w, 'ledger');
			yield* w.admin.start('ledger', {});
		}),
	// the exit: a last day this month or next, moved by drawing again, and taken off (twice as likely, so most
	// sequences go on past one)
	(w) =>
		exit(
			w,
			`${String(addMonths(today(w), w.next() < 0.5 ? 0 : 1)).slice(0, 7)}-${String(1 + Math.floor(w.next() * 28)).padStart(2, '0')}`
		),
	(w) => exit(w, null),
	(w) => exit(w, null),
	(w) =>
		Effect.gen(function* () {
			yield* note(w, 'exit follow-up again');
			yield* w.admin.start('encashment', { employments: [CONTRACT] });
		}),
	// a void contract takes no entry a run could pay
	(w) => leaveOn(w, w.admin, 'ANNUAL_LEAVE', VOIDED),
	(w) =>
		Effect.gen(function* () {
			const quantity = amount(w);
			yield* note(w, `adhoc ${quantity} on the void contract`);
			yield* w.admin.act('adhoc_catalog_entry.create', [
				{
					...entryOf(w, quantity),
					employment_id: VOIDED,
					catalog_id: catalog('adhoc_catalog', 'BONUS'),
					description: 'BONUS'
				}
			]);
		}),
	// a run made and deleted gives back exactly the ledger and the seals it took
	(w) =>
		Effect.gen(function* () {
			const period = String(addMonths(today(w), -Math.floor(w.next() * 3))).slice(0, 7);
			yield* note(w, `run and delete ${period}`);
			assert.deepEqual(yield* failures(w), []);
			const before = yield* standing(w);
			const had = new Set((yield* stored(w)).payroll_run.rows.map((run) => run.id));
			yield* w.admin.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }]);
			assert.deepEqual(yield* failures(w), []);
			const made = (yield* stored(w)).payroll_run.rows.find((run) => !had.has(run.id));
			if (made === undefined) return;
			yield* w.admin.act('payroll_run.delete', [{ target: made.id }]);
			assert.deepEqual(yield* standing(w), before, 'a deleted run did not give back what it took');
		}),
	// direct writes: a ledger row forged as a run's, the balance set by hand, a payslip added to a run
	(w) =>
		Effect.gen(function* () {
			const { by, name } = anyone(w);
			yield* note(w, `forged ledger row by ${name}`);
			yield* by.act('ledger_entry.create', [
				{
					balance_id: BALANCE,
					operation: 'DEDUCT',
					account: 'leave',
					code: 'ANNUAL_LEAVE',
					measure: 'used',
					period: 'MY.Y.2026-01-01',
					source: 'payroll_run:forged',
					amount: 3,
					unit: 'DAY',
					effective_on: PlainDate(today(w)),
					note: 'forged'
				}
			]);
		}),
	(w) =>
		Effect.gen(function* () {
			const { by, name } = anyone(w);
			yield* note(w, `balance set by ${name}`);
			yield* by.act('employee_balance.update', [{ target: BALANCE, set: { account: {} } }]);
		}),
	(w) =>
		Effect.gen(function* () {
			const { by, name } = anyone(w);
			const slip = pick(w, (yield* stored(w)).payslip.rows);
			yield* note(w, `payslip added by ${name} to run ${slip?.payroll_run_id}`);
			if (slip !== undefined)
				yield* by.act('payslip.create', [
					{
						payroll_run_id: slip.payroll_run_id,
						settings_id: slip.settings_id,
						employee_id: slip.employee_id,
						employment_id: slip.employment_id,
						entity_id: slip.entity_id,
						net_pay: 1_000_000,
						total_deductions: 0
					}
				]);
		})
];

/** How many rows the ledger and the records that post to it hold. */
const counts = (w: World) =>
	Effect.all([ledgerRows(w.t), stored(w)]).pipe(
		Effect.map(([ledger, rows]) => [
			ledger.length,
			rows.leave_catalog_entry.rows.length,
			rows.claim_catalog_entry.rows.length,
			rows.adhoc_catalog_entry.rows.length,
			rows.payroll_run.rows.length,
			rows.payslip.rows.length
		])
	);
const tagOf = (error: unknown) =>
	typeof error === 'object' && error !== null && '_tag' in error ? String(error._tag) : 'thrown';

describe('random sequences of real acts keep the ledger whole', () => {
	for (const from of SEEDS)
		it.live(
			`seed ${from}, ${STEPS} steps`,
			() => {
				const log: string[] = [];
				return Effect.gen(function* () {
					const t = yield* TestWorkspace;
					const dice = random(from);
					// its own stream, so repeating an act does not replay the decision to repeat
					const again = random(from ^ 0x9e3779b9);
					const w: World = {
						t,
						next: dice.next,
						admin: t.as(t.admin),
						hr: t.as(t.member(['hr_controller'])),
						me: t.as(t.member(['employee'], { id: uuid(3) })),
						chief: t.as(yield* t.signIn('chief@example.test')),
						requests: [],
						paid: new Map(),
						log
					};
					yield* syncAll(t);
					let committed = 0;
					let last:
						{ readonly action: (typeof ACTIONS)[number]; readonly state: number } | undefined;
					for (let step = 0; step < STEPS; step++) {
						// one step in six is the last act again, drawn the same: saved twice, paid twice, decided twice
						const repeat = last !== undefined && again.next() < 1 / 6 ? last : undefined;
						if (repeat !== undefined) dice.state = repeat.state;
						const action = repeat?.action ?? pick(w, ACTIONS);
						assert.ok(action !== undefined);
						if (repeat === undefined) last = { action, state: dice.state };
						const before = yield* counts(w);
						const failure = yield* Effect.match(action(w), {
							onFailure: (error): unknown => error,
							onSuccess: () => undefined
						});
						if (failure === undefined) committed++;
						else {
							log[log.length - 1] += ` -> ${String(failure)}`;
							// a refusal is an answer; a conflict or an unknown failure is a fault
							assert.equal(tagOf(failure), 'ActRefused', String(failure));
							assert.deepEqual(yield* counts(w), before, 'a refused act wrote rows');
						}
						assert.deepEqual(yield* failures(w), []);
						const hard = (yield* verify(t.storedQuery, today(w))).filter(
							(finding) => finding.invariant !== 'W1'
						);
						assert.deepEqual(hard, []);
						assert.deepEqual(flat(yield* accountsIn(t)), yield* projection(t));
						yield* payslipsHold(w);
					}
					// a sequence that was refused throughout proved nothing
					assert.ok(committed >= STEPS / 4, `only ${committed} of ${STEPS} steps went through`);
					assert.ok((yield* ledgerRows(t)).length > 0);
				}).pipe(
					Effect.onError(() =>
						Effect.sync(() =>
							console.error(
								`HR_SEED=${from} failed at step ${log.length - 1}:\n${log.map((line, index) => `${index} ${line}`).join('\n')}`
							)
						)
					),
					Effect.provide(workspace({ seed, now: START }))
				);
			},
			120_000
		);
});
