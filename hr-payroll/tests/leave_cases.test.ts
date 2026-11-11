// A birth or a long illness is a dated fact on the sealed contract. Sealing triggers sync, a leave row names what opens
// it, and each date is its own period: nothing refills, nothing stacks, and a case moves no balance.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
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
	leaveCreate
} from './kit.ts';

// inside the law the template holds, which runs to 30 November 2026
const NOW = '2026-11-20T02:00:00.000Z';
const near = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 0.01, `${actual} is not ${expected}`);
const CONTRACT = idOf('employee_contract', uuid(6));
const terms = {
	rate: { amount: 11_000_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
type Seed = ReturnType<typeof pack>;
const seedOf = (gender: string, events: readonly JsonObject[] = []): Seed => {
	const seed = pack(
		'ID',
		'Asia/Jakarta',
		terms,
		{ work_region: 'Provinsi Aceh/Kabupaten Aceh Barat', events },
		[],
		[],
		'2026-06-15'
	);
	return {
		...seed,
		entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: { risk_class: 'I' }
		})),
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from: '2026-01-01', to: null },
			payroll: { date_of_birth: '1990-01-01', gender, marital_status: 'MARRIED' }
		}))
	};
};
const WOMAN = seedOf('FEMALE');
const MAN = seedOf('MALE');
const BIRTH = { kind: 'CHILD_BIRTH', on: '2026-03-02' };
const take = (t: Kit, seed: Seed, code: string, dates: readonly string[], employment = CONTRACT) =>
	t.as(t.admin).act('leave_catalog_entry.create', [
		leaveCreate({
			entity_id: ENTITY,
			employment_id: employment,
			catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
			days: wholeDays(...dates)
		})
	]);
const seal = (t: Kit, from: string, ...events: readonly JsonObject[]) =>
	sealEvents(t, from, events).pipe(Effect.tap(t.runDue()));
const periodsOf = (t: Kit, code: string) =>
	accountsIn(t).pipe(Effect.map((accounts) => accounts.leave?.[code] ?? {}));
const movesOf = (t: Kit, code: string) =>
	ledgerRows(t).pipe(
		Effect.map((rows) =>
			rows
				.filter((row) => row.code === code)
				.map((row) => [row.operation, row.period, row.measure, row.amount?.toNumber()])
				.toSorted()
		)
	);

