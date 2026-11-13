// Where the ledger meets a limit or a gate: a claim pays what its limit leaves, a deleted entry gives back what it drew, and
// nothing a run waits on can hold it forever.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { expired, totalsScope, viewOf } from '../../src/lib/ledger/core.ts';
import { entitlementPlans } from '../../src/lib/ledger/service.ts';
import { jsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	lawAt,
	lawWith,
	measureOf,
	pack,
	recordEvents,
	sealedLeave,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	leaveCreate,
	storedQuery,
	current,
	keyOf,
	decimalNumber
} from '../kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const EMPLOYMENT = idOf('employment', uuid(6));
const terms = (amount = 8000) => ({
	rate: { amount, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
});
/** The claim row's yearly limit is the fixture's own, whatever the law pack holds. */
const LIMIT = 1000;
const seed = lawWith(pack('MY', 'Asia/Kuala_Lumpur', terms(), {}, [], []), {
	claim_catalog: {
		MEDICAL_CLAIM: {
			lookup: {
				...objectValue(
					lawAt('MY', '2026-11-15').rows.claim_catalog.find((row) => row.code === 'MEDICAL_CLAIM')
						?.lookup
				),
				annual_limit: LIMIT
			}
		}
	}
});
const entry = (quantity: number) => ({
	entity_id: ENTITY,
	employment_id: EMPLOYMENT,
	catalog_code: 'MEDICAL_CLAIM',
	quantity: String(quantity),
	incurred_on: '2026-11-03'
});
const claim = (t: Kit, ...amounts: readonly number[]) =>
	t
		.as(t.admin)
		.pipe(
			Effect.flatMap((caller) => caller.act({ 'claim_catalog_entry.create': amounts.map(entry) }))
		);
const used = (t: Kit) =>
	accountsIn(t).pipe(
		Effect.map((accounts) => measureOf(accounts, 'claim', 'MEDICAL_CLAIM', 'used'))
	);
const run = (t: Kit, period = '2026-11') =>
	t
		.as(t.admin)
		.pipe(
			Effect.flatMap((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
			)
		);
const paid = (t: Kit) =>
	storedQuery(t, { payslip: { limit: 10 } }).pipe(
		Effect.map(({ payslip }) =>
			payslip.rows
				.flatMap((row) => Schema.decodeUnknownSync(PayslipBreakdown)(row.breakdown).lines)
				.filter((line) => line.code === 'MEDICAL_CLAIM')
				.reduce((total, line) => total + Number(line.amount), 0)
		)
	);

describe('a claim on a limited row', () => {
	it.live('pays what remains of the limit, in a window no sync has opened', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* claim(t, 500);
			yield* t.run_due();
			assert.equal(yield* used(t), 500);
			yield* claim(t, 300);
			yield* t.run_due();
			assert.equal(yield* used(t), 800);
			yield* run(t);
			assert.equal(yield* paid(t), 800);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('pays nothing once the limit is gone', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* claim(t, LIMIT);
			yield* t.run_due();
			yield* claim(t, 50);
			yield* t.run_due();
			yield* run(t);
			assert.equal(yield* paid(t), LIMIT);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('shares the limit with a claim made in the same write', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* claim(t, 500, 300);
			yield* t.run_due();
			assert.equal(yield* used(t), 800);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('still on its way, pays what posting it will', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* claim(t, 500);
			yield* t.run_due();
			yield* claim(t, 300);
			yield* run(t);
			assert.equal(yield* paid(t), 800);
			yield* t.run_due();
			assert.equal(yield* used(t), 800);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live(
		'paid by a run and then deleted, gives back only what it drew and amends its period',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* claim(t, 500);
				yield* t.run_due();
				yield* claim(t, 300);
				yield* t.run_due();
				yield* run(t);
				yield* t.run_due();
				const [paying] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
				assert.ok(paying !== undefined);
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.update': [{ target: paying, set: { state: 'PAID' } }]
				});
				yield* t.run_due();
				const rows = (yield* storedQuery(t, { claim_catalog_entry: { limit: 5 } }))
					.claim_catalog_entry.rows;
				const second = rows.find((row) => Number(row.quantity) === 300);
				assert.ok(second !== undefined);
				assert.ok(second.payroll_run_id != null);
				yield* (yield* t.as(t.admin)).act({ 'claim_catalog_entry.delete': [{ target: second }] });
				yield* t.run_due();
				assert.equal(yield* used(t), 500);
				const { pay_amendment } = yield* storedQuery(t, { pay_amendment: { limit: 10 } });
				assert.deepEqual(
					pay_amendment.rows.map((row) => [row.period, row.payroll_run_id]),
					[['2026-11', null]]
				);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a run', () => {
	it.live('deleted takes its totals back in the delete, so the next run enters at once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t);
			const [first] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
			assert.ok(first !== undefined);
			yield* (yield* t.as(t.admin)).act({ 'payroll_run.delete': [{ target: first }] });
			const { ledger_entry } = yield* storedQuery(t, {
				ledger_entry: { where: { source: { eq: `payroll_run:${first.id}` } }, limit: 1000 }
			});
			const net = ledger_entry.rows.reduce(
				(total, row) =>
					total + (row.operation === 'DEDUCT' ? -1 : 1) * (decimalNumber(row.amount) ?? 0),
				0
			);
			assert.ok(ledger_entry.rows.length > 0);
			assert.ok(Math.abs(net) < 1e-6);
			yield* run(t);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('with a slip that moved no money is not held up by it', () => {
		const zero = pack('MY', 'Asia/Kuala_Lumpur', terms(0), {}, [], []);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t);
			yield* t.run_due();
			const [only] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
			assert.ok(only !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.update': [{ target: only, set: { state: 'PAID' } }]
			});
		}).pipe(Effect.provide(workspace({ seed: zero, now: NOW })));
	});
});

describe('what cannot be done to the ledger, an admin included', () => {
	it.live('a leave entry with no slots is refused', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(
				t.as(t.admin).pipe(
					Effect.flatMap((caller) =>
						caller.act({
							'leave_catalog_entry.create': [
								{ entity_id: ENTITY, employment_id: EMPLOYMENT, catalog_code: 'MEDICAL_LEAVE' }
							]
						})
					)
				)
			);
			assert.equal(keyOf(refused), 'errors.leave_entry_needs_day');
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	const OCTOBER = '2026-10-05';
	const sick = (date: string, set: object = {}) => ({
		entity_id: ENTITY,
		employment_id: EMPLOYMENT,
		catalog_code: 'MEDICAL_LEAVE',
		days: wholeDays(date),
		...set
	});
	const hr = (t: Kit) => t.as(t.member(['hr_controller']));
	const take = (t: Kit, date: string) =>
		hr(t).pipe(
			Effect.flatMap((caller) =>
				caller.act({ 'leave_catalog_entry.create': [leaveCreate(sick(date))] })
			)
		);
	/** The period run and paid. */
	const pay = (t: Kit, period: string) =>
		Effect.gen(function* () {
			yield* run(t, period);
			yield* t.run_due();
			const { payroll_run } = yield* storedQuery(t, {
				payroll_run: { where: { period: { eq: period } }, limit: 1 }
			});
			const [made] = payroll_run.rows;
			assert.ok(made !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.update': [{ target: made, set: { state: 'PAID' } }]
			});
			yield* t.run_due();
		});
	/** An October sick day, priced by October's run, which is paid. */
	const taken = (t: Kit) =>
		take(t, OCTOBER).pipe(Effect.andThen(pay(t, '2026-10')), Effect.andThen(sealedLeave(t)));
	const sickUsed = (t: Kit) =>
		accountsIn(t).pipe(
			Effect.map((accounts) => measureOf(accounts, 'leave', 'MEDICAL_LEAVE', 'used'))
		);
	it.live('frees only the days a paid entry gives up', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* (yield* hr(t)).act({
				'leave_catalog_entry.create': [
					leaveCreate(sick(OCTOBER, { days: wholeDays(OCTOBER, '2026-10-06') }))
				]
			});
			const before = yield* sickUsed(t);
			yield* pay(t, '2026-10');
			const sealed = yield* sealedLeave(t);
			const { leave_catalog_entry_day } = yield* storedQuery(t, {
				leave_catalog_entry_day: {
					where: { leave_entry_id: { eq: sealed } },
					fields: ['id', 'revision', 'incurred_on'],
					limit: 100
				}
			});
			const firstDay = leave_catalog_entry_day.rows
				.filter((row) => String(row.incurred_on) === OCTOBER)
				.map(({ id, revision }) => ({ id, revision }));
			assert.equal(firstDay.length, 2);
			yield* (yield* t.as(t.admin)).act({
				'leave_catalog_entry.update': [
					{
						target: yield* current(t, 'leave_catalog_entry', sealed),
						set: { leave_catalog_entry_day: { delete: firstDay } }
					}
				]
			});
			yield* t.run_due();
			assert.equal(yield* sickUsed(t), before - 1);
			yield* (yield* hr(t)).act({ 'leave_catalog_entry.create': [leaveCreate(sick(OCTOBER))] });
			const still = yield* Effect.flip(
				hr(t).pipe(
					Effect.flatMap((caller) =>
						caller.act({ 'leave_catalog_entry.create': [leaveCreate(sick('2026-10-06'))] })
					)
				)
			);
			assert.match(String(still), /already covers 2026-10-06/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('writes neither a ledger row nor a balance by hand', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const [balance] = (yield* storedQuery(t, { employee_balance: { limit: 1 } })).employee_balance
				.rows;
			assert.ok(balance !== undefined);
			const row = yield* Effect.flip(
				t.as(t.admin).pipe(
					Effect.flatMap((caller) =>
						caller.act({
							'ledger_entry.create': [
								{
									balance_id: balance.id,
									operation: 'ADD',
									account: 'leave',
									code: 'ANNUAL_LEAVE',
									period: 'MY.Y.2026-01-01',
									measure: 'entitled',
									amount: '999',
									unit: 'DAY',
									effective_on: '2026-11-03',
									source: 'by hand'
								}
							]
						})
					)
				)
			);
			assert.equal(keyOf(row), 'errors.ledger_entry_posting_only');
			const cell = yield* Effect.flip(
				t
					.as(t.admin)
					.pipe(
						Effect.flatMap((caller) =>
							caller.act({ 'employee_balance.update': [{ target: balance, set: { account: {} } }] })
						)
					)
			);
			assert.equal(keyOf(cell), 'errors.employee_balance_ledger_only');
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('books a half day once, until its entry is deleted, a paid run having priced it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const before = yield* sickUsed(t);
			const id = yield* taken(t);
			assert.equal(yield* sickUsed(t), before + 1);
			const twice = yield* Effect.flip(take(t, OCTOBER));
			assert.match(String(twice), new RegExp(`already covers ${OCTOBER}`));
			yield* (yield* t.as(t.admin)).act({
				'leave_catalog_entry.delete': [{ target: yield* current(t, 'leave_catalog_entry', id) }]
			});
			yield* t.run_due();
			assert.equal(yield* sickUsed(t), before);
			yield* take(t, OCTOBER);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('the ledger automation', () => {
	it.live('opens the balance of someone HR hires, who holds no write to it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* recordEvents(t, [], t.member(['hr_controller']));
			yield* t.run_due();
			const { employee_balance } = yield* storedQuery(t, { employee_balance: { limit: 2 } });
			assert.equal(employee_balance.rows.length, 1);
		}).pipe(Effect.provide(workspace({ seed: { ...seed, employee_balance: [] }, now: NOW })))
	);

	it.live(
		'has not opened someone’s balance yet: their entry and their run are refused and told to try again; after the sync both pass',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const UNOPENED = /balance is not open yet. It opens when the ledger sync/;
				const refused = (effect: Effect.Effect<unknown, unknown>) =>
					Effect.flip(effect).pipe(Effect.map(String));
				assert.match(yield* refused(claim(t, 80)), UNOPENED);
				assert.match(yield* refused(run(t)), UNOPENED);
				const nothing = yield* storedQuery(t, {
					claim_catalog_entry: { limit: 1 },
					payroll_run: { limit: 1 },
					ledger_entry: { limit: 1 }
				});
				assert.deepEqual(
					[nothing.claim_catalog_entry.rows, nothing.payroll_run.rows, nothing.ledger_entry.rows],
					[[], [], []]
				);
				// the way out the refusal names
				yield* syncAll(t);
				yield* claim(t, 80);
				assert.equal(yield* used(t), 80);
				yield* run(t);
				assert.deepEqual((yield* t.run_due()).failed, []);
			}).pipe(Effect.provide(workspace({ seed: { ...seed, employee_balance: [] }, now: NOW })))
	);
});

describe('the pure ledger rules', () => {
	const subject = { scope: 'MY', started: '2026-01-05', events: [] };
	it('carries nothing into a first window: nothing came before it', () => {
		const lookup = {
			service_bands: [{ service_months: 6, days: 10 }],
			service_offset_months: 6,
			carry: { max_days: 10 }
		};
		const period = 'MY.S.2026-07-05';
		const [plan] = entitlementPlans(
			[{ account: 'leave', code: 'ANNUAL_LEAVE', lookup }],
			{ started: subject.started, partTime: false, gender: null, maritalStatus: null },
			subject,
			'balance',
			{ leave: { ANNUAL_LEAVE: { [period]: { entitled: 10 } } } },
			'2026-08-01'
		);
		assert.deepEqual(
			plan?.wanted.map((row) => [row.period, row.measure, row.amount]),
			[[period, 'entitled', 10]]
		);
	});
	it('a row can state its own statutory test', () => {
		const lookup = {
			opened_by: { CHILD_BIRTH: {} },
			extra: 15,
			entitlement:
				"return 98 + (get(ctx.subject.employment, 'employee_extension_data.difficult_birth', false) ? ctx.lookup.extra : 0);"
		};
		const person = (difficult: boolean) => ({
			started: subject.started,
			partTime: false,
			gender: null,
			maritalStatus: null,
			employment: { employee_extension_data: { difficult_birth: difficult } }
		});
		const days = (difficult: boolean) =>
			entitlementPlans(
				[{ account: 'leave', code: 'MATERNITY_LEAVE', lookup }],
				person(difficult),
				{ ...subject, events: [{ kind: 'CHILD_BIRTH', on: '2026-03-02' }] },
				'balance',
				{},
				'2026-03-10'
			)[0]?.wanted[0]?.amount;
		assert.equal(days(false), 98);
		assert.equal(days(true), 113);
	});
	it('where each employer withholds alone, a move starts the totals again', () => {
		// the fixture law, its totals scoped to the employer
		const employer = { code: 'MY', ledger: { ytd_scope: 'EMPLOYER' } };
		const held = { pay: { GROSS: { [`MY.first.Y.2026-01-01`]: { total: 100 } } } };
		const view = (entity: string, settings: object) =>
			viewOf(held, totalsScope(jsonObject(settings), entity), 1, '2026-06-30').ytd;
		assert.deepEqual(view('first', employer), { GROSS: 100 });
		assert.deepEqual(view('second', employer), {});
		assert.equal(totalsScope({ code: 'MY' }, 'first'), 'MY');
	});
	it('a block of service stays until it can never be drawn on', () => {
		const moves = expired(
			{ leave: { SICK: { 'MY.B.2023-03-01': { entitled: 180 }, 'MY.Y.2023-01-01': { used: 2 } } } },
			'2027-01-02',
			3
		);
		assert.deepEqual([...new Set(moves.map((row) => row.period))], ['MY.Y.2023-01-01']);
	});
});
