// A birth or a long illness is a workplace case. The HR controller confirms it and a registered effect opens its days
// on the ledger and the balance, or rejects it and nothing moves. Nothing refills them by the calendar.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace } from './kit.ts';

const NOW = '2026-12-20T02:00:00.000Z';
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
const seedOf = (gender: string): Seed => {
	const seed = pack('ID', 'Asia/Jakarta', terms, {}, [], [], '2026-06-15');
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
		})),
		employee_balance: (seed.employee_balance ?? []).map((row) => ({
			...row,
			account: { leave: { MEDICAL_LEAVE: 36_500 } }
		}))
	};
};
const WOMAN = seedOf('FEMALE');
const MAN = seedOf('MALE');
const inVersion = (seed: Seed, model: string, code: string) => {
	const version = seed.employee_contract?.[0]?.input_schema_version_id;
	const row = (seed[model] ?? []).find((r) => r.code === code && r.settings_id === version);
	assert.ok(row !== undefined, code);
	return String(row.id);
};
const open = (t: Kit, seed: Seed, code: string, on: string, inputs: object) =>
	t.as(t.admin).act('workplace_case_catalog_entry.create', [
		{
			entity_id: ENTITY,
			catalog_id: idOf('workplace_case_catalog', inVersion(seed, 'workplace_case_catalog', code)),
			kind: code,
			opened_on: PlainDate(on),
			inputs: { employment_id: CONTRACT, ...inputs }
		}
	]);
const leaveOf = (t: Kit) =>
	t
		.storedQuery({ employee_balance: { limit: 1 } })
		.pipe(
			Effect.map(
				({ employee_balance }) =>
					(employee_balance.rows[0]?.account as { leave: Record<string, number> }).leave
			)
		);
const ledger = (t: Kit) =>
	t
		.storedQuery({ ledger_entry: { where: { account: { eq: 'leave' } }, limit: 50 } })
		.pipe(
			Effect.map(({ ledger_entry }) =>
				ledger_entry.rows.map((row) => [row.code, row.amount?.toNumber()]).toSorted()
			)
		);