describe('a birth on the contract', () => {
	it.live('sealed, it opens what the leave rows give her, on the ledger too', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t, BIRTH.on, BIRTH);
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {
				'ID.E.2026-03-02': { entitled: 90 }
			});
			assert.deepEqual(yield* periodsOf(t, 'PATERNITY_LEAVE'), {});
			assert.deepEqual(yield* movesOf(t, 'MATERNITY_LEAVE'), [
				['ADD', 'ID.E.2026-03-02', 'entitled', 90]
			]);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('for a father, the rows that are his', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t, BIRTH.on, BIRTH);
			const accounts = yield* accountsIn(t);
			assert.equal(measureOf(accounts, 'leave', 'MATERNITY_LEAVE', 'entitled'), 0);
			assert.equal(measureOf(accounts, 'leave', 'PATERNITY_LEAVE', 'entitled'), 2);
			assert.equal(measureOf(accounts, 'leave', 'PATERNITY_EXTENSION_LEAVE', 'entitled'), 3);
		}).pipe(Effect.provide(workspace({ seed: MAN, now: NOW })))
	);
	it.live('on a draft version, nothing moves until it seals, then once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			const [held] = (yield* t.storedQuery({ employee_contract: { limit: 1 } })).employee_contract
				.rows;
			assert.ok(held !== undefined);
			yield* admin.act('employee_contract.update', [
				{
					target: held.id,
					set: { effective_range: { from: PlainDate('2026-01-01'), to: PlainDate('2026-06-30') } }
				}
			]);
			yield* admin.act('employee_contract.create', [
				{
					employee_id: held.employee_id,
					entity_id: held.entity_id,
					engagement: held.engagement,
					employee_number: held.employee_number,
					terms: held.terms,
					payroll: held.payroll,
					bank: held.bank,
					employee_extension_data: held.employee_extension_data,
					events: [{ kind: BIRTH.kind, on: PlainDate(BIRTH.on) }],
					service_started_on: held.service_started_on,
					effective_range: { from: PlainDate('2026-07-01'), to: null },
					signed_contract_period: held.signed_contract_period,
					status: 'DRAFT',
					reason: 'A child was born'
				}
			]);
			yield* t.runDue();
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {});
			const draft = (yield* t.storedQuery({
				employee_contract: { where: { status: { eq: 'DRAFT' } }, limit: 1 }
			})).employee_contract.rows[0];
			assert.ok(draft !== undefined);
			yield* admin.act('employee_contract.update', [
				{ target: draft.id, set: { status: 'SEALED' } }
			]);
			yield* t.runDue();
			yield* admin.act('employee_contract.update', [
				{ target: draft.id, set: { reason: 'Reviewed' } }
			]);
			yield* t.runDue();
			assert.deepEqual(yield* movesOf(t, 'MATERNITY_LEAVE'), [
				['ADD', 'ID.E.2026-03-02', 'entitled', 90]
			]);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a second birth is its own period: what is left does not stack', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t, BIRTH.on, BIRTH);
			yield* seal(t, '2026-11-02', BIRTH, { kind: 'CHILD_BIRTH', on: '2026-11-02' });
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {
				'ID.E.2026-03-02': { entitled: 90 },
				'ID.E.2026-11-02': { entitled: 90 }
			});
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('leave before the date: a contract change moves it, and the window stays', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const expected = { kind: 'CHILD_BIRTH', on: '2026-03-02', opened_on: '2026-02-16' };
			const version = yield* seal(t, '2026-02-01', expected);
			yield* take(t, WOMAN, 'MATERNITY_LEAVE', ['2026-02-16'], version);
			yield* t.runDue();
			yield* seal(t, '2026-03-01', { ...expected, on: '2026-02-27' });
			yield* syncAll(t);
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {
				'ID.E.2026-02-16': { entitled: 90, used: 1 }
			});
			assert.deepEqual(yield* movesOf(t, 'MATERNITY_LEAVE'), [
				['ADD', 'ID.E.2026-02-16', 'entitled', 90],
				['ADD', 'ID.E.2026-02-16', 'used', 1]
			]);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('refuses to move a date from under days taken, until the window is kept', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const version = yield* seal(t, BIRTH.on, BIRTH);
			yield* take(t, WOMAN, 'MATERNITY_LEAVE', [BIRTH.on], version);
			yield* t.runDue();
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
				['ADD', 'ID.E.2026-03-02', 'entitled', 90],
				['DEDUCT', 'ID.E.2026-03-02', 'entitled', 90]
			]);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a version removing it is refused while its days are in use', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const version = yield* seal(t, BIRTH.on, BIRTH);
			yield* take(t, WOMAN, 'MATERNITY_LEAVE', ['2026-03-03'], version);
			yield* t.runDue();
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'MATERNITY_LEAVE', 'used'), 1);
			assert.equal(yield* Effect.isFailure(sealEvents(t, '2026-04-01', [])), true);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a complication on the same birth adds its 90 days to that period', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t, BIRTH.on, BIRTH);
			yield* seal(t, '2026-05-20', BIRTH, { kind: 'BIRTH_COMPLICATION', on: BIRTH.on });
			assert.deepEqual(yield* periodsOf(t, 'MATERNITY_LEAVE'), {
				'ID.E.2026-03-02': { entitled: 180 }
			});
			assert.deepEqual(yield* movesOf(t, 'MATERNITY_LEAVE'), [
				['ADD', 'ID.E.2026-03-02', 'entitled', 90],
				['ADD', 'ID.E.2026-03-02', 'entitled', 90]
			]);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('each fact opens only the rows that name it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* seal(t, BIRTH.on, { kind: 'MARRIAGE', on: '2026-02-02' }, BIRTH);
			const accounts = yield* accountsIn(t);
			assert.equal(measureOf(accounts, 'leave', 'MATERNITY_LEAVE', 'entitled'), 90);
			assert.equal(measureOf(accounts, 'leave', 'MARRIAGE_LEAVE', 'entitled'), 3);
			assert.equal(measureOf(accounts, 'leave', 'BEREAVEMENT_LEAVE', 'entitled'), 0);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
});

