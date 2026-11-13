// HR adjusts a balance by hand on the employee profile : one immutable ledger row, `manual:<id>` with its
// note, on a leave row's entitled days or a claim row's limit, in the window holding its date. Sync never undoes it,
// the closing settlement keeps it and carry counts it. Only the HR controller writes one, and only of that shape.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { plain_date } from '../../src/lib/date.ts';
import { Effect } from 'effect';
import { leftIn } from '../../src/lib/ledger/core.ts';
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
	workspace,
	decimalNumber
} from '../kit.ts';
import { decimalText } from '../../src/lib/payroll_engine/money.ts';

const NOW = '2026-11-06T02:00:00.000Z';
const IN_LIEU = 'PUBLIC_HOLIDAY_IN_LIEU';
const YEAR = 'MY.Y.2026-01-01';
const BALANCE = idOf('employee_balance', uuid(5));
const TERMS = {
	rate: { amount: 3120, unit: 'MONTHLY' },
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const seed = pack('MY', 'Asia/Kuala_Lumpur', TERMS, {}, [], [], '2026-11-06');
type Member = ReturnType<Kit['member']>;
const hrOf = (t: Kit) => t.member(['hr_controller']);
/** A manual adjustment as the profile sends it: signed days, so a negative one takes away. */
const adjust = (
	t: Kit,
	by: Member,
	code: string,
	days: number,
	note = 'worked through the release',
	on = '2026-11-02'
) =>
	t.as(by).pipe(
		Effect.flatMap((caller) =>
			caller.act({
				'ledger_entry.create': [
					{
						balance_id: BALANCE,
						operation: days < 0 ? 'DEDUCT' : 'ADD',
						account: 'leave',
						code,
						measure: 'entitled',
						amount: decimalText(Math.abs(days)),
						unit: 'DAY',
						effective_on: plain_date(on),
						note
					}
				]
			})
		)
	);
const measure = (t: Kit, code: string, name: string) =>
	accountsIn(t).pipe(Effect.map((accounts) => measureOf(accounts, 'leave', code, name)));
/** The manual rows, additions first. */
const manualRows = (t: Kit) =>
	ledgerRows(t).pipe(
		Effect.map((rows) =>
			rows
				.filter((row) => String(row.source).startsWith('manual:'))
				.toSorted((left, right) => left.operation.localeCompare(right.operation))
		)
	);
const halfDay = (t: Kit, by: Member, part: 'AM' | 'PM') =>
	t.as(by).pipe(
		Effect.flatMap((caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: idOf('employee_contract', uuid(6)),
						catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', IN_LIEU)),
						days: [{ date: '2026-11-04', part }]
					})
				]
			})
		)
	);

