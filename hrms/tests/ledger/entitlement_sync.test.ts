// The service reaches everyone: on a schedule, by hand, and from the events that change what someone is owed.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { JobResult, TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { leftOn, type Accounts } from '../../src/lib/ledger/core.ts';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	PAY_GROUP,
	accountsIn,
	lawAt,
	lawWith,
	ledgerRows as allLedgerRows,
	measureOf,
	pack,
	syncAll as compute,
	uuid,
	wholeDays,
	workspace,
	leaveCreate,
	storedQuery,
	decimalNumber,
	packTerms,
	agreedTerms
} from '../kit.ts';

const NOW = '2026-11-06T02:00:00.000Z';
const EMPLOYMENT = idOf('employment', uuid(6));
const terms = packTerms(3120, 'MANUAL_LABOUR');
type Seed = ReturnType<typeof pack>;
/** The pack's stint, hired on `from`: its first rows are dated with it. */
const hiredOn = (seed: Seed, from: string): Seed => ({
	...seed,
	employment: (seed.employment ?? []).map((row) => ({
		...row,
		service_started_on: from,
		effective_range: { from, to: null }
	})),
	contract_terms: (seed.contract_terms ?? []).map((row) => ({ ...row, effective_from: from })),
	statutory_parameters: (seed.statutory_parameters ?? []).map((row) => ({
		...row,
		effective_from: from
	}))
});
const seedOf = (from: string, account: Accounts = {}): Seed => {
	const seed = hiredOn(pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], []), from);
	return {
		...seed,
		employee_balance: (seed.employee_balance ?? []).map((row) => ({ ...row, account }))
	};
};
/** The fixture row's own lookup: what the law in force on the day grants is read from it, never typed here. */
const lookupOf = (code: string, on = '2026-11-06') =>
	objectValue(lawAt('MY', on).rows.leave_catalog.find((row) => row.code === code)?.lookup);
/** The days the row's service bands give someone with this many completed months. */
const band = (code: string, months: number, on?: string) => {
	const days = Schema.decodeUnknownSync(
		Schema.Array(Schema.Struct({ service_months: Schema.Number, days: Schema.Number }))
	)(lookupOf(code, on).service_bands).findLast((item) => item.service_months <= months)?.days;
	assert.ok(days !== undefined);
	return days;
};
/** Completed months of the fixture's service on 1 January 2026, the day its windows opened: joined 2023-01-01. */
const SERVED = 36;
const entitled = (t: Kit, code: string, employee?: string) =>
	accountsIn(t, employee).pipe(
		Effect.map((accounts) => measureOf(accounts, 'leave', code, 'entitled'))
	);
const ledgerRows = (t: Kit) =>
	allLedgerRows(t).pipe(Effect.map((rows) => rows.filter((row) => row.account === 'leave')));
const take = (t: Kit, code: string, date: string, as = t.admin) =>
	t.as(as).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: EMPLOYMENT,
						catalog_code: code,
						days: wholeDays(date)
					})
				]
			})
		)
	);

