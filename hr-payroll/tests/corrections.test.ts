// Mistakes and their correction: each case does the mistaken thing through the real acts, reads every other record it
// moved (duties, held requests, the ledger and balance, payslips, locks), then takes the way back the system offers and
// reads the state again. Where the way back is a manual step, the test takes it. Public law packs are only the fixture:
// every expected figure is one the test keyed or the system itself produced.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate, addDays } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf, objectValue } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	PAY_GROUP,
	accountsIn,
	catalogRow,
	leaveCreate,
	ledgerRows,
	measureOf,
	pack,
	reversalSlots,
	syncAll,
	uuid,
	wholeDays,
	workspace
} from './kit.ts';

// inside one version of the law the template holds (8 July to 30 November 2026), so no run changes law under a case
const NOW = '2026-11-20T02:00:00.000Z';
const RATE = 3120;
const FLAT = 100;
const FIRST = idOf('employee_contract', uuid(6));
const SECOND = idOf('employee_contract', uuid(906));
const PERSON = uuid(4);
const OTHER_PERSON = uuid(904);
const BALANCE = idOf('employee_balance', uuid(5));
const OTHER_BALANCE = idOf('employee_balance', uuid(905));
const TERMS = {
	rate: { amount: RATE, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
type Seed = ReturnType<typeof pack>;
/**
 * One person under Malaysian law, an HR controller to decide what a policy holds, and annual leave cashed out at a flat
 * amount a day, so no statute's day rate is under test.
 */
const malaysia = (terms: JsonObject = TERMS, extension: JsonObject = {}): Seed => {
	const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, extension, [], [], '2026-08-15');
	return {
		...seed,
		leave_catalog: (seed.leave_catalog ?? []).map((row) =>
			row.code === 'ANNUAL_LEAVE' ? { ...row, payout: `return ${FLAT} * ctx.entry.quantity;` } : row
		),
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
};
/** A second person in the same company and payroll. */
const twoPeople = (): Seed => {
	const seed = malaysia();
	return {
		...seed,
		sys_user: [
			...(seed.sys_user ?? []),
			{ id: uuid(903), name: 'Second', email: 'second@example.test', kind: 'staff' }
		],
		employee_profile: [
			...(seed.employee_profile ?? []),
			{ id: OTHER_PERSON, user_id: uuid(903), name: 'Second' }
		],
		employee_balance: [
			...(seed.employee_balance ?? []),
			{ id: OTHER_BALANCE, employee_id: OTHER_PERSON, account: {} }
		],
		employee_contract: [
			...(seed.employee_contract ?? []),
			{
				...(seed.employee_contract?.[0] ?? {}),
				id: SECOND,
				employee_id: OTHER_PERSON,
				employee_number: 'W2'
			}
		]
	};
};
const seed = malaysia();
const refused = (effect: Effect.Effect<unknown, unknown>) =>
	Effect.flip(effect).pipe(Effect.map(String));
const CAPTURED = /Payroll run \d+ already captured this period/;

const run = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
const runOf = (t: Kit, period: string, kind: 'ON_CYCLE' | 'OFF_CYCLE' = 'ON_CYCLE') =>
	t.storedQuery({ payroll_run: { limit: 100 } }).pipe(
		Effect.map(({ payroll_run }) => {
			const ran = payroll_run.rows.find((row) => row.period === period && row.kind === kind);
			assert.ok(ran !== undefined, `${period} did not run`);
			return ran;
		})
	);
const pay = (t: Kit, period: string) =>
	Effect.gen(function* () {
		const ran = yield* runOf(t, period);
		yield* t.as(t.admin).act('payroll_run.update', [{ target: ran.id, set: { state: 'PAID' } }]);
		yield* t.runDue();
	});
const drop = (t: Kit, period: string) =>
	Effect.gen(function* () {
		const ran = yield* runOf(t, period);
		yield* t.as(t.admin).act('payroll_run.delete', [{ target: ran.id }]);
		yield* t.runDue();
	});
/** One person's payslip of a period's run. */
const slipOf = (
	t: Kit,
	period: string,
	employee: string = PERSON,
	kind: 'ON_CYCLE' | 'OFF_CYCLE' = 'ON_CYCLE'
) =>
	Effect.gen(function* () {
		const ran = yield* runOf(t, period, kind);
		const { payslip } = yield* t.storedQuery({ payslip: { limit: 100 } });
		const slip = payslip.rows.find(
			(row) => row.payroll_run_id === ran.id && row.employee_id === employee
		);
		assert.ok(slip !== undefined, `No payslip in ${period}`);
		return slip;
	});
const breakdown = (slip: { readonly breakdown: unknown }) =>
	Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown);
/** What a payslip's lines of one code come to: an addition counts up, a deduction down. */
const signed = (slip: { readonly breakdown: unknown }, code: string) =>
	breakdown(slip)
		.lines.filter((line) => line.code === code)
		.reduce((total, line) => total + (line.direction === 'DEDUCT' ? -1 : 1) * line.amount, 0);
/** The contract salary a payslip opened with. */
const basicOf = (slip: { readonly breakdown: unknown }) =>
	breakdown(slip).checkpoints.find((point) => point.code === 'BASIC')?.value;

const contracts = (t: Kit, status: 'DRAFT' | 'SEALED' | 'VOID') =>
	t
		.storedQuery({ employee_contract: { where: { status: { eq: status } }, limit: 100 } })
		.pipe(Effect.map(({ employee_contract }) => employee_contract.rows));
type Version = Effect.Success<ReturnType<typeof contracts>>[number];
type Patch = { readonly terms?: Version['terms']; readonly family?: Version['family'] };
/** One sealed version, by id. */
const versionOf = (t: Kit, id: Id<'employee_contract'>) =>
	contracts(t, 'SEALED').pipe(
		Effect.map((rows) => {
			const held = rows.find((row) => row.id === id);
			assert.ok(held !== undefined, 'No such sealed version');
			return held;
		})
	);
/** A draft successor of `held` from `from`, on its terms and family or the ones given. */
const draftOf = (t: Kit, held: Version, from: string, patch: Patch = {}) =>
	Effect.gen(function* () {
		const before = new Set((yield* contracts(t, 'DRAFT')).map((row) => row.id));
		yield* t.as(t.admin).act('employee_contract.create', [
			{
				employee_id: held.employee_id,
				entity_id: held.entity_id,
				engagement: held.engagement,
				employee_number: held.employee_number,
				terms: patch.terms ?? held.terms,
				payroll: held.payroll,
				bank: held.bank,
				family: patch.family ?? held.family,
				employee_extension_data: held.employee_extension_data,
				service_started_on: held.service_started_on,
				effective_range: { from: PlainDate(from), to: null },
				status: 'DRAFT',
				reason: 'A new version'
			}
		]);
		const made = (yield* contracts(t, 'DRAFT')).find((row) => !before.has(row.id));
		assert.ok(made !== undefined, 'No draft version');
		return made.id;
	});
const end = (t: Kit, held: Version, to: string | null, reason = 'Replaced') =>
	t.as(t.admin).act('employee_contract.update', [
		{
			target: held.id,
			set: {
				effective_range: {
					from: held.effective_range.from,
					to: to === null ? null : PlainDate(to)
				},
				reason
			}
		}
	]);
const seal = (t: Kit, id: Id<'employee_contract'>) =>
	t.as(t.admin).act('employee_contract.update', [{ target: id, set: { status: 'SEALED' } }]);
const voided = (t: Kit, id: Id<'employee_contract'>, reason: string) =>
	t
		.as(t.admin)
		.act('employee_contract.update', [{ target: id, set: { status: 'VOID', reason } }])
		.pipe(Effect.andThen(t.runDue()));
/** A new version from the first of a month, the way HR makes one: the draft, the last version's end, the seal. */
const amend = (t: Kit, held: Version, from: string, patch: Patch) =>
	Effect.gen(function* () {
		const next = yield* draftOf(t, held, from, patch);
		yield* end(t, held, String(addDays(PlainDate(from), -1)));
		yield* seal(t, next);
		yield* t.runDue();
		return next;
	});
const rated = (held: Version, amount: number): Version['terms'] => ({
	...held.terms,
	rate: { unit: 'MONTHLY', amount }
});

/** The duties an exit raised on the first contract. */
const exitDuties = (t: Kit) =>
	t
		.storedQuery({ obligation: { limit: 500 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.filter((row) => row.occurrence_key.includes(':exit:'))
			)
		);
const cashOuts = (t: Kit) =>
	t
		.storedQuery({ leave_catalog_entry: { where: { encashment: { eq: true } }, limit: 10 } })
		.pipe(Effect.map(({ leave_catalog_entry }) => leave_catalog_entry.rows));
/** The cash-out requests an HR controller still has to decide. */
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
const held = (t: Kit, code: string, employee: string = PERSON, family = 'leave') =>
	accountsIn(t, employee).pipe(
		Effect.map((accounts) => ({
			entitled: measureOf(accounts, family, code, 'entitled'),
			used: measureOf(accounts, family, code, 'used')
		}))
	);
const rowOf = (model: 'leave_catalog' | 'claim_catalog' | 'adhoc_catalog', code: string) =>
	catalogRow(seed, model, code);
const adhoc = (
	t: Kit,
	code: string,
	quantity: number,
	on: string,
	employment: Id<'employee_contract'> = FIRST,
	reverses: Id<'adhoc_catalog_entry'> | null = null
) =>
	Effect.gen(function* () {
		const before = new Set(
			(yield* t.storedQuery({ adhoc_catalog_entry: { limit: 100 } })).adhoc_catalog_entry.rows.map(
				(row) => row.id
			)
		);
		yield* t.as(t.admin).act('adhoc_catalog_entry.create', [
			{
				entity_id: ENTITY,
				employment_id: employment,
				catalog_id: idOf('adhoc_catalog', rowOf('adhoc_catalog', code)),
				description: code,
				quantity,
				incurred_on: PlainDate(on),
				reverses
			}
		]);
		yield* t.runDue();
		const made = (yield* t.storedQuery({
			adhoc_catalog_entry: { limit: 100 }
		})).adhoc_catalog_entry.rows.find((row) => !before.has(row.id));
		assert.ok(made !== undefined, 'No adhoc entry');
		return made.id;
	});
const claim = (
	t: Kit,
	quantity: number,
	on: string,
	reverses: Id<'claim_catalog_entry'> | null = null
) =>
	Effect.gen(function* () {
		const before = new Set(
			(yield* t.storedQuery({ claim_catalog_entry: { limit: 100 } })).claim_catalog_entry.rows.map(
				(row) => row.id
			)
		);
		yield* t.as(t.admin).act('claim_catalog_entry.create', [
			{
				entity_id: ENTITY,
				employment_id: FIRST,
				catalog_id: idOf('claim_catalog', rowOf('claim_catalog', 'MEDICAL_CLAIM')),
				quantity,
				incurred_on: PlainDate(on),
				reverses
			}
		]);
		yield* t.runDue();
		const made = (yield* t.storedQuery({
			claim_catalog_entry: { limit: 100 }
		})).claim_catalog_entry.rows.find((row) => !before.has(row.id));
		assert.ok(made !== undefined, 'No claim entry');
		return made.id;
	});
/**
 * A leave entry on whole days; with `reverses` it selects the original's slots. A cash-out reversal a policy holds for
 * review is approved by an HR controller, so what the test reads next has posted.
 */
const leave = (
	t: Kit,
	code: string,
	dates: readonly string[],
	options: {
		readonly employment?: Id<'employee_contract'>;
		readonly reverses?: Id<'leave_catalog_entry'>;
		readonly encashment?: boolean;
	} = {}
) =>
	Effect.gen(function* () {
		const before = new Set(
			(yield* t.storedQuery({ leave_catalog_entry: { limit: 100 } })).leave_catalog_entry.rows.map(
				(row) => row.id
			)
		);
		const days =
			options.reverses === undefined
				? wholeDays(...dates)
				: yield* reversalSlots(t, options.reverses);
		const result = yield* t.as(t.admin).act('leave_catalog_entry.create', [
			leaveCreate({
				entity_id: ENTITY,
				employment_id: options.employment ?? FIRST,
				catalog_id: idOf('leave_catalog', rowOf('leave_catalog', code)),
				encashment: options.encashment ?? false,
				reverses: options.reverses ?? null,
				days
			})
		]);
		if (result.kind === 'pendingApproval')
			yield* t
				.as(t.member(['hr_controller']))
				.approvals.decide(result.requestId, { decision: 'approve' });
		yield* t.runDue();
		const made = (yield* t.storedQuery({
			leave_catalog_entry: { limit: 100 }
		})).leave_catalog_entry.rows.find((row) => !before.has(row.id));
		assert.ok(made !== undefined, 'No leave entry');
		return made.id;
	});

// 1. transfer-semantics.md §3.4: an exit is read from the chain, so undoing one is a write to the chain. One routine
// then settles what the exit left (docs/0007 §4): its tasks are waived, the loan task with them, and a cash-out request
// still waiting is withdrawn. A cash-out a paid run took is
// reversed by HR, who is asked by one task.
describe('a contract ended by mistake', () => {
	const LAST = '2026-09-15';
	const ended = (t: Kit, first: Version) =>
		t
			.as(t.admin)
			.act('employee_contract.update', [
				{
					target: FIRST,
					set: {
						effective_range: { from: first.effective_range.from, to: PlainDate(LAST) },
						final_pay_due_on: PlainDate('2026-09-22'),
						reason: 'Resignation'
					}
				}
			])
			.pipe(Effect.andThen(t.runDue()));

	it.live(
		'before any run: reopened, its duties and the loan task are waived, the leave returns, the waiting cash-out request is withdrawn, and the month pays whole',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const before = yield* held(t, 'ANNUAL_LEAVE');
				const first = yield* versionOf(t, FIRST);
				yield* ended(t, first);
				// what the mistake moved: the exit duties, on the final pay date HR gave, and one held cash-out request
				const raised = (yield* exitDuties(t)).filter((row) => row.state === 'OPEN');
				assert.ok(raised.length > 0);
				assert.ok(raised.every((row) => row.occurrence_key.endsWith(`:exit:${LAST}`)));
				assert.equal(
					String(
						raised.find((row) =>
							row.occurrence_key.startsWith('MY:TERMINATION_BENEFITS_FINAL_WAGES:')
						)?.due_on
					),
					'2026-09-22'
				);
				const [request, ...more] = yield* cashOuts(t);
				assert.ok(request !== undefined);
				assert.deepEqual(more, []);
				const asked = yield* waiting(t);
				assert.equal(asked.ids.length, 1);
				// the loan task the contract page raises beside a leaver's recovery (see loan_lifecycle.test.ts)
				yield* t.as(t.admin).act('obligation.create', [
					{
						entity_id: ENTITY,
						employee_id: idOf('employee_profile', PERSON),
						employment_id: FIRST,
						title: 'Recover 500 from W1',
						due_on: PlainDate('2026-10-01'),
						occurrence_key: `LOAN_RECOVERY:${FIRST}:exit:${LAST}`
					}
				]);

				// the correction: the last day and the final pay date come off the version
				yield* t.as(t.admin).act('employee_contract.update', [
					{
						target: FIRST,
						set: {
							effective_range: { from: first.effective_range.from, to: null },
							final_pay_due_on: null,
							reason: 'Ended in error'
						}
					}
				]);
				yield* t.runDue();
				const reopened = yield* versionOf(t, FIRST);
				assert.equal(reopened.effective_range.to, null);
				assert.equal(reopened.final_pay_due_on ?? null, null);
				const after = yield* exitDuties(t);
				assert.deepEqual(
					after.filter((row) => row.state === 'OPEN'),
					[]
				);
				const waived = after.filter((row) => row.state === 'WAIVED');
				// every duty the law raised, and the loan task
				assert.equal(waived.length, raised.length + 1);
				assert.ok(waived.every((row) => /exit was cancelled/.test(String(row.waiver_reason))));
				const { obligation } = yield* t.storedQuery({ obligation: { limit: 500 } });
				assert.deepEqual(
					obligation.rows
						.filter((row) => row.occurrence_key.startsWith('LOAN_RECOVERY:'))
						.map((row) => row.state),
					['WAIVED']
				);
				// sync gives back what the exit's proration took
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).entitled, before.entitled);

				// the request that still waited is withdrawn by the system: nothing is left for HR to decide
				assert.deepEqual((yield* waiting(t)).ids, []);
				assert.deepEqual(yield* cashOuts(t), []);
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, before.used);

				// the month of the mistaken last day pays whole, with no cash-out, and the next month pays too
				yield* run(t, '2026-09');
				const september = yield* slipOf(t, '2026-09');
				assert.ok((september.gross_earnings?.toNumber() ?? 0) >= RATE);
				assert.equal(signed(september, 'ANNUAL_LEAVE'), 0);
				yield* run(t, '2026-10');
				assert.equal((yield* slipOf(t, '2026-10')).employment_id, FIRST);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	// The unpaid final run is the same lock with a way out: delete the run, then move the exit (cash_out.test.ts, “paid
	// in the final run, the exit cannot move under that run”). Paid, the run is the record and the correction goes forward.
	it.live(
		'after the final run is paid: the exit stands in that month; a new contract from the next month, an arrears entry and the cash-out reversal HR is asked for put it right, each paid once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const before = yield* held(t, 'ANNUAL_LEAVE');
				const first = yield* versionOf(t, FIRST);
				yield* ended(t, first);
				const { hr, ids } = yield* waiting(t);
				const [requestId] = ids;
				assert.ok(requestId !== undefined);
				yield* hr.approvals.decide(requestId, { decision: 'approve' });
				yield* t.runDue();
				const [request] = yield* cashOuts(t);
				assert.ok(request !== undefined);
				assert.ok((yield* held(t, 'ANNUAL_LEAVE')).used > before.used);
				yield* run(t, '2026-09');
				const final = yield* slipOf(t, '2026-09');
				const cashed = signed(final, 'ANNUAL_LEAVE');
				assert.ok(cashed > 0);
				yield* pay(t, '2026-09');

				// nothing reaches back into the paid month
				const leaver = yield* versionOf(t, FIRST);
				assert.match(yield* refused(end(t, leaver, null, 'Ended in error')), CAPTURED);
				assert.match(yield* refused(end(t, leaver, '2026-09-30', 'Ended in error')), CAPTURED);
				assert.match(yield* refused(drop(t, '2026-09')), /A paid run is locked/);

				// the way forward: the employment continues from the first month no run holds; the service start is carried
				// on the new version, so the gap does not restart the service year
				const next = yield* draftOf(t, leaver, '2026-10-01');
				yield* t.runDue();
				assert.deepEqual(
					(yield* exitDuties(t)).filter((row) => row.state === 'OPEN'),
					[]
				);
				yield* seal(t, next);
				yield* t.runDue();
				// manual: the pay of the days the exit cut off, as HR works it out
				const OWED = 1560;
				yield* adhoc(t, 'BPAYBS', OWED, '2026-10-01', next);
				// asked by the system, once: a task to reverse the paid cash-out. Nothing moves until HR keys it, as a cash-out
				const { obligation } = yield* t.storedQuery({ obligation: { limit: 500 } });
				assert.deepEqual(
					obligation.rows
						.filter((row) => row.occurrence_key.startsWith('reverse:'))
						.map((row) => [row.occurrence_key, row.state]),
					[[`reverse:${request.id}`, 'OPEN']]
				);
				assert.ok((yield* held(t, 'ANNUAL_LEAVE')).used > before.used);
				yield* leave(t, 'ANNUAL_LEAVE', [], { reverses: request.id, encashment: true });
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, before.used);

				yield* run(t, '2026-10');
				const october = yield* slipOf(t, '2026-10');
				assert.equal(october.employment_id, next);
				assert.equal(signed(october, 'BPAYBS'), OWED);
				assert.equal(signed(october, 'ANNUAL_LEAVE'), -cashed);
				// once: the next run carries neither, and the paid payslip was not rewritten
				yield* run(t, '2026-11');
				const november = yield* slipOf(t, '2026-11');
				assert.equal(signed(november, 'BPAYBS'), 0);
				assert.equal(signed(november, 'ANNUAL_LEAVE'), 0);
				const kept = yield* slipOf(t, '2026-09');
				assert.equal(kept.net_pay.toNumber(), final.net_pay.toNumber());
				assert.equal(signed(kept, 'ANNUAL_LEAVE'), cashed);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

// 2. A paid run is the record: nothing in it is edited. The correction is a new entry the next run pays once: a reversal
// of what it sealed, plus the entry as it should have been. Statutory corrections of a closed month are proven in
// eventual_sg_my.test.ts (“a contribution corrected for a closed month”), a loan repayment's in loan_lifecycle.test.ts.
describe('a paid run that needs an adjustment', () => {
	it.live(
		'is locked whole: no delete, no second run, no edit of what it sealed; a reversal and the right entry go to the next run, once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const bonus = yield* adhoc(t, 'BONUS', 500, '2026-08-10');
				const medical = yield* claim(t, 80, '2026-08-11');
				yield* run(t, '2026-08');
				yield* pay(t, '2026-08');
				const paid = yield* slipOf(t, '2026-08');
				assert.equal(signed(paid, 'BONUS'), 500);
				assert.equal(signed(paid, 'MEDICAL_CLAIM'), 80);

				assert.match(yield* refused(drop(t, '2026-08')), /A paid run is locked/);
				assert.match(yield* refused(run(t, '2026-08')), /already has this payroll_run/);
				const ran = yield* runOf(t, '2026-08');
				assert.equal(
					yield* Effect.isFailure(
						t.as(t.admin).act('payroll_run.update', [{ target: ran.id, set: { state: 'UNPAID' } }])
					),
					true
				);
				assert.equal((yield* runOf(t, '2026-08')).state, 'PAID');
				const admin = t.as(t.admin);
				assert.match(
					yield* refused(
						admin.act('adhoc_catalog_entry.update', [{ target: bonus, set: { quantity: 300 } }])
					),
					/locked/
				);
				assert.match(
					yield* refused(admin.act('adhoc_catalog_entry.delete', [{ target: bonus }])),
					/locked/
				);
				assert.match(
					yield* refused(
						admin.act('claim_catalog_entry.update', [{ target: medical, set: { quantity: 60 } }])
					),
					/locked/
				);
				assert.match(
					yield* refused(admin.act('claim_catalog_entry.delete', [{ target: medical }])),
					/locked/
				);

				// the way forward the lock leaves: undo each whole, and key it as it should have been
				yield* adhoc(t, 'BONUS', 500, '2026-09-05', FIRST, bonus);
				yield* adhoc(t, 'BONUS', 300, '2026-09-05');
				yield* claim(t, 80, '2026-09-05', medical);
				yield* claim(t, 60, '2026-09-05');
				// the balance already holds the claim as it should have been
				assert.equal((yield* held(t, 'MEDICAL_CLAIM', PERSON, 'claim')).used, 60);
				yield* run(t, '2026-09');
				const september = yield* slipOf(t, '2026-09');
				assert.equal(signed(september, 'BONUS'), 300 - 500);
				assert.equal(signed(september, 'MEDICAL_CLAIM'), 60 - 80);
				// once, and the paid payslip is not rewritten
				yield* run(t, '2026-10');
				const october = yield* slipOf(t, '2026-10');
				assert.equal(signed(october, 'BONUS'), 0);
				assert.equal(signed(october, 'MEDICAL_CLAIM'), 0);
				assert.equal((yield* slipOf(t, '2026-08')).net_pay.toNumber(), paid.net_pay.toNumber());
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'an underpayment that cannot wait goes out in an off-cycle run, and the next cycle does not pay it again',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t, '2026-08');
				yield* pay(t, '2026-08');
				const paid = yield* slipOf(t, '2026-08');
				const arrears = yield* adhoc(t, 'BPAYBS', 200, '2026-08-31');
				yield* t.as(t.admin).act('payroll_run.create', [
					{
						entity_id: ENTITY,
						period: '2026-08',
						kind: 'OFF_CYCLE',
						attaches: { adhoc: [arrears] }
					}
				]);
				yield* t.runDue();
				assert.equal(signed(yield* slipOf(t, '2026-08', PERSON, 'OFF_CYCLE'), 'BPAYBS'), 200);
				// the off-cycle run sealed it: it is no longer HR's to change
				assert.match(
					yield* refused(t.as(t.admin).act('adhoc_catalog_entry.delete', [{ target: arrears }])),
					/locked/
				);
				yield* run(t, '2026-09');
				assert.equal(signed(yield* slipOf(t, '2026-09'), 'BPAYBS'), 0);
				assert.equal((yield* slipOf(t, '2026-08')).net_pay.toNumber(), paid.net_pay.toNumber());
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

// 3. A sealed version's terms stand: the correction is another version. A change filed ahead and not yet sealed is
// edited or cancelled (contract_change.test.ts); a version under an unpaid run is freed by deleting the run and one
// under a paid run is corrected from the next month (contract_lifecycle.test.ts, “a contract under a run”).
describe('a contract version sealed with a wrong term', () => {
	const WRONG = 5300;
	const RIGHT = 3500;

	it.live(
		'no run yet: the replacement is drafted first and the wrong version voided, so the chain never reads as an exit',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const first = yield* versionOf(t, FIRST);
				const wrong = yield* amend(t, first, '2026-09-01', { terms: rated(first, WRONG) });
				const right = yield* draftOf(t, first, '2026-09-01', { terms: rated(first, RIGHT) });
				yield* voided(t, wrong, `Keyed ${WRONG} for ${RIGHT}`);
				yield* seal(t, right);
				yield* t.runDue();
				assert.deepEqual(yield* exitDuties(t), []);
				assert.deepEqual(yield* cashOuts(t), []);
				assert.deepEqual(
					(yield* contracts(t, 'VOID')).map((row) => row.id),
					[wrong]
				);
				yield* run(t, '2026-09');
				const slip = yield* slipOf(t, '2026-09');
				assert.deepEqual([slip.employment_id, basicOf(slip)], [right, RIGHT]);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	// Break-it: the same correction in the other order. With the wrong version void and nothing after it, the version
	// before it ends with no successor, which is what an exit is.
	it.live(
		'voided before its replacement exists: the version before it reads as an exit until the replacement is drafted, and the cash-out request it raised is withdrawn with it',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const before = yield* held(t, 'ANNUAL_LEAVE');
				const first = yield* versionOf(t, FIRST);
				const wrong = yield* amend(t, first, '2026-09-01', { terms: rated(first, WRONG) });
				yield* voided(t, wrong, `Keyed ${WRONG} for ${RIGHT}`);
				const raised = (yield* exitDuties(t)).filter((row) => row.state === 'OPEN');
				assert.ok(raised.length > 0);
				assert.ok(raised.every((row) => row.occurrence_key.endsWith(':exit:2026-08-31')));
				assert.equal((yield* cashOuts(t)).length, 1);

				const right = yield* draftOf(t, first, '2026-09-01', { terms: rated(first, RIGHT) });
				yield* t.runDue();
				assert.deepEqual(
					(yield* exitDuties(t)).filter((row) => row.state === 'OPEN'),
					[]
				);
				yield* seal(t, right);
				yield* t.runDue();
				// the request the mistaken exit raised is withdrawn with it
				assert.deepEqual((yield* waiting(t)).ids, []);
				assert.deepEqual(yield* cashOuts(t), []);
				const after = yield* held(t, 'ANNUAL_LEAVE');
				assert.deepEqual(after, before);
				yield* run(t, '2026-09');
				const slip = yield* slipOf(t, '2026-09');
				assert.deepEqual([slip.employment_id, basicOf(slip)], [right, RIGHT]);
				assert.equal(signed(slip, 'ANNUAL_LEAVE'), 0);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'after a paid run took it: the version is held, the right term starts the next month, and the difference is an arrears entry paid once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const LOW = 2500;
				const first = yield* versionOf(t, FIRST);
				const wrong = yield* amend(t, first, '2026-09-01', { terms: rated(first, LOW) });
				yield* run(t, '2026-09');
				yield* pay(t, '2026-09');
				assert.match(
					yield* refused(draftOf(t, first, '2026-09-01', { terms: rated(first, RIGHT) })),
					CAPTURED
				);
				const paid = yield* versionOf(t, wrong);
				const right = yield* amend(t, paid, '2026-10-01', { terms: rated(first, RIGHT) });
				// manual: HR works out what the wrong month fell short by
				yield* adhoc(t, 'BPAYBS', RIGHT - LOW, '2026-10-01', right);
				yield* run(t, '2026-10');
				const october = yield* slipOf(t, '2026-10');
				assert.deepEqual([october.employment_id, basicOf(october)], [right, RIGHT]);
				assert.equal(signed(october, 'BPAYBS'), RIGHT - LOW);
				const september = yield* slipOf(t, '2026-09');
				assert.deepEqual(
					[september.employment_id, basicOf(september)],
					[wrong, LOW],
					'the paid payslip is not rewritten'
				);
				yield* run(t, '2026-11');
				assert.equal(signed(yield* slipOf(t, '2026-11'), 'BPAYBS'), 0);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

// 4. A family fact is read by sync (the leave it opens) and by the run (the reliefs it gives). The correction is a
// version without it: sync posts the difference once, and a run already made keeps what it withheld.
describe('a family fact sealed wrongly', () => {
	const father = (): Seed => {
		const base = malaysia(
			{ ...TERMS, rate: { amount: 6000, unit: 'MONTHLY' }, statutory_work_category: 'NON_MANUAL' },
			{ family: [{ relation: 'SPOUSE', has_income: true }] }
		);
		return {
			...base,
			employee_contract: (base.employee_contract ?? []).map((row) => ({
				...row,
				payroll: { date_of_birth: '1990-01-01', gender: 'MALE', marital_status: 'MARRIED' }
			}))
		};
	};
	const PATERNITY = 'PATERNITY_LEAVE';
	const withChild = (first: Version, born: string): Version['family'] => [
		...(first.family ?? []),
		{ relation: 'CHILD', born_on: PlainDate(born) }
	];
	const grants = (t: Kit) =>
		ledgerRows(t).pipe(
			Effect.map((rows) =>
				rows
					.filter((row) => row.code === PATERNITY && row.measure === 'entitled')
					.map((row) => [row.operation, row.period, row.amount?.toNumber()])
					.toSorted()
			)
		);

	it.live(
		'a child that does not exist: the next version takes back the leave it opened, once, and the tax a run withheld under it stands',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				assert.equal((yield* held(t, PATERNITY)).entitled, 0);
				yield* run(t, '2026-08');
				const august = (yield* slipOf(t, '2026-08')).tax_withheld.toNumber();
				const first = yield* versionOf(t, FIRST);
				const wrong = yield* amend(t, first, '2026-09-01', {
					family: withChild(first, '2026-08-10')
				});
				yield* syncAll(t);
				const given = (yield* held(t, PATERNITY)).entitled;
				assert.ok(given > 0);
				yield* run(t, '2026-09');
				yield* pay(t, '2026-09');
				const september = (yield* slipOf(t, '2026-09')).tax_withheld.toNumber();
				// a dependant never raises the tax withheld
				assert.ok(september <= august);

				// the correction: a version without the child, from the first month no run holds
				yield* amend(t, yield* versionOf(t, wrong), '2026-10-01', { family: first.family });
				yield* syncAll(t);
				assert.equal((yield* held(t, PATERNITY)).entitled, 0);
				const moved = yield* grants(t);
				assert.equal(moved.length, 2);
				assert.deepEqual(
					moved.map(([operation, , amount]) => [operation, amount]),
					[
						['ADD', given],
						['DEDUCT', given]
					]
				);
				assert.equal(moved[0]?.[1], moved[1]?.[1]);
				// once: another sync finds nothing left to take
				yield* syncAll(t);
				assert.deepEqual(yield* grants(t), moved);

				// residue: September's payslip keeps the tax it withheld; no later run withholds less than it did
				yield* run(t, '2026-10');
				assert.equal((yield* slipOf(t, '2026-09')).tax_withheld.toNumber(), september);
				assert.ok((yield* slipOf(t, '2026-10')).tax_withheld.toNumber() >= september);
			}).pipe(Effect.provide(workspace({ seed: father(), now: NOW })))
	);

	it.live(
		'its leave already taken and paid: the correcting version is refused until a reversal gives the days back, then it seals and the days are keyed as the leave they were',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const annual = yield* held(t, 'ANNUAL_LEAVE');
				const first = yield* versionOf(t, FIRST);
				const wrong = yield* amend(t, first, '2026-09-01', {
					family: withChild(first, '2026-09-07')
				});
				yield* syncAll(t);
				const DAYS = ['2026-09-08', '2026-09-09'];
				const taken = yield* leave(t, PATERNITY, DAYS, { employment: wrong });
				assert.ok((yield* held(t, PATERNITY)).used > 0);
				yield* run(t, '2026-09');
				yield* pay(t, '2026-09');

				// the correcting version is drafted and the wrong one given its last day, but it cannot seal
				const held9 = yield* versionOf(t, wrong);
				const right = yield* draftOf(t, held9, '2026-10-01', { family: first.family });
				yield* end(t, held9, '2026-09-30');
				assert.match(yield* refused(seal(t, right)), /days taken stand on a fact/);
				// the days a run priced are not deleted
				assert.match(
					yield* refused(t.as(t.admin).act('leave_catalog_entry.delete', [{ target: taken }])),
					/Create a reversal/
				);
				// the way out: the reversal gives the days back, and the version seals
				yield* leave(t, PATERNITY, [], { employment: wrong, reverses: taken });
				assert.equal((yield* held(t, PATERNITY)).used, 0);
				yield* seal(t, right);
				yield* t.runDue();
				yield* syncAll(t);
				assert.deepEqual(yield* held(t, PATERNITY), { entitled: 0, used: 0 });
				// manual: the days off were real, so HR keys them on the leave they should have drawn
				yield* leave(t, 'ANNUAL_LEAVE', DAYS, { employment: wrong });
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, annual.used + DAYS.length);
				// no dead end: the next month runs on the right version
				yield* run(t, '2026-10');
				assert.equal((yield* slipOf(t, '2026-10')).employment_id, right);
			}).pipe(Effect.provide(workspace({ seed: father(), now: NOW })))
	);
});

// 5. Until a run seals it an entry is HR's to change or delete, and the balance follows each write; after, it is a
// reversal (the case above, ledger_limits.test.ts, no_pay_reversal.test.ts). A manual balance row is never changed.
describe('an entry keyed wrongly', () => {
	it.live(
		'before a run: a wrong amount is edited, a wrong date and a wrong person are deleted and keyed again, and the run pays what stands',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = t.as(t.admin);
				yield* syncAll(t);
				const annual = yield* held(t, 'ANNUAL_LEAVE');
				// the wrong person: nothing is sealed, so there is nothing to reverse
				const bonus = yield* adhoc(t, 'BONUS', 500, '2026-08-10', FIRST);
				assert.match(
					yield* refused(adhoc(t, 'BONUS', 500, '2026-08-10', FIRST, bonus)),
					/deleted instead/
				);
				yield* admin.act('adhoc_catalog_entry.delete', [{ target: bonus }]);
				yield* adhoc(t, 'BONUS', 500, '2026-08-10', SECOND);
				// the wrong amount: the balance follows the edit
				const medical = yield* claim(t, 80, '2026-08-11');
				assert.equal((yield* held(t, 'MEDICAL_CLAIM', PERSON, 'claim')).used, 80);
				yield* admin.act('claim_catalog_entry.update', [
					{ target: medical, set: { quantity: 60 } }
				]);
				yield* t.runDue();
				assert.equal((yield* held(t, 'MEDICAL_CLAIM', PERSON, 'claim')).used, 60);
				// the wrong date: the day comes back with the entry, and the right one draws it again
				const day = yield* leave(t, 'ANNUAL_LEAVE', ['2026-08-10']);
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, annual.used + 1);
				yield* admin.act('leave_catalog_entry.delete', [{ target: day }]);
				yield* t.runDue();
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, annual.used);
				yield* leave(t, 'ANNUAL_LEAVE', ['2026-08-11']);
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, annual.used + 1);
				// the ledger keeps the mistake and its inverse: nothing was erased
				const posted = (yield* ledgerRows(t)).filter(
					(row) => row.source === `leave_catalog_entry:${day}` && row.measure === 'used'
				);
				assert.deepEqual(posted.map((row) => row.operation).toSorted(), ['ADD', 'DEDUCT']);

				yield* run(t, '2026-08');
				const mine = yield* slipOf(t, '2026-08');
				assert.equal(signed(mine, 'BONUS'), 0);
				assert.equal(signed(mine, 'MEDICAL_CLAIM'), 60);
				assert.equal(signed(yield* slipOf(t, '2026-08', OTHER_PERSON), 'BONUS'), 500);
			}).pipe(Effect.provide(workspace({ seed: twoPeople(), now: NOW })))
	);

	it.live(
		'a manual balance row on the wrong person, for the wrong days: an opposite row and the right one, and none is ever changed',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_controller']));
				const IN_LIEU = 'PUBLIC_HOLIDAY_IN_LIEU';
				const adjust = (
					balance: Id<'employee_balance'>,
					operation: 'ADD' | 'DEDUCT',
					days: number,
					note: string
				) =>
					hr.act('ledger_entry.create', [
						{
							balance_id: balance,
							operation,
							account: 'leave',
							code: IN_LIEU,
							measure: 'entitled',
							amount: days,
							unit: 'DAY',
							effective_on: PlainDate('2026-11-02'),
							note
						}
					]);
				yield* syncAll(t);
				yield* adjust(BALANCE, 'ADD', 5, 'worked the holiday');
				assert.equal((yield* held(t, IN_LIEU)).entitled, 5);
				yield* adjust(BALANCE, 'DEDUCT', 5, 'keyed on the wrong person, for 5 not 0.5');
				yield* adjust(OTHER_BALANCE, 'ADD', 0.5, 'worked the holiday');
				assert.equal((yield* held(t, IN_LIEU)).entitled, 0);
				assert.equal((yield* held(t, IN_LIEU, OTHER_PERSON)).entitled, 0.5);
				const manual = (yield* ledgerRows(t)).filter((row) =>
					String(row.source).startsWith('manual:')
				);
				assert.deepEqual(
					manual
						.map((row) => [String(row.balance_id), row.operation, row.amount?.toNumber()])
						.toSorted(),
					[
						[BALANCE, 'ADD', 5],
						[BALANCE, 'DEDUCT', 5],
						[OTHER_BALANCE, 'ADD', 0.5]
					].toSorted()
				);
				// sync leaves all three alone
				const before = (yield* ledgerRows(t)).length;
				yield* syncAll(t);
				assert.equal((yield* ledgerRows(t)).length, before);
				assert.equal((yield* held(t, IN_LIEU, OTHER_PERSON)).entitled, 0.5);
			}).pipe(Effect.provide(workspace({ seed: twoPeople(), now: NOW })))
	);
});

