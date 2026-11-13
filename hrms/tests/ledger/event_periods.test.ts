// A birth, a marriage or a confinement is a dated fact on the sealed contract. Sealing triggers sync, a leave row names
// the facts that open it, and each date is its own period: nothing refills, nothing stacks. The fixture's event rows
// are varied to synthetic figures, so every number below comes from the rows the test writes.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	ledgerRows,
	measureOf,
	pack,
	sealEvents,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	leaveCreate,
	storedQuery,
	decimalNumber
} from '../kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const terms = {
	rate: { amount: 3120, unit: 'MONTHLY' },
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const GRANT = 60;
const COMPLICATION = 30;
const CONFINEMENT = 5;
const MARRIAGE = 3;
/** Each varied row: its own lookup, without the statutory `entitlement` expression, plus these keys. */
const VARIED: Readonly<Record<string, JsonObject>> = {
	MATERNITY_LEAVE: {
		window: 'EVENT',
		grant_days: GRANT,
		opened_by: {
			CHILD_BIRTH: {},
			BIRTH_COMPLICATION: { days: COMPLICATION },
			CONFINEMENT: { days: CONFINEMENT }
		}
	},
	// a row that names another fact than a birth
	MATERNITY_LEAVE_NO_ALLOWANCE: {
		window: 'EVENT',
		grant_days: GRANT,
		opened_by: { CHILD_BIRTH_NO_ALLOWANCE: {} }
	},
	COMPASSIONATE_LEAVE: { window: 'EVENT', grant_days: MARRIAGE, opened_by: { MARRIAGE: {} } }
};
type Seed = ReturnType<typeof pack>;
const seedOf = (gender: string): Seed => {
	const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], [], '2026-06-15');
	return {
		...seed,
		leave_catalog: (seed.leave_catalog ?? []).map((row) => {
			const varied = VARIED[String(row.code)];
			if (varied === undefined) return row;
			const lookup = Object.entries(objectValue(row.lookup)).filter(
				([key]) => key !== 'entitlement'
			);
			return { ...row, lookup: { ...Object.fromEntries(lookup), ...varied } };
		}),
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			payroll: { date_of_birth: '1990-01-01', gender, marital_status: 'MARRIED' }
		}))
	};
};
const WOMAN = seedOf('FEMALE');
const MAN = seedOf('MALE');
const BIRTH = { kind: 'CHILD_BIRTH', on: '2026-03-02' };
const take = (t: Kit, seed: Seed, code: string, dates: readonly string[], employment = CONTRACT) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({
			'leave_catalog_entry.create': [
				leaveCreate({
					entity_id: ENTITY,
					employment_id: employment,
					catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
					days: wholeDays(...dates)
				})
			]
		})
	);
const seal = (t: Kit, from: string, ...events: readonly JsonObject[]) =>
	sealEvents(t, from, events).pipe(Effect.tap(t.run_due()));
const periodsOf = (t: Kit, code: string) =>
	accountsIn(t).pipe(Effect.map((accounts) => accounts.leave?.[code] ?? {}));
const movesOf = (t: Kit, code: string) =>
	ledgerRows(t).pipe(
		Effect.map((rows) =>
			rows
				.filter((row) => row.code === code)
				.map((row) => [row.operation, row.period, row.measure, decimalNumber(row.amount)])
				.toSorted()
		)
	);

