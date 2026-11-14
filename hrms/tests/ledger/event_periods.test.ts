// A birth, a marriage or a confinement is a dated fact on the stint. Recording it triggers sync, a leave row names
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
	lawAt,
	lawWith,
	ledgerRows,
	measureOf,
	pack,
	recordEvents,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	leaveCreate,
	storedQuery,
	decimalNumber,
	packTerms
} from '../kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const EMPLOYMENT = idOf('employment', uuid(6));
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
	const seed = pack('MY', 'Asia/Kuala_Lumpur', packTerms(3120), {}, [], []);
	const rows = lawAt('MY', '2026-06-15').rows.leave_catalog;
	return {
		...lawWith(seed, {
			leave_catalog: Object.fromEntries(
				Object.entries(VARIED).map(([code, varied]) => {
					const lookup = Object.entries(
						objectValue(rows.find((row) => row.code === code)?.lookup)
					).filter(([key]) => key !== 'entitlement');
					return [code, { lookup: { ...Object.fromEntries(lookup), ...varied } }];
				})
			)
		}),
		employee_profile: (seed.employee_profile ?? []).map((row) => ({ ...row, gender })),
		statutory_parameters: (seed.statutory_parameters ?? []).map((row) => ({
			...row,
			marital_status: 'MARRIED'
		}))
	};
};
const WOMAN = seedOf('FEMALE');
const MAN = seedOf('MALE');
const BIRTH = { kind: 'CHILD_BIRTH', on: '2026-03-02' };
const take = (t: Kit, code: string, dates: readonly string[], employment = EMPLOYMENT) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({
			'leave_catalog_entry.create': [
				leaveCreate({
					entity_id: ENTITY,
					employment_id: employment,
					catalog_code: code,
					days: wholeDays(...dates)
				})
			]
		})
	);
/** The stint's events are now these; answers the stint. */
const record = (t: Kit, ...events: readonly JsonObject[]) =>
	recordEvents(t, events).pipe(Effect.tap(t.run_due()));
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

describe('a birth on the stint', () => {
	it.live('recorded, it opens what the leave rows give her, on the ledger too', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* record(t, BIRTH);
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
			yield* record(t, BIRTH);
			const accounts = yield* accountsIn(t);
			assert.equal(measureOf(accounts, 'leave', 'MATERNITY_LEAVE', 'entitled'), 0);
			assert.ok(measureOf(accounts, 'leave', 'PATERNITY_LEAVE', 'entitled') > 0);
		}).pipe(Effect.provide(workspace({ seed: MAN, now: NOW })))
	);
	it.live(
		'nothing moves until it is recorded, then once: a later write to the stint adds nothing',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				yield* syncAll(t);
				assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {});
				yield* record(t, BIRTH);
				const [held] = (yield* storedQuery(t, { employment: { limit: 1 } })).employment.rows;
				assert.ok(held !== undefined);
				yield* admin.act({ 'employment.update': [{ target: held, set: { reason: 'Reviewed' } }] });
				yield* t.run_due();
				assert.deepEqual(yield* movesOf(t, 'MATERNITY_LEAVE'), [
					['ADD', 'MY.E.2026-03-02', 'entitled', GRANT]
				]);
			}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a second birth is its own period: what is left does not stack', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* record(t, BIRTH);
			yield* record(t, BIRTH, { kind: 'CHILD_BIRTH', on: '2026-11-02' });
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {
				'MY.E.2026-03-02': { entitled: GRANT },
				'MY.E.2026-11-02': { entitled: GRANT }
			});
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('leave before the date: a change on the stint moves it, and the window stays', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const expected = { kind: 'CHILD_BIRTH', on: '2026-03-02', opened_on: '2026-02-16' };
			const stint = yield* record(t, expected);
			yield* take(t, 'MATERNITY_LEAVE', ['2026-02-16'], stint);
			yield* t.run_due();
			yield* record(t, { ...expected, on: '2026-02-27' });
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
			const stint = yield* record(t, BIRTH);
			yield* take(t, 'MATERNITY_LEAVE', [BIRTH.on], stint);
			yield* t.run_due();
			const refused = yield* Effect.flip(record(t, { ...BIRTH, on: '2026-03-04' }));
			assert.match(String(refused), /Leave from/);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('refuses a day no fact opens, however far ahead', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(take(t, 'MATERNITY_LEAVE', ['2027-02-01']));
			assert.match(String(refused), /insufficient balance/);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('taken off the stint, sync takes back what it gave, once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* record(t, BIRTH);
			yield* record(t);
			yield* syncAll(t);
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'MATERNITY_LEAVE', 'entitled'), 0);
			assert.deepEqual(yield* movesOf(t, 'MATERNITY_LEAVE'), [
				['ADD', 'MY.E.2026-03-02', 'entitled', GRANT],
				['DEDUCT', 'MY.E.2026-03-02', 'entitled', GRANT]
			]);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('taking it off is refused while its days are in use', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const stint = yield* record(t, BIRTH);
			yield* take(t, 'MATERNITY_LEAVE', ['2026-03-03'], stint);
			yield* t.run_due();
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'MATERNITY_LEAVE', 'used'), 1);
			assert.equal(yield* Effect.isFailure(recordEvents(t, [])), true);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a complication on the same birth adds its days to that period', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* record(t, BIRTH);
			yield* record(t, BIRTH, { kind: 'BIRTH_COMPLICATION', on: BIRTH.on });
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
			yield* record(t, { kind: 'MARRIAGE', on: '2026-02-02' }, BIRTH);
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
			const stint = yield* record(
				t,
				{ kind: 'CONFINEMENT', on: '2026-05-28' },
				{ kind: 'CHILD_BIRTH', on: '2026-06-01' }
			);
			yield* take(t, 'MATERNITY_LEAVE', ['2026-05-28', '2026-05-29'], stint);
			yield* take(t, 'MATERNITY_LEAVE', ['2026-06-01'], stint);
			yield* t.run_due();
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {
				'MY.E.2026-05-28': { entitled: CONFINEMENT, used: 2 },
				'MY.E.2026-06-01': { entitled: GRANT, used: 1 }
			});
			assert.match(
				String(yield* Effect.flip(take(t, 'MATERNITY_LEAVE', ['2026-05-20', '2026-05-21'], stint))),
				/MATERNITY_LEAVE: insufficient balance/
			);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
});