// 6. A contract in the wrong pay group, and a group rescheduled after it ran, are proven in pay_groups.test.ts (“moved to
// B after A ran the month”, “a group rescheduled after it ran cannot pay the same days again”). What is left is a
// schedule term that was simply wrong.
describe('a pay group with a wrong pay day', () => {
	it.live(
		'corrected after a paid run: that run keeps its pay date and coverage, and the next cycle follows the corrected schedule',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t, '2026-08');
				yield* pay(t, '2026-08');
				yield* t.as(t.admin).act('pay_group.update', [
					{
						target: idOf('pay_group', PAY_GROUP),
						set: {
							payment_schedule: {
								frequency: 'MONTHLY',
								business_day: 'PREVIOUS',
								non_working_weekdays: [0, 6],
								short_month: 'LAST_DAY',
								pay_cutoff_day: 1,
								pay_days: [28]
							}
						}
					}
				]);
				yield* t.runDue();
				const august = yield* runOf(t, '2026-08');
				assert.deepEqual(
					[
						String(august.pay_date),
						String(august.salary_coverage.from),
						String(august.salary_coverage.to)
					],
					['2026-08-25', '2026-08-01', '2026-08-31']
				);
				yield* run(t, '2026-09');
				const september = yield* runOf(t, '2026-09');
				// no day is paid twice and none is skipped
				assert.deepEqual(
					[
						String(september.pay_date),
						String(september.salary_coverage.from),
						String(september.salary_coverage.to)
					],
					['2026-09-28', '2026-09-01', '2026-09-30']
				);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

// 7. A merged law change is a sealed version, and a run answers to the version in force on its pay date. The research
// pipeline is real, over the public Indonesian pack, with a scripted model (as statutory_research.test.ts).
describe('a law change merged by mistake', () => {
	const LAW_NOW = '2026-11-05T02:00:00.000Z';
	const law = (): { [model: string]: JsonObject[] } => {
		const rows: { [model: string]: JsonObject[] } = {};
		const root = join(process.cwd(), 'seed/public/jurisdiction/ID');
		for (const version of readdirSync(root))
			for (const file of readdirSync(join(root, version))) {
				const value: unknown = JSON.parse(readFileSync(join(root, version, file), 'utf8'));
				(rows[file.replace('.json', '')] ??= []).push(
					...(Array.isArray(value) ? value : [value]).map(objectValue)
				);
			}
		return {
			...rows,
			entity: [{ id: ENTITY, name: 'Entity', settings_code: 'ID' }],
			pay_group: [
				{
					id: PAY_GROUP,
					entity_id: ENTITY,
					name: 'Monthly',
					payment_schedule: {
						frequency: 'MONTHLY',
						business_day: 'PREVIOUS',
						non_working_weekdays: [0, 6],
						short_month: 'LAST_DAY',
						pay_cutoff_day: 1,
						pay_days: [25]
					}
				}
			],
			entity_profile_version: [
				{
					id: uuid(2),
					entity_id: ENTITY,
					name: 'Entity',
					settings_code: 'ID',
					input_schema_version_id: rows.jurisdiction_settings?.[0]?.id ?? null,
					effective_range: { from: '2025-01-01', to: null },
					time_zone: 'Asia/Jakarta',
					entity_extension_data: {},
					status: 'SEALED'
				}
			]
		};
	};
	const answer = (value: unknown) => ({
		content: JSON.stringify(value),
		toolCalls: [],
		finish: 'stop' as const,
		usage: { input: 0, output: 0 }
	});
	/** One research pass: an instrument found, then its one change to the JHT employee rate. */
	const found = (instrument: string, rate: number, from: string) => [
		answer({
			findings: [
				{
					instrument,
					title: 'JHT employee rate',
					fit: 'VALUE',
					families: ['statutory_contribution_catalog'],
					source_urls: ['https://jdih.kemnaker.go.id/permenaker.pdf'],
					source_quote: 'Iuran JHT pekerja.'
				}
			],
			new_sources: []
		}),
		answer({
			changes: [
				{
					row_code: 'JHT',
					field_path: 'lookup.employee_rate',
					new_value: rate,
					effective_from: from
				}
			]
		})
	];
	const scenario = (
		turns: readonly ReturnType<typeof answer>[],
		body: (t: Kit) => Effect.Effect<void, unknown>
	) =>
		Effect.gen(function* () {
			yield* body(yield* TestWorkspace);
		}).pipe(
			Effect.provide(
				workspace({
					seed: law(),
					now: LAW_NOW,
					fakes: { ai: { cassette: { strong: [...turns] } } },
					host: {
						agent: {
							hostTools: [
								{
									name: 'web_search',
									description: 'The host search the cassette never calls.',
									input: { type: 'object' },
									call: async () => []
								}
							]
						}
					}
				})
			)
		);
	/** Confirm the one finding still proposed and merge the release of `on`. */
	const released = (t: Kit, on: string) =>
		Effect.gen(function* () {
			const { statutory_finding } = yield* t.storedQuery({ statutory_finding: { limit: 100 } });
			const proposed = statutory_finding.rows.find((row) => row.status === 'PROPOSED');
			assert.ok(proposed !== undefined, 'Nothing is proposed');
			yield* t
				.as(t.admin)
				.act('statutory_finding.update', [{ target: proposed.id, set: { status: 'CONFIRMED' } }]);
			yield* t.as(t.admin).start('statutory_materialize', {
				code: 'ID',
				target: PlainDate(on),
				merge: true
			});
			yield* t.runDue();
		});
	/** Research once, confirm what it proposed and merge the release of `on`. */
	const merged = (t: Kit, on: string) =>
		t
			.as(t.admin)
			.start('statutory_research', { code: 'ID' })
			.pipe(Effect.andThen(t.runDue()), Effect.andThen(released(t, on)));
	const sealedLaw = (t: Kit) =>
		t
			.storedQuery({
				jurisdiction_settings: {
					where: { code: { eq: 'ID' }, status: { eq: 'SEALED' } },
					limit: 100
				}
			})
			.pipe(
				Effect.map(({ jurisdiction_settings }) =>
					jurisdiction_settings.rows.toSorted((left, right) =>
						String(left.effective_range.from).localeCompare(String(right.effective_range.from))
					)
				)
			);
	/** The sealed version starting on a day. */
	const lawFrom = (t: Kit, from: string) =>
		sealedLaw(t).pipe(
			Effect.map((rows) => {
				const version = rows.find((row) => String(row.effective_range.from) === from);
				assert.ok(version !== undefined, `No sealed law from ${from}`);
				return version;
			})
		);
	const rateIn = (t: Kit, version: Id<'jurisdiction_settings'>) =>
		t
			.storedQuery({
				statutory_contribution_catalog: {
					where: { settings_id: { eq: version }, code: { eq: 'JHT' } },
					limit: 1
				}
			})
			.pipe(
				Effect.map(
					({ statutory_contribution_catalog }) =>
						objectValue(statutory_contribution_catalog.rows[0]?.lookup).employee_rate
				)
			);
	const MISTAKEN = 0.025;

	it.live(
		'superseded: a corrective release from the next day ends it, and a run made under it is deleted and run again on the corrected law',
		() =>
			scenario(
				[
					...found('Permenaker 9/2027', MISTAKEN, '2026-11-01'),
					...found('Permenaker 10/2027', 0.02, '2026-11-02')
				],
				(t) =>
					Effect.gen(function* () {
						const stood = (yield* sealedLaw(t)).at(-1);
						assert.ok(stood !== undefined);
						const lawful = yield* rateIn(t, stood.id);
						yield* merged(t, '2026-11-01');
						const mistaken = yield* lawFrom(t, '2026-11-01');
						assert.equal(yield* rateIn(t, mistaken.id), MISTAKEN);
						// what it moves: every run whose pay date it covers
						yield* run(t, '2026-11');
						assert.equal((yield* runOf(t, '2026-11')).settings_id, mistaken.id);

						// the correction is a new release: the mistaken version stays sealed, for the one day it stood
						yield* merged(t, '2026-11-02');
						const corrected = yield* lawFrom(t, '2026-11-02');
						assert.equal(yield* rateIn(t, corrected.id), lawful);
						assert.equal(
							String((yield* lawFrom(t, '2026-11-01')).effective_range.to),
							'2026-11-01'
						);
						// the run made under the mistake keeps its law until it is deleted and run again
						assert.equal((yield* runOf(t, '2026-11')).settings_id, mistaken.id);
						yield* drop(t, '2026-11');
						yield* run(t, '2026-11');
						assert.equal((yield* runOf(t, '2026-11')).settings_id, corrected.id);
					})
			)
	);

	it.live(
		'voided: no run can be made until the release is merged again as it should have been, from the version that stood before',
		() =>
			scenario(found('Permenaker 9/2027', MISTAKEN, '2026-11-01'), (t) =>
				Effect.gen(function* () {
					const stood = (yield* sealedLaw(t)).at(-1);
					assert.ok(stood !== undefined);
					const lawful = yield* rateIn(t, stood.id);
					yield* merged(t, '2026-11-01');
					const mistaken = yield* lawFrom(t, '2026-11-01');
					yield* t.as(t.admin).act('jurisdiction_settings.update', [
						{
							target: mistaken.id,
							set: { status: 'VOID', reason: 'Merged with the wrong rate' }
						}
					]);
					yield* t.runDue();
					// the version before it was ended to make room, and a sealed version only ever shortens
					assert.match(yield* refused(run(t, '2026-11')), /No sealed ID law covers 2026-11-\d\d/);
					assert.match(
						yield* refused(
							t.as(t.admin).act('jurisdiction_settings.update', [
								{
									target: stood.id,
									set: {
										effective_range: {
											from: stood.effective_range.from,
											to: PlainDate('2026-11-30')
										}
									}
								}
							])
						),
						/may only shorten its future effective period/
					);
					// the way out: the release as it should have been, on the same date. Research reads only law still in
					// force today and the last version has ended, so HR files the finding and its change by hand, against the
					// version that stood before; the materializer takes that version as its baseline.
					yield* t.as(t.admin).act('statutory_finding.create', [
						{
							jurisdiction_code: 'ID',
							instrument_key: 'permenaker-10-2027',
							title: 'JHT employee rate, as the instrument states it',
							fit: 'VALUE',
							status: 'PROPOSED',
							families: ['statutory_contribution_catalog'],
							source_urls: ['https://jdih.kemnaker.go.id/permenaker.pdf'],
							source_quote: 'Iuran JHT pekerja.'
						}
					]);
					const { statutory_finding } = yield* t.storedQuery({
						statutory_finding: { where: { status: { eq: 'PROPOSED' } }, limit: 10 }
					});
					const [filed, ...others] = statutory_finding.rows;
					assert.ok(filed !== undefined);
					assert.deepEqual(others, []);
					yield* t.as(t.admin).act('statutory_change.create', [
						{
							finding_id: filed.id,
							jurisdiction_code: 'ID',
							family: 'statutory_contribution_catalog',
							row_code: 'JHT',
							field_path: 'lookup.employee_rate',
							old_value: lawful ?? null,
							new_value: 0.021,
							effective_from: PlainDate('2026-11-01'),
							baseline_version_id: stood.id
						}
					]);
					yield* released(t, '2026-11-01');
					const replacement = yield* lawFrom(t, '2026-11-01');
					assert.notEqual(replacement.id, mistaken.id);
					assert.equal(yield* rateIn(t, replacement.id), 0.021);
					yield* run(t, '2026-11');
					assert.equal((yield* runOf(t, '2026-11')).settings_id, replacement.id);
				})
			)
	);
});
