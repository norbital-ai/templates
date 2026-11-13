// Mistakes and their correction: each case does the mistaken thing through the real acts, reads every other record it
// moved (duties, held requests, the ledger and balance, payslips, amendment rows), then corrects the record where it was
// recorded and reads the state again. Where the way back is a manual step, the test takes it. The Malaysian pack is only
// the fixture: every expected figure is one the test keyed or the system itself produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { add_days, plain_date } from '../../src/lib/date.ts';
import { Effect, Schema } from 'effect';
import { verify } from '../../src/lib/integrity.ts';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	leaveCreate,
	ledgerRows,
	measureOf,
	pack,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	refusal,
	storedQuery,
	storedReader,
	current,
	decimalNumber
} from '../kit.ts';
import { decimalText } from '../../src/lib/payroll_engine/money.ts';

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
/** One person under Malaysian law, and annual leave cashed out at a flat amount a day, so no statute's day rate is under test. */
const malaysia = (terms: JsonObject = TERMS, extension: JsonObject = {}): Seed => {
	const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, extension, [], [], '2026-08-15');
	return {
		...seed,
		leave_catalog: (seed.leave_catalog ?? []).map((row) =>
			row.code === 'ANNUAL_LEAVE' ? { ...row, payout: `return ${FLAT} * ctx.entry.quantity;` } : row
		)
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

const run = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.pipe(
			Effect.andThen((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
			)
		)
		.pipe(Effect.andThen(t.run_due()));
const runOf = (t: Kit, period: string, kind: 'ON_CYCLE' | 'OFF_CYCLE' = 'ON_CYCLE') =>
	storedQuery(t, { payroll_run: { limit: 100 } }).pipe(
		Effect.map(({ payroll_run }) => {
			const ran = payroll_run.rows.find((row) => row.period === period && row.kind === kind);
			assert.ok(ran !== undefined, `${period} did not run`);
			return ran;
		})
	);
const pay = (t: Kit, period: string) =>
	Effect.gen(function* () {
		const ran = yield* runOf(t, period);
		yield* t
			.as(t.admin)
			.pipe(
				Effect.andThen((caller) =>
					caller.act({ 'payroll_run.update': [{ target: ran, set: { state: 'PAID' } }] })
				)
			);
		yield* t.run_due();
	});
const drop = (t: Kit, period: string) =>
	Effect.gen(function* () {
		const ran = yield* runOf(t, period);
		yield* t
			.as(t.admin)
			.pipe(Effect.andThen((caller) => caller.act({ 'payroll_run.delete': [{ target: ran }] })));
		yield* t.run_due();
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
		const { payslip } = yield* storedQuery(t, { payslip: { limit: 100 } });
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
/** What a payslip carries for an earlier period: its lines tagged with that period. */
const carriedFor = (slip: { readonly breakdown: unknown }, period: string) =>
	breakdown(slip).lines.filter((line) => line.period === period);
/** What the carried lines of one code come to. */
const carriedOf = (slip: { readonly breakdown: unknown }, period: string, code: string) =>
	carriedFor(slip, period)
		.filter((line) => line.code === code)
		.reduce((total, line) => total + (line.direction === 'DEDUCT' ? -1 : 1) * line.amount, 0);
/** Every amendment row: its paid period, and the run that took it (none while it is open). */
const amendments = (t: Kit) =>
	storedQuery(t, { pay_amendment: { limit: 100 } }).pipe(
		Effect.map(({ pay_amendment }) =>
			pay_amendment.rows.map((row) => [row.period, row.payroll_run_id ?? null])
		)
	);
/** The contract salary a payslip opened with. */
const basicOf = (slip: { readonly breakdown: unknown }) =>
	breakdown(slip).checkpoints.find((point) => point.code === 'BASIC')?.value;

const contracts = (t: Kit, status: 'DRAFT' | 'SEALED' | 'VOID') =>
	storedQuery(t, { employee_contract: { where: { status: { eq: status } }, limit: 100 } }).pipe(
		Effect.map(({ employee_contract }) => employee_contract.rows)
	);
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
		yield* t.as(t.admin).pipe(
			Effect.andThen((caller) =>
				caller.act({
					'employee_contract.create': [
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
							effective_range: { from: plain_date(from), to: null },
							status: 'DRAFT',
							reason: 'A new version'
						}
					]
				})
			)
		);
		const made = (yield* contracts(t, 'DRAFT')).find((row) => !before.has(row.id));
		assert.ok(made !== undefined, 'No draft version');
		return made.id;
	});
const end = (t: Kit, held: Version, to: string | null, reason = 'Replaced') =>
	t.as(t.admin).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'employee_contract.update': [
					{
						target: held,
						set: {
							effective_range: {
								from: held.effective_range.from,
								to: to === null ? null : plain_date(to)
							},
							reason
						}
					}
				]
			})
		)
	);
