// Where the ledger meets a limit or a gate: a claim pays what its limit leaves, a reversal gives back what was drawn, and
// nothing a run waits on can hold it forever.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { expired, totalsScope, viewOf } from '../src/lib/ledger/core.ts';
import { adhocWanted, entitlementPlans } from '../src/lib/ledger/service.ts';
import { jsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { decimal } from '../src/lib/payroll_engine/money.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	measureOf,
	pack,
	sealEvents,
	sealedLeave,
	syncAll,
	uuid,
	wholeDays,
	workspace
} from './kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
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
const seed = pack('MY', 'Asia/Kuala_Lumpur', terms(), {}, [], [], '2026-11-15');
const CLAIM = idOf('claim_catalog', catalogRow(seed, 'claim_catalog', 'MEDICAL_CLAIM'));
const entry = (quantity: number) => ({
	entity_id: ENTITY,
	employment_id: CONTRACT,
	catalog_id: CLAIM,
	quantity,
	incurred_on: PlainDate('2026-11-03')
});
const claim = (t: Kit, ...amounts: readonly number[]) =>
	t.as(t.admin).act('claim_catalog_entry.create', amounts.map(entry));
const used = (t: Kit) =>
	accountsIn(t).pipe(
		Effect.map((accounts) => measureOf(accounts, 'claim', 'MEDICAL_CLAIM', 'used'))
	);
const run = (t: Kit, period = '2026-11') =>
	t.as(t.admin).act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }]);
const paid = (t: Kit) =>
	t.storedQuery({ payslip: { limit: 10 } }).pipe(
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
			yield* t.runDue();
			assert.equal(yield* used(t), 500);
			yield* claim(t, 300);
			yield* t.runDue();
			assert.equal(yield* used(t), 576);
			yield* run(t);
			assert.equal(yield* paid(t), 576);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('pays nothing once the limit is gone', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* claim(t, 576);
			yield* t.runDue();
			yield* claim(t, 50);
			yield* t.runDue();
			yield* run(t);
			assert.equal(yield* paid(t), 576);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('shares the limit with a claim made in the same write', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* claim(t, 500, 300);
			yield* t.runDue();
			assert.equal(yield* used(t), 576);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('still on its way, pays what posting it will', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* claim(t, 500);
			yield* t.runDue();
			yield* claim(t, 300);
			yield* run(t);
			assert.equal(yield* paid(t), 576);
			yield* t.runDue();
			assert.equal(yield* used(t), 576);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('reversed, gives back only what it drew', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* claim(t, 500);
			yield* t.runDue();
			yield* claim(t, 300);
			yield* t.runDue();
			yield* run(t);
			yield* t.runDue();
			const rows = (yield* t.storedQuery({ claim_catalog_entry: { limit: 5 } })).claim_catalog_entry
				.rows;
			const second = rows.find((row) => row.quantity.toNumber() === 300);
			assert.ok(second !== undefined);
			const back = (quantity: number) => [
				{ ...entry(quantity), incurred_on: PlainDate('2026-12-03'), reverses: second.id }
			];
			const more = yield* Effect.flip(t.as(t.admin).act('claim_catalog_entry.create', back(301)));
			assert.match(String(more), /no more than it held/);
			yield* t.as(t.admin).act('claim_catalog_entry.create', back(300));
			yield* t.runDue();
			assert.equal(yield* used(t), 500);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a run', () => {
	it.live('waits for a deleted run to take its totals back', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t);
			yield* t.runDue();
			const [first] = (yield* t.storedQuery({ payroll_run: { limit: 1 } })).payroll_run.rows;
			assert.ok(first !== undefined);
			yield* t.as(t.admin).act('payroll_run.delete', [{ target: first.id }]);
			assert.match(String(yield* Effect.flip(run(t))), /still posting/);
			yield* t.runDue();
			yield* run(t);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('with a slip that moved no money is not held up by it', () => {
		const zero = pack('MY', 'Asia/Kuala_Lumpur', terms(0), {}, [], [], '2026-11-15');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t);
			yield* t.runDue();
			const [only] = (yield* t.storedQuery({ payroll_run: { limit: 1 } })).payroll_run.rows;
			assert.ok(only !== undefined);
			yield* t.as(t.admin).act('payroll_run.update', [{ target: only.id, set: { state: 'PAID' } }]);
		}).pipe(Effect.provide(workspace({ seed: zero, now: NOW })));
	});
});