describe('a workplace case', () => {
	it.live('moves no balance', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t.as(t.admin).act('workplace_case_catalog_entry.create', [
				{
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_id: idOf(
						'workplace_case_catalog',
						catalogRow(WOMAN, 'workplace_case_catalog', 'PERSONAL_DATA_BREACH')
					),
					kind: 'PERSONAL_DATA_BREACH',
					opened_on: PlainDate('2026-03-02'),
					inputs: {}
				}
			]);
			yield* t.runDue();
			assert.deepEqual(yield* ledgerRows(t), []);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
});

describe('pay that steps down, on one row', () => {
	const run = (t: Kit, period: string) =>
		t
			.as(t.admin)
			.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
			.pipe(Effect.andThen(t.runDue()));
	const breakdowns = (t: Kit) =>
		t
			.storedQuery({ payslip: { limit: 12 } })
			.pipe(
				Effect.map(({ payslip }) =>
					payslip.rows.map((slip) => Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown))
				)
			);
	/** What the unpaid part of the days took off the salary: the leave row's own line, which PAID_BASIC falls by. */
	const taken = (t: Kit) =>
		breakdowns(t).pipe(
			Effect.map((slips) =>
				slips.reduce(
					(sum, slip) =>
						sum +
						11_000_000 -
						(slip.checkpoints.find((row) => row.code === 'PAID_BASIC')?.value ?? 0),
					0
				)
			)
		);
	/** What a reversal's refund line gave back. */
	const refunded = (t: Kit, code: string) =>
		breakdowns(t).pipe(
			Effect.map((slips) =>
				slips
					.flatMap((slip) => slip.lines)
					.filter((line) => line.code === code && line.direction === 'ADD')
					.reduce((sum, line) => sum + line.amount, 0)
			)
		);
	const JUNE = ['2026-06-09', '2026-06-10'];
	// Indonesia prices a missed day at monthly wage ÷ 173 × 8 hours, to the whole rupiah before it multiplies the days
	const DAY = Math.round((11_000_000 * 8) / 173);

	it.live('a sick day with no fact is at full pay', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, WOMAN, 'MEDICAL_LEAVE', JUNE);
			yield* t.runDue();
			yield* run(t, '2026-06');
			assert.equal(yield* taken(t), 0);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	for (const [started, share] of [
		['2026-05-02', 0],
		['2026-02-02', 0.25],
		['2025-10-02', 0.5],
		['2025-05-02', 0.75]
	] as const)
		it.live(`an illness from ${started} takes ${share} of a June day`, () => {
			const ill = seedOf('FEMALE', [{ kind: 'LONG_ILLNESS', on: started }]);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, ill, 'MEDICAL_LEAVE', JUNE);
				yield* t.runDue();
				yield* run(t, '2026-06');
				// each date's share of the day rate, to the whole rupiah, then the two dates
				near(yield* taken(t), 2 * Math.round(((11_000_000 * 8) / 173) * share));
			}).pipe(Effect.provide(workspace({ seed: ill, now: NOW })));
		});
	it.live('days taken in an illness do not stop the next version, which keeps it', () => {
		const event = { kind: 'LONG_ILLNESS', on: '2026-02-02' };
		const ill = seedOf('FEMALE', [event]);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, ill, 'MEDICAL_LEAVE', JUNE);
			yield* t.runDue();
			yield* sealEvents(t, '2026-07-01', [event]);
		}).pipe(Effect.provide(workspace({ seed: ill, now: NOW })));
	});
	it.live('an ended illness ends the count: the next sick day is at full pay', () => {
		const ill = seedOf('FEMALE', [
			{ kind: 'LONG_ILLNESS', on: '2026-02-02', ended_on: '2026-05-29' }
		]);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, ill, 'MEDICAL_LEAVE', JUNE);
			yield* t.runDue();
			yield* run(t, '2026-06');
			assert.equal(yield* taken(t), 0);
		}).pipe(Effect.provide(workspace({ seed: ill, now: NOW })));
	});
	it.live('a reversal gives back the month it corrects, at that month’s share', () => {
		const born = seedOf('FEMALE', [{ kind: 'CHILD_BIRTH', on: '2026-02-02' }]);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* take(t, born, 'MATERNITY_LEAVE', ['2026-06-09']);
			yield* t.runDue();
			yield* run(t, '2026-06');
			const before = yield* taken(t);
			near(before, Math.round(DAY * 0.25));
			const [first] = (yield* t.storedQuery({ leave_catalog_entry: { limit: 1 } }))
				.leave_catalog_entry.rows;
			assert.ok(first !== undefined);
			yield* t.as(t.admin).act('leave_catalog_entry.create', [
				leaveCreate({
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_id: idOf('leave_catalog', catalogRow(born, 'leave_catalog', 'MATERNITY_LEAVE')),
					days: wholeDays('2026-06-09'),
					reverses: first.id
				})
			]);
			yield* t.runDue();
			yield* run(t, '2026-07');
			near(yield* refunded(t, 'MATERNITY_LEAVE'), before);
		}).pipe(Effect.provide(workspace({ seed: born, now: NOW })));
	});
	it.live('a long sick spell with no fact asks HR to record one, once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const spell = Array.from(
				{ length: 31 },
				(_, day) => `2026-03-${String(day + 1).padStart(2, '0')}`
			);
			yield* take(t, WOMAN, 'MEDICAL_LEAVE', spell.slice(0, 29));
			yield* t.runDue();
			const raised = t
				.storedQuery({ obligation: { limit: 200 } })
				.pipe(
					Effect.map(({ obligation }) =>
						obligation.rows.filter(({ title }) => /Long illness case/.test(title))
					)
				);
			assert.equal((yield* raised).length, 0);
			yield* take(t, WOMAN, 'MEDICAL_LEAVE', [spell[29] ?? '']);
			yield* t.runDue();
			yield* take(t, WOMAN, 'MEDICAL_LEAVE', [spell[30] ?? '']);
			yield* t.runDue();
			assert.equal((yield* raised).length, 1);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
});