const seal = (t: Kit, id: Id<'employee_contract'>) =>
	Effect.gen(function* () {
		const target = yield* current(t, 'employee_contract', id);
		const admin = yield* t.as(t.admin);
		return yield* admin.act({
			'employee_contract.update': [{ target, set: { status: 'SEALED' } }]
		});
	});
const voided = (t: Kit, id: Id<'employee_contract'>, reason: string) =>
	Effect.gen(function* () {
		const target = yield* current(t, 'employee_contract', id);
		const admin = yield* t.as(t.admin);
		yield* admin.act({ 'employee_contract.update': [{ target, set: { status: 'VOID', reason } }] });
		yield* t.run_due();
	});
/** A new version from the first of a month, the way HR makes one: the draft, the last version's end, the seal. */
const amend = (t: Kit, held: Version, from: string, patch: Patch) =>
	Effect.gen(function* () {
		const next = yield* draftOf(t, held, from, patch);
		yield* end(t, held, String(add_days(plain_date(from), -1)));
		yield* seal(t, next);
		yield* t.run_due();
		return next;
	});
const rated = (held: Version, amount: number): Version['terms'] => ({
	...held.terms,
	rate: { unit: 'MONTHLY', amount }
});

/** The duties an exit raised on the first contract. */
const exitDuties = (t: Kit) =>
	storedQuery(t, { obligation: { limit: 500 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows.filter((row) => row.occurrence_key.includes(':exit:'))
		)
	);
const cashOuts = (t: Kit) =>
	storedQuery(t, { leave_catalog_entry: { where: { encashment: { eq: true } }, limit: 10 } }).pipe(
		Effect.map(({ leave_catalog_entry }) => leave_catalog_entry.rows)
	);
/** The ledger after a case: no queued work failed, and only the watch for a balance below zero may remain. */
const ledgerWhole = (t: Kit) =>
	Effect.gen(function* () {
		assert.deepEqual((yield* t.run_due()).failed, []);
		assert.deepEqual(
			(yield* verify(storedReader(t), NOW.slice(0, 10)))
				.filter((finding) => finding.invariant !== 'W1')
				.map((finding) => `${finding.invariant} ${finding.message}`),
			[]
		);
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
	employment: Id<'employee_contract'> = FIRST
) =>
	Effect.gen(function* () {
		const before = new Set(
			(yield* storedQuery(t, { adhoc_catalog_entry: { limit: 100 } })).adhoc_catalog_entry.rows.map(
				(row) => row.id
			)
		);
		yield* t.as(t.admin).pipe(
			Effect.andThen((caller) =>
				caller.act({
					'adhoc_catalog_entry.create': [
						{
							entity_id: ENTITY,
							employment_id: employment,
							catalog_id: idOf('adhoc_catalog', rowOf('adhoc_catalog', code)),
							description: code,
							quantity: decimalText(quantity),
							incurred_on: plain_date(on)
						}
					]
				})
			)
		);
		yield* t.run_due();
		const made = (yield* storedQuery(t, {
			adhoc_catalog_entry: { limit: 100 }
		})).adhoc_catalog_entry.rows.find((row) => !before.has(row.id));
		assert.ok(made !== undefined, 'No adhoc entry');
		return made.id;
	});
const claim = (t: Kit, quantity: number, on: string) =>
	Effect.gen(function* () {
		const before = new Set(
			(yield* storedQuery(t, { claim_catalog_entry: { limit: 100 } })).claim_catalog_entry.rows.map(
				(row) => row.id
			)
		);
		yield* t.as(t.admin).pipe(
			Effect.andThen((caller) =>
				caller.act({
					'claim_catalog_entry.create': [
						{
							entity_id: ENTITY,
							employment_id: FIRST,
							catalog_id: idOf('claim_catalog', rowOf('claim_catalog', 'MEDICAL_CLAIM')),
							quantity: decimalText(quantity),
							incurred_on: plain_date(on)
						}
					]
				})
			)
		);
		yield* t.run_due();
		const made = (yield* storedQuery(t, {
			claim_catalog_entry: { limit: 100 }
		})).claim_catalog_entry.rows.find((row) => !before.has(row.id));
		assert.ok(made !== undefined, 'No claim entry');
		return made.id;
	});
/** A leave entry on whole days. One a policy holds is approved by an HR controller, so what is read next has posted. */
const leave = (
	t: Kit,
	code: string,
	dates: readonly string[],
	options: { readonly employment?: Id<'employee_contract'> } = {}
) =>
	Effect.gen(function* () {
		const before = new Set(
			(yield* storedQuery(t, { leave_catalog_entry: { limit: 100 } })).leave_catalog_entry.rows.map(
				(row) => row.id
			)
		);
		const result = yield* t.as(t.admin).pipe(
			Effect.andThen((caller) =>
				caller.act({
					'leave_catalog_entry.create': [
						leaveCreate({
							entity_id: ENTITY,
							employment_id: options.employment ?? FIRST,
							catalog_id: idOf('leave_catalog', rowOf('leave_catalog', code)),
							encashment: false,
							days: wholeDays(...dates)
						})
					]
				})
			)
		);
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

// 1. transfer-semantics.md §3.4: an exit is read from the chain, so undoing one is a write to the chain. One routine
// then settles what the exit left (docs/0007 §4): its tasks are waived, the loan task with them. The leave is settled by
// the last payslip itself, so nothing is keyed to withdraw; a paid one is amended, and the next run takes the money back.
describe('a contract ended by mistake', () => {
	const LAST = '2026-09-15';
	const ended = (t: Kit, first: Version) =>
		t
			.as(t.admin)
			.pipe(
				Effect.andThen((caller) =>
					caller.act({
						'employee_contract.update': [
							{
								target: first,
								set: {
									effective_range: { from: first.effective_range.from, to: plain_date(LAST) },
									final_pay_due_on: '2026-09-22',
									reason: 'Resignation'
								}
							}
						]
					})
				)
			)
			.pipe(Effect.andThen(t.run_due()));

	it.live(
		'before any run: reopened, its duties and the loan task are waived, the leave returns, and the month pays whole',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const before = yield* held(t, 'ANNUAL_LEAVE');
				const first = yield* versionOf(t, FIRST);
				yield* ended(t, first);
				// what the mistake moved: the exit duties, on the final pay date HR gave; no cash-out is keyed
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
				assert.deepEqual(yield* cashOuts(t), []);
				// the loan task the contract page raises beside a leaver's recovery
				yield* t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'obligation.create': [
								{
									entity_id: ENTITY,
									employee_id: idOf('employee_profile', PERSON),
									employment_id: FIRST,
									title: 'Recover 500 from W1',
									due_on: '2026-10-01',
									occurrence_key: `LOAN_RECOVERY:${FIRST}:exit:${LAST}`
								}
							]
						})
					)
				);

				// the correction: the last day and the final pay date come off the version
				yield* (yield* t.as(t.admin)).act({
					'employee_contract.update': [
						{
							target: yield* current(t, 'employee_contract', FIRST),
							set: {
								effective_range: { from: first.effective_range.from, to: null },
								final_pay_due_on: null,
								reason: 'Ended in error'
							}
						}
					]
				});
				yield* t.run_due();
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
				const { obligation } = yield* storedQuery(t, { obligation: { limit: 500 } });
				assert.deepEqual(
					obligation.rows
						.filter((row) => row.occurrence_key.startsWith('LOAN_RECOVERY:'))
						.map((row) => row.state),
					['WAIVED']
				);
				// sync gives back what the exit's proration took
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).entitled, before.entitled);

				assert.deepEqual(yield* held(t, 'ANNUAL_LEAVE'), before);

				// the month of the mistaken last day pays whole, with no cash-out, and the next month pays too
				yield* run(t, '2026-09');
				const september = yield* slipOf(t, '2026-09');
				assert.ok((decimalNumber(september.gross_earnings) ?? 0) >= RATE);
				assert.equal(signed(september, 'ANNUAL_LEAVE'), 0);
				yield* run(t, '2026-10');
				assert.equal((yield* slipOf(t, '2026-10')).employment_id, FIRST);
				assert.deepEqual(yield* held(t, 'ANNUAL_LEAVE'), before);
				yield* ledgerWhole(t);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	// The unpaid final run is deleted first, then the exit moves. Paid, the run is the record: the exit
	// is still corrected where it was recorded, and the next run carries what the month now owes.
	it.live(
		'after the final run is paid: the exit is reopened on the version itself; the paid payslip stands and the next run takes the pay-out back, carries the month and returns the days',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const before = yield* held(t, 'ANNUAL_LEAVE');
				const first = yield* versionOf(t, FIRST);
				yield* ended(t, first);
				yield* run(t, '2026-09');
				const final = yield* slipOf(t, '2026-09');
				// the last payslip pays out what is left, and its posting uses it up
				const cashed = signed(final, 'ANNUAL_LEAVE');
				assert.ok(cashed > 0);
				yield* pay(t, '2026-09');
				assert.deepEqual(yield* amendments(t), []);
				const settled = yield* held(t, 'ANNUAL_LEAVE');
				assert.equal(settled.entitled - settled.used, 0);

				// the paid run itself is never deleted
				assert.match((yield* refusal(drop(t, '2026-09'))).message, /This record is locked/);
				// the correction: the last day and the final pay date come off the version, and the write leaves the
				// month to be worked out again
				yield* (yield* t.as(t.admin)).act({
					'employee_contract.update': [
						{
							target: yield* current(t, 'employee_contract', FIRST),
							set: {
								effective_range: { from: first.effective_range.from, to: null },
								final_pay_due_on: null,
								reason: 'Ended in error'
							}
						}
					]
				});
				yield* t.run_due();
				assert.equal((yield* versionOf(t, FIRST)).effective_range.to, null);
				assert.deepEqual(yield* amendments(t), [['2026-09', null]]);
				assert.deepEqual(
					(yield* exitDuties(t)).filter((row) => row.state === 'OPEN'),
					[]
				);
				assert.deepEqual(yield* cashOuts(t), []);
				// the paid payslip was not rewritten
				const kept = yield* slipOf(t, '2026-09');
				assert.equal(Number(kept.net_pay), Number(final.net_pay));
				assert.equal(signed(kept, 'ANNUAL_LEAVE'), cashed);

				// the next run pays the person on the same contract, carries September and takes the row
				yield* run(t, '2026-10');
				const october = yield* slipOf(t, '2026-10');
				assert.equal(october.employment_id, FIRST);
				assert.ok(carriedFor(october, '2026-09').length > 0);
				assert.equal(carriedOf(october, '2026-09', 'ANNUAL_LEAVE'), -cashed);
				assert.deepEqual(yield* amendments(t), [['2026-09', (yield* runOf(t, '2026-10')).id]]);
				// the days the pay-out used return with it
				assert.deepEqual(yield* held(t, 'ANNUAL_LEAVE'), before);
				yield* ledgerWhole(t);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

// 2. A paid run is the record: its payslips never change. What it sealed is corrected where it was recorded, and the
// next run carries the difference, tagged with the paid period, once.
describe('a paid run that needs an adjustment', () => {
	it.live(
		'is the record: no delete, no second run, no way back to unpaid; an entry it sealed is corrected on the entry, and the next run carries the difference, once',
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

				assert.match((yield* refusal(drop(t, '2026-08'))).message, /This record is locked/);
				assert.match((yield* refusal(run(t, '2026-08'))).message, /already has this payroll_run/);
				const ran = yield* runOf(t, '2026-08');
				assert.equal(
					yield* Effect.isFailure(
						t
							.as(t.admin)
							.pipe(
								Effect.andThen((caller) =>
									caller.act({ 'payroll_run.update': [{ target: ran, set: { state: 'UNPAID' } }] })
								)
							)
					),
					true
				);
				assert.equal((yield* runOf(t, '2026-08')).state, 'PAID');

				// the correction: each entry is keyed as it should have been, on the entry itself
				const admin = yield* t.as(t.admin);
				assert.deepEqual(yield* amendments(t), []);
				yield* admin.act({
					'adhoc_catalog_entry.update': [
						{ target: yield* current(t, 'adhoc_catalog_entry', bonus), set: { quantity: '300' } }
					]
				});
				yield* admin.act({
					'claim_catalog_entry.update': [
						{ target: yield* current(t, 'claim_catalog_entry', medical), set: { quantity: '60' } }
					]
				});
				yield* t.run_due();
				// one open row for the person's August, however many corrections; the balance follows the edit
				assert.deepEqual(yield* amendments(t), [['2026-08', null]]);
				assert.equal((yield* held(t, 'MEDICAL_CLAIM', PERSON, 'claim')).used, 60);
				assert.equal(Number((yield* slipOf(t, '2026-08')).net_pay), Number(paid.net_pay));

				yield* run(t, '2026-09');
				const september = yield* slipOf(t, '2026-09');
				assert.equal(carriedOf(september, '2026-08', 'BONUS'), 300 - 500);
				assert.equal(carriedOf(september, '2026-08', 'MEDICAL_CLAIM'), 60 - 80);
				assert.deepEqual(yield* amendments(t), [['2026-08', (yield* runOf(t, '2026-09')).id]]);
				// once, and the paid payslip is not rewritten
				yield* run(t, '2026-10');
				const october = yield* slipOf(t, '2026-10');
				assert.equal(signed(october, 'BONUS'), 0);
				assert.equal(signed(october, 'MEDICAL_CLAIM'), 0);
				assert.equal(Number((yield* slipOf(t, '2026-08')).net_pay), Number(paid.net_pay));
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
				const owed = yield* current(t, 'adhoc_catalog_entry', arrears);
				yield* t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'payroll_run.create': [
								{
									entity_id: ENTITY,
									period: '2026-08',
									kind: 'OFF_CYCLE',
									adhoc: [owed]
								}
							]
						})
					)
				);
				yield* t.run_due();
				assert.equal(signed(yield* slipOf(t, '2026-08', PERSON, 'OFF_CYCLE'), 'BPAYBS'), 200);
				yield* run(t, '2026-09');
				assert.equal(signed(yield* slipOf(t, '2026-09'), 'BPAYBS'), 0);
				assert.equal(Number((yield* slipOf(t, '2026-08')).net_pay), Number(paid.net_pay));
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

// 3. A sealed version's terms stand: the correction is another version over the same days. A change filed ahead and
// not yet sealed is edited or cancelled; a version under an unpaid run is freed by deleting the
// run, and one a paid run took is replaced all the same: the next run carries the difference.
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
				yield* t.run_due();
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
		'voided before its replacement exists: the version before it reads as an exit until the replacement is drafted, and its leave returns with it',
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
				assert.deepEqual(yield* cashOuts(t), []);

				const right = yield* draftOf(t, first, '2026-09-01', { terms: rated(first, RIGHT) });
				yield* t.run_due();
				assert.deepEqual(
					(yield* exitDuties(t)).filter((row) => row.state === 'OPEN'),
					[]
				);
				yield* seal(t, right);
				yield* t.run_due();
				const after = yield* held(t, 'ANNUAL_LEAVE');
				assert.deepEqual(after, before);
				yield* run(t, '2026-09');
				const slip = yield* slipOf(t, '2026-09');
				assert.deepEqual([slip.employment_id, basicOf(slip)], [right, RIGHT]);
				assert.equal(signed(slip, 'ANNUAL_LEAVE'), 0);
				yield* ledgerWhole(t);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'after a paid run took it: the version is replaced from its own first day, the paid payslip stands, and the next run carries the difference, once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const LOW = 2500;
				const first = yield* versionOf(t, FIRST);
				const wrong = yield* amend(t, first, '2026-09-01', { terms: rated(first, LOW) });
				yield* run(t, '2026-09');
				yield* pay(t, '2026-09');
				assert.deepEqual(yield* amendments(t), []);

				// the correction, in the order that never reads as an exit: the replacement drafted, the wrong one voided
				const right = yield* draftOf(t, first, '2026-09-01', { terms: rated(first, RIGHT) });
				yield* voided(t, wrong, `Keyed ${LOW} for ${RIGHT}`);
				yield* seal(t, right);
				yield* t.run_due();
				assert.deepEqual(yield* amendments(t), [['2026-09', null]]);
				const september = yield* slipOf(t, '2026-09');
				assert.deepEqual(
					[september.employment_id, basicOf(september)],
					[wrong, LOW],
					'the paid payslip is not rewritten'
				);

				yield* run(t, '2026-10');
				const october = yield* slipOf(t, '2026-10');
				assert.deepEqual([october.employment_id, basicOf(october)], [right, RIGHT]);
				// September on the right term pays more than it did: the rest is on October's payslip, tagged with its month
				assert.ok(
					carriedFor(october, '2026-09').some(
						(line) => line.party === 'EMPLOYEE' && line.direction === 'ADD' && line.amount > 0
					)
				);
				assert.deepEqual(yield* amendments(t), [['2026-09', (yield* runOf(t, '2026-10')).id]]);
				yield* run(t, '2026-11');
				assert.deepEqual(carriedFor(yield* slipOf(t, '2026-11'), '2026-09'), []);
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
		{ relation: 'CHILD', born_on: plain_date(born) }
	];
	const grants = (t: Kit) =>
		ledgerRows(t).pipe(
			Effect.map((rows) =>
				rows
					.filter((row) => row.code === PATERNITY && row.measure === 'entitled')
					.map((row) => [row.operation, row.period, decimalNumber(row.amount)])
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
				// paid: the new version's write amends from the old version's last day, which an unpaid run would hold
				yield* run(t, '2026-08');
				yield* pay(t, '2026-08');
				const august = Number((yield* slipOf(t, '2026-08')).tax_withheld);
				const first = yield* versionOf(t, FIRST);
				const wrong = yield* amend(t, first, '2026-09-01', {
					family: withChild(first, '2026-08-10')
				});
				yield* syncAll(t);
				const given = (yield* held(t, PATERNITY)).entitled;
				assert.ok(given > 0);
				yield* run(t, '2026-09');
				yield* pay(t, '2026-09');
				const september = Number((yield* slipOf(t, '2026-09')).tax_withheld);
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
				assert.equal(Number((yield* slipOf(t, '2026-09')).tax_withheld), september);
				assert.ok(Number((yield* slipOf(t, '2026-10')).tax_withheld) >= september);
			}).pipe(Effect.provide(workspace({ seed: father(), now: NOW })))
	);

	it.live(
		'its leave already taken and paid: the correcting version is refused until the days are deleted where they were keyed, then it seals and the days are keyed as the leave they were',
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
				assert.match((yield* refusal(seal(t, right))).message, /days taken stand on a fact/);
				// the way out: the entry a paid run priced is deleted, which gives the days back and leaves the month to
				// be worked out again; then the version seals
				yield* (yield* t.as(t.admin)).act({
					'leave_catalog_entry.delete': [
						{ target: yield* current(t, 'leave_catalog_entry', taken) }
					]
				});
				yield* t.run_due();
				assert.equal((yield* held(t, PATERNITY)).used, 0);
				assert.deepEqual(yield* amendments(t), [['2026-09', null]]);
				yield* seal(t, right);
				yield* t.run_due();
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

// 5. An entry is HR's to change or delete, and the balance follows each write; one a paid run sealed leaves an
// amendment row besides (paid_period.test.ts). A manual balance row is never changed.
describe('an entry keyed wrongly', () => {
	it.live(
		'before a run: a wrong amount is edited, a wrong date and a wrong person are deleted and keyed again, and the run pays what stands',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				yield* syncAll(t);
				const annual = yield* held(t, 'ANNUAL_LEAVE');
				// the wrong person: the entry is deleted and keyed on the right one
				const bonus = yield* adhoc(t, 'BONUS', 500, '2026-08-10', FIRST);
				yield* admin.act({
					'adhoc_catalog_entry.delete': [
						{ target: yield* current(t, 'adhoc_catalog_entry', bonus) }
					]
				});
				yield* adhoc(t, 'BONUS', 500, '2026-08-10', SECOND);
				// the wrong amount: the balance follows the edit
				const medical = yield* claim(t, 80, '2026-08-11');
				assert.equal((yield* held(t, 'MEDICAL_CLAIM', PERSON, 'claim')).used, 80);
				yield* admin.act({
					'claim_catalog_entry.update': [
						{ target: yield* current(t, 'claim_catalog_entry', medical), set: { quantity: '60' } }
					]
				});
				yield* t.run_due();
				assert.equal((yield* held(t, 'MEDICAL_CLAIM', PERSON, 'claim')).used, 60);
				// the wrong date: the day comes back with the entry, and the right one draws it again
				const day = yield* leave(t, 'ANNUAL_LEAVE', ['2026-08-10']);
				assert.equal((yield* held(t, 'ANNUAL_LEAVE')).used, annual.used + 1);
				yield* admin.act({
					'leave_catalog_entry.delete': [{ target: yield* current(t, 'leave_catalog_entry', day) }]
				});
				yield* t.run_due();
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
				const hr = yield* t.as(t.member(['hr_controller']));
				const IN_LIEU = 'PUBLIC_HOLIDAY_IN_LIEU';
				const adjust = (
					balance: Id<'employee_balance'>,
					operation: 'ADD' | 'DEDUCT',
					days: number,
					note: string
				) =>
					hr.act({
						'ledger_entry.create': [
							{
								balance_id: balance,
								operation,
								account: 'leave',
								code: IN_LIEU,
								measure: 'entitled',
								amount: decimalText(days),
								unit: 'DAY',
								effective_on: '2026-11-02',
								note
							}
						]
					});
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
						.map((row) => [String(row.balance_id), row.operation, decimalNumber(row.amount)])
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