describe('a contract that ends', () => {
	const encashed = (t: Kit) =>
		t
			.storedQuery({ leave_catalog_entry: { limit: 10 } })
			.pipe(Effect.map(({ leave_catalog_entry }) => leave_catalog_entry.rows));
	it.live('with a successor next day, keeps its leave', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* sealEvents(t, '2026-11-16', [], t.member(['hr_controller']));
			yield* t.runDue();
			assert.deepEqual(yield* encashed(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('with none, encashes what is left', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* t.as(t.member(['hr_controller'])).act('employee_contract.update', [
				{
					target: CONTRACT,
					set: {
						effective_range: { from: PlainDate('2026-01-01'), to: PlainDate('2026-11-13') },
						final_pay_due_on: PlainDate('2026-11-30')
					}
				}
			]);
			yield* t.runDue();
			const [entry] = yield* encashed(t);
			assert.equal(entry?.encashment, true);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('what cannot be done to the ledger, an admin included', () => {
	const MEDICAL = idOf('leave_catalog', catalogRow(seed, 'leave_catalog', 'MEDICAL_LEAVE'));
	const OCTOBER = '2026-10-05';
	const sick = (date: string, set: object = {}) => ({
		entity_id: ENTITY,
		employment_id: CONTRACT,
		catalog_id: MEDICAL,
		days: wholeDays(date),
		...set
	});
	const hr = (t: Kit) => t.as(t.member(['hr_controller']));
	const take = (t: Kit, date: string) => hr(t).act('leave_catalog_entry.create', [sick(date)]);
	const pay = (t: Kit, period: string) => run(t, period).pipe(Effect.andThen(t.runDue()));
	/** An October sick day, sealed by October's run. */
	const taken = (t: Kit) =>
		take(t, OCTOBER).pipe(Effect.andThen(pay(t, '2026-10')), Effect.andThen(sealedLeave(t)));
	const reverse = (t: Kit, reverses: Id<'leave_catalog_entry'>, set: object = {}) =>
		hr(t).act('leave_catalog_entry.create', [sick('2026-11-03', { reverses, ...set })]);
	it.live('frees only the days a partial reversal gives back', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* hr(t).act('leave_catalog_entry.create', [
				sick(OCTOBER, { days: wholeDays(OCTOBER, '2026-10-06') })
			]);
			yield* pay(t, '2026-10');
			yield* hr(t).act('leave_catalog_entry.create', [
				sick('2026-11-03', { reverses: yield* sealedLeave(t) })
			]);
			yield* t.runDue();
			yield* hr(t).act('leave_catalog_entry.create', [sick(OCTOBER)]);
			const still = yield* Effect.flip(
				hr(t).act('leave_catalog_entry.create', [sick('2026-10-06')])
			);
			assert.match(String(still), /already covers 2026-10-06/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('writes neither a ledger row nor a balance by hand', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const [balance] = (yield* t.storedQuery({ employee_balance: { limit: 1 } })).employee_balance
				.rows;
			assert.ok(balance !== undefined);
			const row = yield* Effect.flip(
				t.as(t.admin).act('ledger_entry.create', [
					{
						balance_id: balance.id,
						operation: 'ADD',
						account: 'leave',
						code: 'ANNUAL_LEAVE',
						period: 'MY.Y.2026-01-01',
						measure: 'entitled',
						amount: decimal(999),
						unit: 'DAY',
						effective_on: PlainDate('2026-11-03'),
						source: 'by hand'
					}
				])
			);
			assert.match(String(row), /Only posting and sync/);
			const cell = yield* Effect.flip(
				t.as(t.admin).act('employee_balance.update', [{ target: balance.id, set: { account: {} } }])
			);
			assert.match(String(cell), /Only posting and sync/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('reverses no entry a run has not sealed: that one is deleted', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* take(t, OCTOBER);
			const [open] = (yield* t.storedQuery({ leave_catalog_entry: { limit: 1 } }))
				.leave_catalog_entry.rows;
			assert.ok(open !== undefined);
			assert.match(String(yield* Effect.flip(reverse(t, open.id))), /deleted instead/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('reverses an entry once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const id = yield* taken(t);
			yield* reverse(t, id);
			assert.match(String(yield* Effect.flip(reverse(t, id))), /another record already has/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('reverses no reversal, even one a run has sealed', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* reverse(t, yield* taken(t));
			yield* pay(t, '2026-11');
			const { leave_catalog_entry } = yield* t.storedQuery({
				leave_catalog_entry: { where: { is_reversal: { eq: true } }, limit: 1 }
			});
			const [reversal] = leave_catalog_entry.rows;
			assert.ok(reversal?.payroll_run_id != null);
			const again = yield* Effect.flip(reverse(t, reversal.id));
			assert.match(String(again), /same person/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('reverses no more than the entry held', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const larger = yield* Effect.flip(
				reverse(t, yield* taken(t), { days: wholeDays('2026-11-03', '2026-11-04') })
			);
			assert.match(String(larger), /no more than it held/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('reverses no one else’s entry', () => {
		const contract = seed.employee_contract?.[0] ?? {};
		const two = {
			...seed,
			employee_profile: [
				...(seed.employee_profile ?? []),
				{ id: uuid(800), user_id: null, name: 'Other', email: 'other@example.test' }
			],
			employee_contract: [
				...(seed.employee_contract ?? []),
				{ ...contract, id: uuid(801), employee_id: uuid(800), employee_number: 'W2' }
			],
			employee_balance: [
				...(seed.employee_balance ?? []),
				{ id: uuid(802), employee_id: uuid(800), account: {} }
			]
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const refused = yield* Effect.flip(
				reverse(t, yield* taken(t), { employment_id: idOf('employee_contract', uuid(801)) })
			);
			assert.match(String(refused), /same person/);
		}).pipe(Effect.provide(workspace({ seed: two, now: NOW })));
	});
	it.live('reverses on the entry’s own catalog item', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const refused = yield* Effect.flip(
				reverse(t, yield* taken(t), {
					catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', 'ANNUAL_LEAVE'))
				})
			);
			assert.match(String(refused), /same person and catalog item/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('books a half day once, until a reversal frees it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const id = yield* taken(t);
			const twice = yield* Effect.flip(take(t, OCTOBER));
			assert.match(String(twice), new RegExp(`already covers ${OCTOBER}`));
			yield* reverse(t, id);
			yield* take(t, OCTOBER);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('the ledger automation', () => {
	it.live('opens the balance of someone HR hires, who holds no write to it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* sealEvents(t, '2026-11-01', [], t.member(['hr_controller']));
			yield* t.runDue();
			const { employee_balance } = yield* t.storedQuery({ employee_balance: { limit: 2 } });
			assert.equal(employee_balance.rows.length, 1);
		}).pipe(Effect.provide(workspace({ seed: { ...seed, employee_balance: [] }, now: NOW })))
	);
	it.live('raises a task for a failure no retry can fix', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t
				.as(t.admin)
				.start('ledger', { post: ['leave_catalog_entry:not-an-id'] })
				.pipe(Effect.andThen(t.runDue()));
			const { obligation } = yield* t.storedQuery({ obligation: { limit: 10 } });
			assert.ok(obligation.rows.some((row) => /Ledger posting failed/.test(row.title)));
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('the pure rules', () => {
	const subject = { scope: 'JP', started: '2026-01-05', events: [] };
	it('carries nothing into a first window: nothing came before it', () => {
		const lookup = {
			service_bands: [{ service_months: 6, days: 10 }],
			service_offset_months: 6,
			carry: { max_days: 10 }
		};
		const period = 'JP.S.2026-07-05';
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
				"return 98 + (get(ctx.subject.employment, 'employee_extension_data.facts.difficult_birth', false) ? ctx.lookup.extra : 0);"
		};
		const person = (difficult: boolean) => ({
			started: subject.started,
			partTime: false,
			gender: null,
			maritalStatus: null,
			employment: { employee_extension_data: { facts: { difficult_birth: difficult } } }
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
		const china = { code: 'CN', lookup: { totals_by_employer: true } };
		const held = { pay: { GROSS: { [`CN.first.Y.2026-01-01`]: { total: 100 } } } };
		const view = (entity: string, settings: object) =>
			viewOf(held, totalsScope(jsonObject(settings), entity), 1, '2026-06-30').ytd;
		assert.deepEqual(view('first', china), { GROSS: 100 });
		assert.deepEqual(view('second', china), {});
		assert.equal(totalsScope({ code: 'MY' }, 'first'), 'MY');
	});
	it('a statutory adjustment reversed counts in the year of what it reverses', () => {
		const wanted = adhocWanted(
			{ incurred_on: '2027-01-05', is_reversal: true, quantity: 10 },
			{
				code: 'EPF_ADJUSTMENT',
				lookup: {
					accounts: [
						{ account: 'statutory', code: 'EPF.employee', measure: 'paid', operation: 'ADD' }
					]
				}
			},
			{ scope: 'MY', started: '2020-01-01', events: [], taxYearStart: 1 },
			{ incurred_on: '2026-12-05' }
		);
		assert.deepEqual(
			wanted.map((row) => [row.period, row.amount]),
			[['MY.Y.2026-01-01', -10]]
		);
	});
	it('a block of service stays until it can never be drawn on', () => {
		const moves = expired(
			{ leave: { SICK: { 'CN.B.2023-03-01': { entitled: 180 }, 'CN.Y.2023-01-01': { used: 2 } } } },
			'2027-01-02',
			3
		);
		assert.deepEqual([...new Set(moves.map((row) => row.period))], ['CN.Y.2023-01-01']);
	});
});
