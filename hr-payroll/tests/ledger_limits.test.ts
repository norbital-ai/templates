// Where the ledger meets a limit or a gate: a claim pays what its limit leaves, a reversal gives back what was drawn, and
// nothing a run waits on can hold it forever.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { expired } from '../src/lib/ledger/core.ts';
import { adhocWanted, entitlementPlans } from '../src/lib/ledger/service.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	measureOf,
	pack,
	sealEvents,
	uuid,
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
			const rows = (yield* t.storedQuery({ claim_catalog_entry: { limit: 5 } })).claim_catalog_entry
				.rows;
			const second = rows.find((row) => row.quantity.toNumber() === 300);
			assert.ok(second !== undefined);
			yield* t
				.as(t.admin)
				.act('claim_catalog_entry.create', [
					{ ...entry(300), is_reversal: true, reverses: second.id }
				]);
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