describe('a manual balance adjustment', () => {
	it.live('grants half a day in lieu, limits it, and an opposite row takes it back', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = hrOf(t);
			yield* syncAll(t);
			assert.equal(yield* measure(t, IN_LIEU, 'entitled'), 0);
			assert.equal((yield* adjust(t, hr, IN_LIEU, 0.5)).kind, 'committed');
			const [row, ...more] = yield* manualRows(t);
			assert.ok(row !== undefined);
			assert.equal(more.length, 0);
			assert.equal(row.source, `manual:${row.id}`);
			assert.deepEqual(
				[row.operation, row.code, row.period, row.measure, decimalNumber(row.amount), row.note],
				['ADD', IN_LIEU, YEAR, 'entitled', 0.5, 'worked through the release']
			);
			assert.equal(row.created_by, hr.id);
			assert.equal(yield* measure(t, IN_LIEU, 'entitled'), 0.5);
			// sync diffs only its own sources: it posts nothing over a manual row
			const before = (yield* ledgerRows(t)).length;
			yield* syncAll(t);
			assert.equal((yield* ledgerRows(t)).length, before);
			assert.equal((yield* halfDay(t, hr, 'AM')).kind, 'committed');
			yield* t.run_due();
			assert.match(String(yield* Effect.flip(halfDay(t, hr, 'PM'))), /insufficient balance/);
			yield* adjust(t, hr, IN_LIEU, -0.5, 'granted in error');
			// the day taken stays taken: the window is overdrawn by it
			assert.equal(leftIn((yield* accountsIn(t)).leave?.[IN_LIEU]?.[YEAR]), -0.5);
			const rows = yield* manualRows(t);
			assert.deepEqual(
				rows.map((item) => [item.operation, decimalNumber(item.amount), item.note]),
				[
					['ADD', 0.5, 'worked through the release'],
					['DEDUCT', 0.5, 'granted in error']
				]
			);
			// immutable: the model has no update or delete, and the HR controller cannot erase one
			assert.equal(
				yield* Effect.isFailure(
					t
						.as(hr)
						.pipe(
							Effect.flatMap((caller) =>
								caller.act({ 'ledger_entry.erase': { target: row, set: { note: 'edited' } } })
							)
						)
				),
				true
			);
			assert.equal(
				yield* Effect.isFailure(
					t
						.as(hr)
						.pipe(Effect.flatMap((caller) => caller.act({ 'ledger_entry.erase': { target: row } })))
				),
				true
			);
			assert.deepEqual(yield* manualRows(t), rows);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'lands in the window holding its date, and the closing settlement and carry keep it',
		() => {
			// a service year that closes inside the law the template holds: the second runs to 31 May 2026
			const base = pack('MY', 'Asia/Kuala_Lumpur', TERMS, {}, [], [], '2026-05-06');
			const closing = {
				...base,
				employee_contract: (base.employee_contract ?? []).map((row) => ({
					...row,
					service_started_on: '2024-06-01',
					effective_range: { from: '2024-06-01', to: null }
				}))
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const window = 'MY.S.2025-06-01';
				const held = (yield* accountsIn(t)).leave?.['ANNUAL_LEAVE']?.[window]?.entitled ?? 0;
				assert.ok(held > 0);
				yield* adjust(t, hrOf(t), 'ANNUAL_LEAVE', 2, 'company long-service award', '2026-05-04');
				const [row] = yield* manualRows(t);
				assert.equal(row?.period, window);
				assert.equal((yield* accountsIn(t)).leave?.['ANNUAL_LEAVE']?.[window]?.entitled, held + 2);
				// the service year closes: the settlement posts its own figure and leaves the manual days standing
				t.clock.set('2026-06-01T02:00:00.000Z');
				yield* syncAll(t);
				const leave = (yield* accountsIn(t)).leave?.['ANNUAL_LEAVE'];
				assert.equal(leave?.[window]?.entitled, held + 2);
				// the grant and the company's days above it carry together: nothing was taken, and the fixture row's cap
				// holds them both
				assert.equal(leave?.['MY.S.2026-06-01']?.carried, held + 2);
				assert.ok((leave?.['MY.S.2026-06-01']?.entitled ?? 0) > 0);
				assert.deepEqual(
					(yield* manualRows(t)).map((item) => [item.operation, decimalNumber(item.amount)]),
					[['ADD', 2]]
				);
			}).pipe(Effect.provide(workspace({ seed: closing, now: '2026-05-06T02:00:00.000Z' })));
		}
	);

	it.live('moves a claim row’s limit', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const limit = () =>
				accountsIn(t).pipe(
					Effect.map((accounts) => measureOf(accounts, 'claim', 'MEDICAL_CLAIM', 'limit'))
				);
			const before = yield* limit();
			yield* (yield* t.as(hrOf(t))).act({
				'ledger_entry.create': [
					{
						balance_id: BALANCE,
						operation: 'ADD',
						account: 'claim',
						code: 'MEDICAL_CLAIM',
						measure: 'limit',
						amount: '150.5',
						unit: 'MONEY',
						effective_on: '2026-11-02',
						note: 'approved top-up'
					}
				]
			});
			assert.equal(yield* limit(), before + 150.5);
			yield* syncAll(t);
			assert.equal(yield* limit(), before + 150.5);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('is the HR controller’s alone, and only of its own shape', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const hr = hrOf(t);
			const refused = (effect: Effect.Effect<unknown, unknown>) =>
				Effect.flip(effect).pipe(Effect.map(String));
			// self-service and a role without the HR policy
			for (const by of [t.member(['employee'], { id: uuid(3) }), t.member(['hr_manager'])])
				assert.match(yield* refused(adjust(t, by, IN_LIEU, 1)), /may not create ledger_entry/);
			// a quarter day, no cause, a row the law in force does not hold, a date no contract covers
			const shape = /A manual adjustment adds to or takes from/;
			assert.match(yield* refused(adjust(t, hr, IN_LIEU, 0.25)), shape);
			assert.match(yield* refused(adjust(t, hr, IN_LIEU, 1, ' ')), shape);
			assert.match(yield* refused(adjust(t, hr, 'NOT_A_ROW', 1)), /not a leave row of the law/);
			assert.match(
				yield* refused(adjust(t, hr, IN_LIEU, 1, 'before hire', '2024-06-01')),
				/No sealed contract/
			);
			// a typed period, source or another measure is not a manual adjustment
			const typed = (set: { period?: string; source?: string; measure?: 'used' }) =>
				t.as(hr).pipe(
					Effect.flatMap((caller) =>
						caller.act({
							'ledger_entry.create': [
								{
									balance_id: BALANCE,
									operation: 'ADD',
									account: 'leave',
									code: IN_LIEU,
									measure: 'entitled',
									amount: '1',
									unit: 'DAY',
									effective_on: '2026-11-02',
									note: 'typed',
									...set
								}
							]
						})
					)
				);
			assert.match(yield* refused(typed({ period: YEAR })), shape);
			assert.match(yield* refused(typed({ source: 'manual:mine' })), shape);
			assert.match(yield* refused(typed({ measure: 'used' })), shape);
			assert.deepEqual(yield* manualRows(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});