describe('a birth on the contract', () => {
	it.live('sealed, it opens what the leave rows give her, on the ledger too', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t, BIRTH.on, BIRTH);
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {
				'MY.E.2026-03-02': { entitled: GRANT }
			});
			assert.deepEqual(yield* periodsOf(t, 'PATERNITY_LEAVE'), {});
			assert.deepEqual(yield* movesOf(t, 'MATERNITY_LEAVE'), [
				['ADD', 'MY.E.2026-03-02', 'entitled', GRANT]
			]);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('for a father, the rows that are his', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t, BIRTH.on, BIRTH);
			const accounts = yield* accountsIn(t);
			assert.equal(measureOf(accounts, 'leave', 'MATERNITY_LEAVE', 'entitled'), 0);
			assert.ok(measureOf(accounts, 'leave', 'PATERNITY_LEAVE', 'entitled') > 0);
		}).pipe(Effect.provide(workspace({ seed: MAN, now: NOW })))
	);
	it.live('on a draft version, nothing moves until it seals, then once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			const [held] = (yield* storedQuery(t, { employee_contract: { limit: 1 } })).employee_contract
				.rows;
			assert.ok(held !== undefined);
			yield* admin.act({
				'employee_contract.update': [
					{
						target: held,
						set: {
							effective_range: { from: held.effective_range.from, to: '2026-06-30' }
						}
					}
				]
			});
			yield* admin.act({
				'employee_contract.create': [
					{
						employee_id: held.employee_id,
						entity_id: held.entity_id,
						engagement: held.engagement,
						employee_number: held.employee_number,
						terms: held.terms,
						payroll: held.payroll,
						bank: held.bank,
						employee_extension_data: held.employee_extension_data,
						events: [{ kind: BIRTH.kind, on: BIRTH.on }],
						service_started_on: held.service_started_on,
						effective_range: { from: '2026-07-01', to: null },
						signed_contract_period: held.signed_contract_period,
						status: 'DRAFT',
						reason: 'A child was born'
					}
				]
			});
			yield* t.run_due();
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {});
			const draft = (yield* storedQuery(t, {
				employee_contract: { where: { status: { eq: 'DRAFT' } }, limit: 1 }
			})).employee_contract.rows[0];
			assert.ok(draft !== undefined);
			yield* admin.act({
				'employee_contract.update': [{ target: draft, set: { status: 'SEALED' } }]
			});
			yield* t.run_due();
			const sealed = (yield* storedQuery(t, {
				employee_contract: { where: { id: { eq: draft.id } }, limit: 1 }
			})).employee_contract.rows[0];
			assert.ok(sealed !== undefined);
			yield* admin.act({
				'employee_contract.update': [{ target: sealed, set: { reason: 'Reviewed' } }]
			});
			yield* t.run_due();
			assert.deepEqual(yield* movesOf(t, 'MATERNITY_LEAVE'), [
				['ADD', 'MY.E.2026-03-02', 'entitled', GRANT]
			]);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a second birth is its own period: what is left does not stack', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t, BIRTH.on, BIRTH);
			yield* seal(t, '2026-11-02', BIRTH, { kind: 'CHILD_BIRTH', on: '2026-11-02' });
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {
				'MY.E.2026-03-02': { entitled: GRANT },
				'MY.E.2026-11-02': { entitled: GRANT }
			});
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('leave before the date: a contract change moves it, and the window stays', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const expected = { kind: 'CHILD_BIRTH', on: '2026-03-02', opened_on: '2026-02-16' };
			const version = yield* seal(t, '2026-02-01', expected);
			yield* take(t, WOMAN, 'MATERNITY_LEAVE', ['2026-02-16'], version);
			yield* t.run_due();
			yield* seal(t, '2026-03-01', { ...expected, on: '2026-02-27' });
			yield* syncAll(t);
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {
				'MY.E.2026-02-16': { entitled: GRANT, used: 1 }
			});
			assert.deepEqual(yield* movesOf(t, 'MATERNITY_LEAVE'), [
				['ADD', 'MY.E.2026-02-16', 'entitled', GRANT],
				['ADD', 'MY.E.2026-02-16', 'used', 1]
			]);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('refuses to move a date from under days taken, until the window is kept', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const version = yield* seal(t, BIRTH.on, BIRTH);
			yield* take(t, WOMAN, 'MATERNITY_LEAVE', [BIRTH.on], version);
			yield* t.run_due();
			const refused = yield* Effect.flip(seal(t, '2026-04-01', { ...BIRTH, on: '2026-03-04' }));
			assert.match(String(refused), /Leave from/);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('refuses a day no fact opens, however far ahead', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(take(t, WOMAN, 'MATERNITY_LEAVE', ['2027-02-01']));
			assert.match(String(refused), /insufficient balance/);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('removed by a new version, sync takes back what it gave, once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t, BIRTH.on, BIRTH);
			yield* seal(t, '2026-04-01');
			yield* syncAll(t);
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'MATERNITY_LEAVE', 'entitled'), 0);
			assert.deepEqual(yield* movesOf(t, 'MATERNITY_LEAVE'), [
				['ADD', 'MY.E.2026-03-02', 'entitled', GRANT],
				['DEDUCT', 'MY.E.2026-03-02', 'entitled', GRANT]
			]);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a version removing it is refused while its days are in use', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const version = yield* seal(t, BIRTH.on, BIRTH);
			yield* take(t, WOMAN, 'MATERNITY_LEAVE', ['2026-03-03'], version);
			yield* t.run_due();
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'MATERNITY_LEAVE', 'used'), 1);
			assert.equal(yield* Effect.isFailure(sealEvents(t, '2026-04-01', [])), true);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a complication on the same birth adds its days to that period', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t, BIRTH.on, BIRTH);
			yield* seal(t, '2026-05-20', BIRTH, { kind: 'BIRTH_COMPLICATION', on: BIRTH.on });
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {
				'MY.E.2026-03-02': { entitled: GRANT + COMPLICATION }
			});
			assert.deepEqual(
				yield* movesOf(t, 'MATERNITY_LEAVE'),
				[
					['ADD', 'MY.E.2026-03-02', 'entitled', GRANT],
					['ADD', 'MY.E.2026-03-02', 'entitled', COMPLICATION]
				].toSorted()
			);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('each fact opens only the rows that name it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t, BIRTH.on, { kind: 'MARRIAGE', on: '2026-02-02' }, BIRTH);
			const accounts = yield* accountsIn(t);
			assert.equal(measureOf(accounts, 'leave', 'MATERNITY_LEAVE', 'entitled'), GRANT);
			assert.equal(measureOf(accounts, 'leave', 'COMPASSIONATE_LEAVE', 'entitled'), MARRIAGE);
			assert.equal(measureOf(accounts, 'leave', 'MATERNITY_LEAVE_NO_ALLOWANCE', 'entitled'), 0);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
});

describe('two facts on one row', () => {
	it.live('a day draws on the latest fact opened by then, and a day before any is refused', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const version = yield* seal(
				t,
				'2026-05-28',
				{ kind: 'CONFINEMENT', on: '2026-05-28' },
				{ kind: 'CHILD_BIRTH', on: '2026-06-01' }
			);
			yield* take(t, WOMAN, 'MATERNITY_LEAVE', ['2026-05-28', '2026-05-29'], version);
			yield* take(t, WOMAN, 'MATERNITY_LEAVE', ['2026-06-01'], version);
			yield* t.run_due();
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {
				'MY.E.2026-05-28': { entitled: CONFINEMENT, used: 2 },
				'MY.E.2026-06-01': { entitled: GRANT, used: 1 }
			});
			assert.match(
				String(
					yield* Effect.flip(
						take(t, WOMAN, 'MATERNITY_LEAVE', ['2026-05-20', '2026-05-21'], version)
					)
				),
				/MATERNITY_LEAVE: insufficient balance/
			);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
});