describe('run by hand', () => {
	it.live(
		'computes everyone from the catalog, and opens no account for a row with no limit',
		() => {
			const seed = seedOf('2023-01-01');
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* compute(t);
				assert.equal(yield* entitled(t, 'MEDICAL_LEAVE'), band('MEDICAL_LEAVE', SERVED));
				assert.equal(
					yield* entitled(t, 'HOSPITALIZATION_LEAVE'),
					lookupOf('HOSPITALIZATION_LEAVE').grant_days
				);
				assert.equal(yield* entitled(t, 'ANNUAL_LEAVE'), band('ANNUAL_LEAVE', SERVED));
				const { leave = {} } = yield* accountsIn(t);
				assert.equal(leave['UNPAID_LEAVE'], undefined);
				assert.equal(leave['MATERNITY_LEAVE'], undefined);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		}
	);

	it.live('a second run writes nothing', () => {
		const seed = seedOf('2023-01-01');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			const first = yield* ledgerRows(t);
			const held = yield* accountsIn(t);
			const [before] = (yield* storedQuery(t, { employee_balance: { limit: 1 } })).employee_balance
				.rows;
			yield* compute(t);
			yield* compute(t);
			assert.equal((yield* ledgerRows(t)).length, first.length);
			assert.deepEqual(yield* accountsIn(t), held);
			const [after] = (yield* storedQuery(t, { employee_balance: { limit: 1 } })).employee_balance
				.rows;
			assert.equal(after?.revision, before?.revision);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('days taken stay taken', () => {
		const seed = seedOf('2023-01-01');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			yield* take(t, 'MEDICAL_LEAVE', '2026-11-03');
			yield* t.run_due();
			yield* compute(t);
			const accounts = yield* accountsIn(t);
			const owed = band('MEDICAL_LEAVE', SERVED);
			assert.equal(measureOf(accounts, 'leave', 'MEDICAL_LEAVE', 'entitled'), owed);
			assert.equal(measureOf(accounts, 'leave', 'MEDICAL_LEAVE', 'used'), 1);
			assert.equal(
				leftOn(
					accounts,
					'leave',
					'MEDICAL_LEAVE',
					{ window: 'CALENDAR_YEAR' },
					{ scope: 'MY', started: '2023-01-01', events: [] },
					'2026-11-06'
				),
				owed - 1
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('a leaver is left alone', () => {
		const base = seedOf('2023-01-01');
		const seed: Seed = {
			...base,
			employment: (base.employment ?? []).map((row) => ({
				...row,
				effective_range: { from: '2023-01-01', to: '2026-06-30' }
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			assert.equal((yield* ledgerRows(t)).length, 0);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('a window held from before stands, and carries what it left', () => {
		// the fixture's own closed window: 12 granted, 5 taken
		const held = seedOf('2023-01-01', {
			leave: { ANNUAL_LEAVE: { 'MY.S.2025-01-01': { entitled: 12, used: 5 } } }
		});
		// a seeded balance comes with what its sync posted, so the window settles on what it holds
		const seed: Seed = {
			...held,
			ledger_entry: [
				{
					id: uuid(900),
					balance_id: uuid(5),
					operation: 'ADD',
					account: 'leave',
					code: 'ANNUAL_LEAVE',
					period: 'MY.S.2025-01-01',
					measure: 'entitled',
					amount: 12,
					unit: 'DAY',
					effective_on: '2025-01-01',
					source: `entitlement:${uuid(5)}:ANNUAL_LEAVE:MY.S.2025-01-01`
				}
			]
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			assert.deepEqual((yield* accountsIn(t)).leave?.['ANNUAL_LEAVE'], {
				'MY.S.2025-01-01': { entitled: 12, used: 5 },
				// what the window left, 12 − 5, carries: the fixture row carries its grant in full
				'MY.S.2026-01-01': { entitled: band('ANNUAL_LEAVE', SERVED), carried: 12 - 5 }
			});
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE'), band('MEDICAL_LEAVE', SERVED));
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});

describe('run for one person', () => {
	const OTHER = uuid(800);
	const two = (): Seed => {
		const seed = seedOf('2023-01-01');
		const profile = seed.employee_profile?.[0] ?? {};
		const stint = seed.employment?.[0] ?? {};
		const agreed = seed.contract_terms?.[0] ?? {};
		const told = seed.statutory_parameters?.[0] ?? {};
		const balance = seed.employee_balance?.[0] ?? {};
		return {
			...seed,
			employee_profile: [
				...(seed.employee_profile ?? []),
				{ ...profile, id: OTHER, name: 'Other', user_id: null, email: 'other@example.test' }
			],
			employment: [
				...(seed.employment ?? []),
				{ ...stint, id: uuid(801), employee_id: OTHER, employee_number: 'W2' }
			],
			contract_terms: [
				...(seed.contract_terms ?? []),
				{ ...agreed, id: uuid(803), employment_id: uuid(801) }
			],
			statutory_parameters: [
				...(seed.statutory_parameters ?? []),
				{ ...told, id: uuid(804), employment_id: uuid(801) }
			],
			employee_balance: [
				...(seed.employee_balance ?? []),
				{ ...balance, id: uuid(802), employee_id: OTHER }
			]
		};
	};
	it.live('moves that person and nobody else, and repeats safely', () => {
		const seed = two();
		const person = idOf('employee_profile', uuid(4));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			const start = admin
				.run('ledger', { employees: [person] }, JobResult)
				.pipe(Effect.andThen(t.run_due()));
			yield* start;
			const owed = band('MEDICAL_LEAVE', SERVED);
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE', uuid(4)), owed);
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE', OTHER), 0);
			const once = (yield* ledgerRows(t)).length;
			yield* start;
			assert.equal((yield* ledgerRows(t)).length, once);
			yield* compute(t);
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE', OTHER), owed);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});

describe('a write to the stint', () => {
	it.live('computes that person only', () => {
		const base = seedOf('2023-01-01');
		const seed: Seed = {
			...base,
			employment: (base.employment ?? []).map((row) => ({
				...row,
				effective_range: { from: '2023-01-01', to: '2026-12-31' }
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.equal((yield* ledgerRows(t)).length, 0);
			const [stint] = (yield* storedQuery(t, {
				employment: { where: { id: { eq: EMPLOYMENT } }, limit: 1 }
			})).employment.rows;
			assert.ok(stint !== undefined);
			const admin = yield* t.as(t.admin);
			yield* admin.act({
				'employment.update': [{ target: stint, set: { reason: 'Terms reviewed' } }]
			});
			yield* t.run_due();
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE'), band('MEDICAL_LEAVE', SERVED));
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});

describe('the events that call it', () => {
	it.live('a newcomer has their leave once they are hired', () => {
		const seed = seedOf('2023-01-01');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			yield* admin.act({
				'employee_profile.create': [
					{
						name: 'New',
						email: 'new@example.test',
						date_of_birth: '1990-01-01',
						gender: 'MALE',
						bank: {
							bank_name: 'Bank',
							bank_code: '001',
							bank_account_number: '2',
							bank_account_name: 'New'
						}
					}
				]
			});
			const person = (yield* storedQuery(t, {
				employee_profile: { where: { name: { eq: 'New' } }, limit: 1 }
			})).employee_profile.rows[0];
			assert.ok(person !== undefined);
			// a hire is one write: the stint with its first terms and what the law is told
			yield* admin.act({
				'employment.create': [
					{
						employee_id: person.id,
						entity_id: ENTITY,
						employee_number: 'W2',
						service_started_on: '2026-11-02',
						effective_range: { from: '2026-11-02', to: null },
						reason: 'Joined',
						terms: [
							{
								effective_from: '2026-11-02',
								engagement: 'EMPLOYEE',
								pay_group_id: idOf('pay_group', PAY_GROUP),
								...agreedTerms(3120, 'MANUAL_LABOUR')
							}
						],
						parameters: [
							{
								effective_from: '2026-11-02',
								residency_status: 'CITIZEN',
								marital_status: 'SINGLE',
								parameters: {}
							}
						]
					}
				]
			});
			yield* t.run_due();
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE', person.id), band('MEDICAL_LEAVE', 0));
			assert.equal(yield* entitled(t, 'UNPAID_LEAVE', person.id), 0);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('a paid run picks up a band reached since', () => {
		const seed = seedOf('2024-10-15');
		// 23 completed months on 1 October, 24 once the run for October is paid: the fixture row's next band
		const before = band('MEDICAL_LEAVE', 23);
		const after = band('MEDICAL_LEAVE', 24);
		assert.notEqual(before, after);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			t.clock.set('2026-10-01T02:00:00.000Z');
			yield* compute(t);
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE'), before);
			t.clock.set(NOW);
			yield* admin.act({
				'payroll_run.create': [{ entity_id: ENTITY, period: '2026-10', kind: 'ON_CYCLE' }]
			});
			yield* t.run_due();
			const run = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows[0];
			assert.ok(run !== undefined);
			yield* admin.act({ 'payroll_run.update': [{ target: run, set: { state: 'PAID' } }] });
			yield* t.run_due();
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE'), after);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-10-01T02:00:00.000Z' })));
	});

	it.live('1 January opens a new key, and the old window stays', () => {
		// the one 1 January inside the law the template holds is 2026's
		const seed = seedOf('2023-01-01');
		// two completed years on 1 January 2025, three on the next
		const [last, next] = [
			band('MEDICAL_LEAVE', 24, '2025-12-06'),
			band('MEDICAL_LEAVE', 36, '2025-12-06')
		];
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			yield* take(t, 'MEDICAL_LEAVE', '2025-12-03');
			yield* t.run_due();
			t.clock.set('2026-01-01T02:00:00.000Z');
			yield* compute(t);
			const held = (yield* accountsIn(t)).leave?.['MEDICAL_LEAVE'];
			assert.deepEqual(held, {
				'MY.Y.2025-01-01': { entitled: last, used: 1 },
				'MY.Y.2026-01-01': { entitled: next }
			});
			const movement = (yield* ledgerRows(t)).find(
				(row) => row.code === 'MEDICAL_LEAVE' && row.period === 'MY.Y.2026-01-01'
			);
			assert.equal(movement?.operation, 'ADD');
			assert.equal(movement?.measure, 'entitled');
			assert.equal(decimalNumber(movement?.amount), next);
		}).pipe(Effect.provide(workspace({ seed, now: '2025-12-06T02:00:00.000Z' })));
	});
});

describe('posting', () => {
	const seed = seedOf('2023-01-01');
	it.live('a real HR controller’s leave posts', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			yield* take(t, 'MEDICAL_LEAVE', '2026-11-03', t.member(['hr_controller']));
			yield* t.run_due();
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'MEDICAL_LEAVE', 'used'), 1);
			const [row] = (yield* ledgerRows(t)).filter((item) => item.measure === 'used');
			assert.equal(row?.operation, 'ADD');
			assert.match(String(row?.source), /^leave_catalog_entry:/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'rides in the writer’s own write, yet the writer holds no write to the ledger or the balance',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const member = t.member(['hr_controller']);
				const hr = yield* t.as(member);
				yield* compute(t);
				yield* take(t, 'MEDICAL_LEAVE', '2026-11-03', member);
				yield* t.run_due();
				const [entry] = (yield* storedQuery(t, { leave_catalog_entry: { limit: 1 } }))
					.leave_catalog_entry.rows;
				const [posted] = (yield* ledgerRows(t)).filter((row) => row.measure === 'used');
				const [balance] = (yield* storedQuery(t, { employee_balance: { limit: 1 } }))
					.employee_balance.rows;
				assert.ok(entry !== undefined && posted !== undefined && balance !== undefined);
				assert.equal(entry.created_by, member.id);
				assert.equal(posted.created_by, member.id);
				assert.equal(balance.updated_by, member.id);
				// no grant on the balance; and the ledger takes from HR only a manual adjustment's own shape
				assert.match(
					String(
						yield* Effect.flip(
							hr.act({ 'employee_balance.update': [{ target: balance, set: { account: {} } }] })
						)
					),
					/You may not update/
				);
				assert.match(
					String(
						yield* Effect.flip(
							hr.act({
								'ledger_entry.create': [
									{
										balance_id: balance.id,
										operation: 'ADD',
										account: 'leave',
										code: 'MEDICAL_LEAVE',
										period: posted.period,
										measure: 'used',
										amount: '1',
										unit: 'DAY',
										effective_on: '2026-11-03',
										source: 'by hand'
									}
								]
							})
						)
					),
					/Its period and source are worked out, never typed/
				);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('the person’s dependants', () => {
	const family = (members: readonly JsonObject[]): Seed => {
		const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, { family: members }, [], []);
		return {
			...seed,
			statutory_parameters: (seed.statutory_parameters ?? []).map((row) => ({
				...row,
				marital_status: 'MARRIED'
			}))
		};
	};
	it.live('a child born mid-year opens the leave of its birth', () => {
		const seed = family([
			{ relation: 'SPOUSE', has_income: true },
			{ relation: 'CHILD', born_on: '2026-07-15' }
		]);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			// one child of the one birth: the whole grant its row states
			const grant = Number(lookupOf('PATERNITY_LEAVE', '2026-11-15').grant_days);
			assert.ok(grant > 0);
			assert.equal(yield* entitled(t, 'PATERNITY_LEAVE'), grant);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-11-20T02:00:00.000Z' })));
	});
	it.live(
		'a row’s entitlement expression reads what each child carries, and an entry is held to it',
		() => {
			// PATERNITY_LEAVE is varied to grant the days HR allocated the child under its code
			const base = family([
				{ relation: 'CHILD', born_on: '2026-04-01', allocations: { PATERNITY_LEAVE: 3 } },
				{ relation: 'CHILD', born_on: '2026-08-03', allocations: { PATERNITY_LEAVE: 2 } }
			]);
			const seed = lawWith(base, {
				leave_catalog: {
					PATERNITY_LEAVE: {
						lookup: {
							...lookupOf('PATERNITY_LEAVE', '2026-11-15'),
							window: 'EVENT',
							opened_by: { CHILD_BIRTH: {} },
							entitlement:
								"const child = get(ctx.subject.employment, 'family', []).find((member) => member.relation === 'CHILD' && member.born_on === ctx.event.on);\nreturn Number(get(child, 'allocations.PATERNITY_LEAVE', 0));"
						}
					}
				}
			});
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* compute(t);
				const leave = (yield* accountsIn(t)).leave?.['PATERNITY_LEAVE'];
				assert.deepEqual(leave, {
					'MY.E.2026-04-01': { entitled: 3 },
					'MY.E.2026-08-03': { entitled: 2 }
				});
				yield* take(t, 'PATERNITY_LEAVE', '2026-08-03');
				yield* take(t, 'PATERNITY_LEAVE', '2026-08-04');
				yield* t.run_due();
				assert.match(
					String(yield* Effect.flip(take(t, 'PATERNITY_LEAVE', '2026-08-05'))),
					/insufficient balance/
				);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-11-20T02:00:00.000Z' })));
		}
	);
});
