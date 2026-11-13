// A change dated ahead is a row not yet in force: nothing reads it before its date, and its day makes nothing. A
// person on a day is their dated rows folded: oldest first, a later row winning, `clears` taking a value away. A life
// event carries its own date and goes straight onto the stint, dated when it happened.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { companyOn } from '../../src/lib/company.ts';
import { employmentOn, partsIn } from '../../src/lib/person.ts';
import { isJsonObject, jsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { idOf, queryRows } from '../../src/lib/payroll_engine/reads.ts';
import { run, slip } from '../amendment_kit.ts';
import {
	EMPLOYMENT,
	ENTITY,
	accountsIn,
	lawAt,
	pack,
	recordEvents,
	refusal,
	storedQuery,
	storedReader,
	uuid,
	workspace
} from '../kit.ts';

const PROFILE = idOf('employee_profile', uuid(4));
const STINT = idOf('employment', EMPLOYMENT);
const RATE = 3000;
const RAISED = 3200;
const terms = {
	rate: { amount: RATE, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const base = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], []);
// a married woman employed since 2026: her stint and its first rows start that day
const seed: ReturnType<typeof pack> = {
	...base,
	employee_profile: (base.employee_profile ?? []).map((row) => ({ ...row, gender: 'FEMALE' })),
	employment: (base.employment ?? []).map((row) => ({
		...row,
		effective_range: { from: '2026-01-01', to: null }
	})),
	contract_terms: (base.contract_terms ?? []).map((row) => ({
		...row,
		effective_from: '2026-01-01'
	})),
	statutory_parameters: (base.statutory_parameters ?? []).map((row) => ({
		...row,
		effective_from: '2026-01-01',
		marital_status: 'MARRIED'
	}))
};
/** The days a birth opens: the fixture's own maternity row, keyed by the law's code and the event's date. */
const maternity = lawAt('MY', '2026-06-15').rows.leave_catalog.find(
	(row) => row.code === 'MATERNITY_LEAVE'
);
const GRANT = isJsonObject(maternity?.lookup) ? Number(maternity.lookup.grant_days) : NaN;
const opened = (on: string) => ({ [`MY.E.${on}`]: { entitled: GRANT } });
const birth = { kind: 'CHILD_BIRTH', on: '2026-03-02' };
const hr = (t: Kit) => t.as(t.member(['hr_controller']));
/** A raise keyed for the first of a month: one terms row holding the new rate. */
const raise = (t: Kit, from = '2026-02-01') =>
	Effect.flatMap(hr(t), (caller) =>
		caller.act({
			'contract_terms.create': [
				{ employment_id: STINT, effective_from: from, rate: { amount: RAISED, unit: 'MONTHLY' } }
			]
		})
	);
/** The stint's terms rows as stored, oldest first. */
const rows = (t: Kit) =>
	storedQuery(t, { contract_terms: { limit: 100 } }).pipe(
		Effect.map(({ contract_terms }) =>
			contract_terms.rows.toSorted((a, b) =>
				String(a.effective_from).localeCompare(String(b.effective_from))
			)
		)
	);
/** The pack's stint with its dated rows, its person and their dependants, as the source reads them. */
const stint = (t: Kit) =>
	queryRows(storedReader(t), {
		employment: { limit: 10 },
		contract_terms: { limit: 100 },
		statutory_parameters: { limit: 100 },
		employee_profile: { limit: 10 },
		dependant: { limit: 100 }
	}).pipe(
		Effect.map((found) => {
			const [parts] = partsIn(found);
			assert.ok(parts !== undefined);
			return parts;
		})
	);
/** One block of the stint on a day (`terms`, `payroll`), as formulas read it. */
const on = (t: Kit, day: string, block: 'terms' | 'payroll' = 'terms') =>
	stint(t).pipe(
		Effect.map((parts) => {
			const held = employmentOn(parts, day)[block];
			return isJsonObject(held) ? held : {};
		})
	);
const rateOn = (t: Kit, day: string) =>
	on(t, day).pipe(Effect.map((agreed) => (isJsonObject(agreed.rate) ? agreed.rate.amount : null)));
const periods = (t: Kit) =>
	accountsIn(t).pipe(Effect.map((accounts) => accounts.leave?.MATERNITY_LEAVE ?? {}));
const reach = (t: Kit, instant: string) =>
	Effect.sync(() => t.clock.set(instant)).pipe(Effect.andThen(t.run_due()));
const failures = (t: Kit) =>
	storedQuery(t, { obligation: { limit: 200 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows.map((row) => row.title).filter((title) => /failed/.test(title))
		)
	);

describe('a terms row dated ahead of its day', () => {
	const NOW = '2026-01-20T02:00:00.000Z';
	it.live('is not yet in force, and its day makes no other row', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* raise(t);
			yield* t.run_due();
			const filed = yield* rows(t);
			assert.equal(filed.length, 2);
			assert.equal(yield* rateOn(t, '2026-01-31'), RATE);
			assert.equal(yield* rateOn(t, '2026-02-01'), RAISED);
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			assert.deepEqual(yield* failures(t), []);
			assert.deepEqual(yield* rows(t), filed);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('a date that moves before its day is an edit, and leaves nothing behind', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* raise(t);
			const filed = (yield* rows(t)).at(-1);
			assert.ok(filed !== undefined);
			yield* (yield* hr(t)).act({
				'contract_terms.update': [{ target: filed, set: { effective_from: '2026-03-01' } }]
			});
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			assert.equal((yield* rows(t)).length, 2);
			assert.equal(yield* rateOn(t, '2026-02-28'), RATE);
			assert.equal(yield* rateOn(t, '2026-03-01'), RAISED);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('a deleted row never reaches the terms', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* raise(t);
			const filed = (yield* rows(t)).at(-1);
			assert.ok(filed !== undefined);
			yield* (yield* hr(t)).act({ 'contract_terms.delete': [{ target: filed }] });
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			assert.equal((yield* rows(t)).length, 1);
			assert.equal(yield* rateOn(t, '2026-02-01'), RATE);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('takes away only a field of its own family', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const caller = yield* hr(t);
			const agreed = yield* refusal(
				caller.act({
					'contract_terms.create': [
						{ employment_id: STINT, effective_from: '2026-02-01', clears: ['marital_status'] }
					]
				})
			);
			assert.equal(agreed.key, 'errors.contract_terms_clears');
			const told = yield* refusal(
				caller.act({
					'statutory_parameters.create': [
						{ employment_id: STINT, effective_from: '2026-02-01', clears: ['rate'] }
					]
				})
			);
			assert.equal(told.key, 'errors.statutory_parameters_clears');
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a person on a day', () => {
	it.live(
		'is their rows folded by date: a later row wins, `clears` takes a value away, a future row waits',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				// keyed newest first: the fold goes by a row's date, never by when it was written
				yield* raise(t, '2026-05-01');
				yield* admin.act({
					'contract_terms.create': [
						{
							employment_id: STINT,
							effective_from: '2026-03-01',
							job_title: 'Lead',
							clears: ['department']
						}
					]
				});
				yield* admin.act({
					'contract_terms.create': [
						{
							employment_id: STINT,
							effective_from: '2026-02-01',
							job_title: 'Clerk',
							department: 'Stores'
						}
					]
				});
				yield* admin.act({
					'statutory_parameters.create': [
						{
							employment_id: STINT,
							effective_from: '2026-03-01',
							nationality: 'MY',
							clears: ['passport_number']
						}
					]
				});
				yield* admin.act({
					'statutory_parameters.create': [
						{ employment_id: STINT, effective_from: '2026-02-01', passport_number: 'A1' }
					]
				});
				yield* t.run_due();

				const january = yield* on(t, '2026-01-31');
				assert.deepEqual([january.job_title, january.department], [undefined, undefined]);
				assert.equal((yield* on(t, '2026-01-31', 'payroll')).passport_number, undefined);

				const february = yield* on(t, '2026-02-28');
				assert.deepEqual([february.job_title, february.department], ['Clerk', 'Stores']);
				assert.equal((yield* on(t, '2026-02-28', 'payroll')).passport_number, 'A1');

				const march = yield* on(t, '2026-03-20');
				assert.equal(march.job_title, 'Lead');
				assert.equal('department' in march, false);
				assert.equal(yield* rateOn(t, '2026-03-20'), RATE);
				const told = yield* on(t, '2026-03-20', 'payroll');
				assert.equal('passport_number' in told, false);
				// what no later row set stands
				assert.deepEqual([told.nationality, told.marital_status], ['MY', 'MARRIED']);

				assert.equal(yield* rateOn(t, '2026-05-01'), RAISED);
				// and the run reads the same fold: March is paid on the rate in force in March
				yield* run(t, '2026-03');
				assert.equal(
					(yield* slip(t, '2026-03')).breakdown.checkpoints.find((point) => point.code === 'BASIC')
						?.value,
					RATE
				);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })))
	);
});

describe('a life event under a run', () => {
	const NOW = '2026-07-20T02:00:00.000Z';
	const june = (t: Kit) =>
		Effect.flatMap(t.as(t.admin), (caller) =>
			caller.act({
				'payroll_run.create': [{ entity_id: ENTITY, period: '2026-06', kind: 'ON_CYCLE' }]
			})
		);
	const events = (t: Kit) =>
		storedQuery(t, { employment: { limit: 10 } }).pipe(
			Effect.map(({ employment }) => employment.rows.flatMap((row) => row.events ?? []))
		);
	it.live('is not recorded for a day an unpaid run holds', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* june(t);
			const inside = yield* Effect.flip(recordEvents(t, [birth]));
			assert.match(String(inside), /Run 1 holds this person and is not paid yet/);
			assert.deepEqual(yield* events(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('is recorded for a day after an unpaid run', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* june(t);
			yield* recordEvents(t, [{ ...birth, on: '2026-07-16' }]);
			assert.equal((yield* events(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('is recorded under a paid run, and leaves its period to be worked out again', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* june(t);
			yield* t.run_due();
			const [ran] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
			assert.ok(ran !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.update': [{ target: ran, set: { state: 'PAID' } }]
			});
			yield* t.run_due();
			yield* recordEvents(t, [birth]);
			assert.equal((yield* events(t)).length, 1);
			const { pay_amendment } = yield* storedQuery(t, { pay_amendment: { limit: 10 } });
			assert.deepEqual(
				pay_amendment.rows.map((row) => [row.employee_id, row.period, row.payroll_run_id]),
				[[PROFILE, '2026-06', null]]
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a fact keyed late', () => {
	it.live('a birth months ago opens its real date, and the entitlement stands', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* recordEvents(t, [birth], t.member(['hr_controller']));
			yield* t.run_due();
			assert.deepEqual(yield* periods(t), opened('2026-03-02'));
		}).pipe(Effect.provide(workspace({ seed, now: '2026-11-20T02:00:00.000Z' })))
	);
});

const employer = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], []);
const companyChanges = (t: Kit) =>
	storedQuery(t, {
		entity_change: { where: { entity_id: { eq: ENTITY } }, limit: 10 }
	}).pipe(Effect.map(({ entity_change }) => entity_change.rows.map(jsonObject)));

describe('a company change dated ahead of its day', () => {
	it.live('is a row not yet in force: its day makes no other row', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* (yield* t.as(t.member(['hr_controller']))).act({
				'entity_change.create': [
					{ entity_id: ENTITY, effective_from: '2026-02-01', final_pay_loan_floor_percent: 25 }
				]
			});
			yield* t.run_due();
			const filed = yield* companyChanges(t);
			assert.equal(filed.length, 2);
			assert.equal(companyOn(filed, '2026-01-31').final_pay_loan_floor_percent, 10);
			assert.equal(companyOn(filed, '2026-02-01').final_pay_loan_floor_percent, 25);

			t.clock.set('2026-02-01T02:00:00.000Z');
			yield* t.run_due();
			assert.deepEqual(yield* companyChanges(t), filed);
		}).pipe(Effect.provide(workspace({ seed: employer, now: '2026-01-20T02:00:00.000Z' })))
	);

	it.live('refuses to take away a field that is not dated', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(
				t.as(t.member(['hr_controller'])).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'entity_change.create': [
								{ entity_id: ENTITY, effective_from: '2026-02-01', clears: ['settings_code'] }
							]
						})
					)
				)
			);
			assert.ok(refused._tag === 'ActRefused');
			assert.equal(refused.key, 'errors.entity_change_clears');
		}).pipe(Effect.provide(workspace({ seed: employer, now: '2026-01-20T02:00:00.000Z' })))
	);
});