describe('a birth case', () => {
	it.live('confirmed, it opens what the leave rows give her, on the ledger too', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* open(t, WOMAN, 'CHILD_BIRTH', '2026-03-02', { decision: 'CONFIRMED' });
			yield* t.runDue();
			assert.equal((yield* leaveOf(t))['MATERNITY_LEAVE'], 90);
			assert.equal((yield* leaveOf(t))['PATERNITY_LEAVE'], undefined);
			assert.deepEqual(yield* ledger(t), [['MATERNITY_LEAVE', 90]]);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('for a father, the rows that are his', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* open(t, MAN, 'CHILD_BIRTH', '2026-03-02', { decision: 'CONFIRMED' });
			yield* t.runDue();
			const leave = yield* leaveOf(t);
			assert.equal(leave['MATERNITY_LEAVE'], undefined);
			assert.equal(leave['PATERNITY_LEAVE'], 2);
		}).pipe(Effect.provide(workspace({ seed: MAN, now: NOW })))
	);
	it.live('rejected, nothing moves', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* open(t, WOMAN, 'CHILD_BIRTH', '2026-03-02', { decision: 'REJECTED' });
			yield* t.runDue();
			assert.equal((yield* leaveOf(t))['MATERNITY_LEAVE'], undefined);
			assert.deepEqual(yield* ledger(t), []);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('waiting, nothing moves until HR confirms it, then once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* open(t, WOMAN, 'CHILD_BIRTH', '2026-03-02', {});
			yield* t.runDue();
			assert.equal((yield* leaveOf(t))['MATERNITY_LEAVE'], undefined);
			const row = (yield* t.storedQuery({ workplace_case_catalog_entry: { limit: 1 } }))
				.workplace_case_catalog_entry.rows[0];
			assert.ok(row !== undefined);
			const confirmed = { ...row.inputs, decision: 'CONFIRMED' };
			yield* t
				.as(t.admin)
				.act('workplace_case_catalog_entry.update', [
					{ target: row.id, set: { inputs: confirmed } }
				]);
			yield* t.runDue();
			yield* t
				.as(t.admin)
				.act('workplace_case_catalog_entry.update', [
					{ target: row.id, set: { inputs: { ...confirmed, reference: 'again' } } }
				]);
			yield* t.runDue();
			assert.equal((yield* leaveOf(t))['MATERNITY_LEAVE'], 90);
			assert.deepEqual(yield* ledger(t), [['MATERNITY_LEAVE', 90]]);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a second birth is a second case, and adds to what is left', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* open(t, WOMAN, 'CHILD_BIRTH', '2026-03-02', { decision: 'CONFIRMED' });
			yield* t.runDue();
			yield* open(t, WOMAN, 'CHILD_BIRTH', '2026-11-02', { decision: 'CONFIRMED' });
			yield* t.runDue();
			assert.equal((yield* leaveOf(t))['MATERNITY_LEAVE'], 180);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	const reverse = (t: Kit, reverses: string) =>
		open(t, WOMAN, 'CHILD_BIRTH', '2026-04-01', {
			decision: 'CONFIRMED',
			is_reversal: true,
			reverses
		});
	const firstCase = (t: Kit) =>
		t.storedQuery({ workplace_case_catalog_entry: { limit: 1 } }).pipe(
			Effect.map(({ workplace_case_catalog_entry }) => {
				const row = workplace_case_catalog_entry.rows[0];
				assert.ok(row !== undefined);
				return row.id;
			})
		);
	it.live('reversed, the same case takes back what it gave, once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* open(t, WOMAN, 'CHILD_BIRTH', '2026-03-02', { decision: 'CONFIRMED' });
			yield* t.runDue();
			const id = yield* firstCase(t);
			yield* reverse(t, id);
			yield* t.runDue();
			assert.equal((yield* leaveOf(t))['MATERNITY_LEAVE'], 0);
			const moved = (yield* t.storedQuery({
				ledger_entry: { where: { code: { eq: 'MATERNITY_LEAVE' } }, limit: 5 }
			})).ledger_entry.rows.map((row) => row.operation);
			assert.deepEqual(moved.toSorted(), ['ADD', 'DEDUCT']);
			const again = yield* Effect.flip(reverse(t, id));
			assert.match(String(again), /already been reversed/);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('days already taken are reversed first', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* open(t, WOMAN, 'CHILD_BIRTH', '2026-03-02', { decision: 'CONFIRMED' });
			yield* t.runDue();
			yield* t.as(t.admin).act('leave_catalog_entry.create', [
				{
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_id: idOf('leave_catalog', inVersion(WOMAN, 'leave_catalog', 'MATERNITY_LEAVE')),
					days: [
						{ date: PlainDate('2026-03-03'), part: 'AM' },
						{ date: PlainDate('2026-03-03'), part: 'PM' }
					]
				}
			]);
			yield* t.runDue();
			const refused = yield* Effect.flip(reverse(t, yield* firstCase(t)));
			assert.match(String(refused), /Reverse the leave already taken first/);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a case that gave nothing cannot be reversed', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(reverse(t, 'nothing'));
			assert.match(String(refused), /Only a confirmed case/);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a complication needs its certificate before it is confirmed', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(
				open(t, WOMAN, 'BIRTH_COMPLICATION', '2026-03-02', { decision: 'CONFIRMED' })
			);
			assert.match(String(refused), /certificate/);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live(
		'with its certificate, a complication opens 90 more and keeps the birth as the start',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* open(t, WOMAN, 'CHILD_BIRTH', '2026-03-02', { decision: 'CONFIRMED' });
				yield* t.runDue();
				const file = yield* t.as(t.admin).upload('workplace_case_catalog_entry.evidence_file', {
					name: 'letter.pdf',
					mime: 'application/pdf',
					bytes: new Uint8Array([1, 2, 3])
				});
				assert.equal(file.kind, 'committed');
				yield* t.as(t.admin).act('workplace_case_catalog_entry.create', [
					{
						entity_id: ENTITY,
						catalog_id: idOf(
							'workplace_case_catalog',
							inVersion(WOMAN, 'workplace_case_catalog', 'BIRTH_COMPLICATION')
						),
						kind: 'BIRTH_COMPLICATION',
						opened_on: PlainDate('2026-05-20'),
						inputs: { employment_id: CONTRACT, decision: 'CONFIRMED' },
						evidence_file: file.output
					}
				]);
				yield* t.runDue();
				assert.equal((yield* leaveOf(t))['MATERNITY_LEAVE'], 180);
				const windows = (yield* t.storedQuery({ employee_balance: { limit: 1 } })).employee_balance
					.rows[0]?.account as { leave_window: Record<string, number> };
				assert.equal(windows.leave_window['MATERNITY_LEAVE.from'], 20260302);
			}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a case names its employee', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(
				t.as(t.admin).act('workplace_case_catalog_entry.create', [
					{
						entity_id: ENTITY,
						catalog_id: idOf(
							'workplace_case_catalog',
							inVersion(WOMAN, 'workplace_case_catalog', 'CHILD_BIRTH')
						),
						kind: 'CHILD_BIRTH',
						opened_on: PlainDate('2026-03-02'),
						inputs: {}
					}
				])
			);
			assert.match(String(refused), /Choose the employee/);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
});

describe('pay that steps down, on one row', () => {
	const whole = (date: string) => [
		{ date: PlainDate(date), part: 'AM' as const },
		{ date: PlainDate(date), part: 'PM' as const }
	];
	const take = (t: Kit, seed: Seed, code: string, dates: readonly string[]) =>
		t.as(t.admin).act('leave_catalog_entry.create', [
			{
				entity_id: ENTITY,
				employment_id: CONTRACT,
				catalog_id: idOf('leave_catalog', inVersion(seed, 'leave_catalog', code)),
				days: dates.flatMap(whole)
			}
		]);
	const run = (t: Kit, period: string) =>
		t
			.as(t.admin)
			.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
			.pipe(Effect.andThen(t.runDue()));
	const taken = (t: Kit, code: string) =>
		t.storedQuery({ payslip: { limit: 12 } }).pipe(
			Effect.map(({ payslip }) =>
				payslip.rows
					.flatMap((slip) => Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown).lines)
					.filter((line) => line.code === code)
					.reduce((sum, line) => sum + line.amount, 0)
			)
		);
	const JUNE = ['2026-06-09', '2026-06-10'];

	it.live('a sick day with no case is at full pay', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, WOMAN, 'MEDICAL_LEAVE', JUNE);
			yield* run(t, '2026-06');
			assert.equal(yield* taken(t, 'MEDICAL_LEAVE'), 0);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	for (const [started, share] of [
		['2026-05-02', 0],
		['2026-02-02', 0.25],
		['2025-10-02', 0.5],
		['2025-05-02', 0.75]
	] as const)
		it.live(`an illness from ${started} takes ${share} of a June day`, () => {
			const evidence = {
				...WOMAN,
				workplace_case_catalog: (WOMAN.workplace_case_catalog ?? []).map((row) =>
					row.code === 'LONG_ILLNESS'
						? {
								...row,
								lookup: { grants: [{ code: 'MEDICAL_LEAVE', days: 0 }], ends_on_close: true }
							}
						: row
				)
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* open(t, evidence, 'LONG_ILLNESS', started, { decision: 'CONFIRMED' });
				yield* t.runDue();
				yield* take(t, evidence, 'MEDICAL_LEAVE', JUNE);
				yield* t.runDue();
				yield* run(t, '2026-06');
				assert.equal(yield* taken(t, 'MEDICAL_LEAVE'), 2 * 500_000 * share);
			}).pipe(Effect.provide(workspace({ seed: evidence, now: NOW })));
		});
	it.live('closing the case ends the count: the next sick day is at full pay', () => {
		const evidence = {
			...WOMAN,
			workplace_case_catalog: (WOMAN.workplace_case_catalog ?? []).map((row) =>
				row.code === 'LONG_ILLNESS'
					? {
							...row,
							lookup: { grants: [{ code: 'MEDICAL_LEAVE', days: 0 }], ends_on_close: true }
						}
					: row
			)
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* open(t, evidence, 'LONG_ILLNESS', '2026-02-02', { decision: 'CONFIRMED' });
			yield* t.runDue();
			const row = (yield* t.storedQuery({ workplace_case_catalog_entry: { limit: 1 } }))
				.workplace_case_catalog_entry.rows[0];
			assert.ok(row !== undefined);
			yield* t
				.as(t.admin)
				.act('workplace_case_catalog_entry.update', [
					{ target: row.id, set: { closed_on: PlainDate('2026-05-29') } }
				]);
			yield* t.runDue();
			yield* take(t, evidence, 'MEDICAL_LEAVE', JUNE);
			yield* t.runDue();
			yield* run(t, '2026-06');
			assert.equal(yield* taken(t, 'MEDICAL_LEAVE'), 0);
		}).pipe(Effect.provide(workspace({ seed: evidence, now: NOW })));
	});
	it.live('a reversal gives back the month it corrects, at that month’s share', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* open(t, WOMAN, 'CHILD_BIRTH', '2026-02-02', { decision: 'CONFIRMED' });
			yield* t.runDue();
			yield* take(t, WOMAN, 'MATERNITY_LEAVE', ['2026-06-09']);
			yield* t.runDue();
			yield* run(t, '2026-06');
			const before = yield* taken(t, 'MATERNITY_LEAVE');
			assert.equal(before, 125_000);
			yield* t.as(t.admin).act('leave_catalog_entry.create', [
				{
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_id: idOf('leave_catalog', inVersion(WOMAN, 'leave_catalog', 'MATERNITY_LEAVE')),
					days: whole('2026-07-06'),
					is_reversal: true
				}
			]);
			yield* t.runDue();
			yield* run(t, '2026-07');
			assert.equal(yield* taken(t, 'MATERNITY_LEAVE'), 2 * before);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
	it.live('a long sick spell with no case asks HR to open one, once', () =>
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
	it.live('maternity: the fourth month is full, the fifth takes a quarter of each day', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* open(t, WOMAN, 'CHILD_BIRTH', '2026-02-02', { decision: 'CONFIRMED' });
			yield* t.runDue();
			yield* take(t, WOMAN, 'MATERNITY_LEAVE', ['2026-05-27', '2026-06-09', '2026-06-10']);
			yield* t.runDue();
			yield* run(t, '2026-06');
			assert.equal(yield* taken(t, 'MATERNITY_LEAVE'), 2 * 500_000 * 0.25);
		}).pipe(Effect.provide(workspace({ seed: WOMAN, now: NOW })))
	);
});
