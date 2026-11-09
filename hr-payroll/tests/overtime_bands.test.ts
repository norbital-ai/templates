// A payroll run prices worked days in the right band: real sealed law, a synthetic employee, a roster and a month, end to
// end through `payroll_run.create`. Every expected figure is the statute's arithmetic, worked here by hand.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf, objectValue } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, OFF, REST, WORK, accountsIn, pack, read, uuid, workspace } from './kit.ts';

const lines = Effect.fnUntraced(function* (t: Kit) {
	yield* t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]);
	yield* t.runDue();
	const held = (yield* t.storedQuery({ employee_balance: { limit: 1 } })).employee_balance.rows[0];
	assert.ok(held !== undefined && 'pay' in held.account, 'a run posts its totals to the balance');
	const payslip = (yield* t.storedQuery({ payslip: { limit: 1 } })).payslip.rows[0];
	const breakdown = Schema.decodeUnknownSync(PayslipBreakdown)(payslip?.breakdown);
	return Object.fromEntries(breakdown.lines.map((line) => [line.code, line.amount]));
});
const run = (seed: ReturnType<typeof pack>, zone: string, check: (paid: Paid) => void) =>
	Effect.gen(function* () {
		check(yield* lines(yield* TestWorkspace));
	}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
type Paid = { readonly [code: string]: number };
const near = (paid: Paid, code: string, expected: number) =>
	assert.ok(
		Math.abs((paid[code] ?? 0) - expected) < 0.01,
		`${code}: paid ${paid[code] ?? 0}, the law says ${expected}; lines ${JSON.stringify(paid)}`
	);

describe('overtime bands', () => {
	// RM 3,120 a month: 120 a day (÷ 26) and 15 an hour (÷ 8), Employment Act 1955 ss.60, 60A, 60D, 60I
	it.live('Malaysia: normal day, rest day and public holiday each pay their band', () =>
		run(
			pack(
				'MY',
				'Asia/Kuala_Lumpur',
				{
					rate: { amount: 3120, unit: 'MONTHLY' },
					normal_hours_per_day: 8,
					normal_hours_per_week: 48,
					normal_days_per_week: 6,
					statutory_work_category: 'MANUAL_LABOUR',
					work_classification: 'EA_COVERED',
					residency_status: 'CITIZEN',
					wage_payment_method: 'BANK',
					allowances: {}
				},
				{},
				[
					{ date: '2026-02-02', shift: WORK, hours: 10, overtime: 2 },
					{ date: '2026-02-07', shift: OFF, hours: 4 },
					{ date: '2026-02-03', shift: WORK, hours: 118, overtime: 110 },
					{ date: '2026-02-01', shift: REST, hours: 8 },
					{ date: '2026-02-08', shift: REST, hours: 3 },
					{ date: '2026-02-15', shift: REST, hours: 10 },
					{ date: '2026-02-11', shift: WORK, hours: 8 },
					{ date: '2026-02-12', shift: WORK, hours: 10, overtime: 2 }
				],
				[
					{ date: '2026-02-11', kind: 'PUBLIC_HOLIDAY' },
					{ date: '2026-02-12', kind: 'SUBSTITUTE' }
				]
			),
			'Asia/Kuala_Lumpur',
			(paid) => {
				// no incentive bucket: hours past the monthly cap stay in the overtime band
				near(paid, 'OVERTIME', (2 + 4 + 110) * 1.5 * 15);
				assert.equal(paid.OVERTIME_INCENTIVE, undefined);
				near(paid, 'REST_DAY_WORK', 120 + 60 + 120);
				near(paid, 'REST_DAY_OVERTIME', 2 * 2 * 15);
				near(paid, 'HOLIDAY_WORK', 240 + 240);
				near(paid, 'HOLIDAY_OVERTIME', 2 * 3 * 15);
			}
		)
	);

	it.live(
		'a run prices only its own period: leave and claims dated elsewhere do not touch it',
		() => {
			const seed = pack(
				'MY',
				'Asia/Kuala_Lumpur',
				{
					rate: { amount: 3120, unit: 'MONTHLY' },
					normal_hours_per_day: 8,
					normal_hours_per_week: 48,
					normal_days_per_week: 6,
					statutory_work_category: 'MANUAL_LABOUR',
					work_classification: 'EA_COVERED',
					residency_status: 'CITIZEN',
					wage_payment_method: 'BANK',
					allowances: {}
				},
				{},
				[],
				[]
			);
			const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
			const unpaid = seed.leave_catalog?.find(
				(row) => row.code === 'UNPAID_LEAVE' && row.settings_id === version
			);
			const claim = seed.claim_catalog?.find(
				(row) => row.code === 'MEDICAL_CLAIM' && row.settings_id === version
			);
			const half = (date: string) => [
				{ date, part: 'AM' },
				{ date, part: 'PM' }
			];
			const entry = { entity_id: ENTITY, employment_id: uuid(6) };
			return run(
				{
					...seed,
					leave_catalog_entry: [
						{
							...entry,
							id: uuid(200),
							catalog_id: String(unpaid?.id)
						}
					],
					leave_catalog_entry_day: [
						...half('2026-01-06'),
						...half('2026-02-10'),
						...half('2026-03-03')
					].map((day, index) => ({
						id: uuid(210 + index),
						leave_entry_id: uuid(200),
						incurred_on: day.date,
						part: day.part
					})),
					claim_catalog_entry: [
						{
							...entry,
							id: uuid(201),
							catalog_id: String(claim?.id),
							quantity: 40,
							incurred_on: '2026-02-05'
						},
						{
							...entry,
							id: uuid(202),
							catalog_id: String(claim?.id),
							quantity: 60,
							incurred_on: '2026-03-05'
						}
					]
				},
				'Asia/Kuala_Lumpur',
				(paid) => {
					// one unpaid day of February's twenty weekdays, not the three on the entry; it is priced in BASIC
					near(paid, 'BASIC', 3120 - 3120 / 28);
					near(paid, 'MEDICAL_CLAIM', 40);
				}
			);
		}
	);

	it.live('a renewal inside the period is one payslip, on the contract in force at its end', () => {
		const seed = pack(
			'MY',
			'Asia/Kuala_Lumpur',
			{
				rate: { amount: 3120, unit: 'MONTHLY' },
				normal_hours_per_day: 8,
				normal_hours_per_week: 48,
				normal_days_per_week: 6,
				statutory_work_category: 'MANUAL_LABOUR',
				work_classification: 'EA_COVERED',
				residency_status: 'CITIZEN',
				wage_payment_method: 'BANK',
				allowances: {}
			},
			{},
			[],
			[]
		);
		const first = seed.employee_contract?.[0] ?? {};
		return run(
			{
				...seed,
				employee_contract: [
					{ ...first, effective_range: { from: '2025-01-01', to: '2026-02-15' } },
					{
						...first,
						id: uuid(7),
						effective_range: { from: '2026-02-16', to: null },
						terms: { ...objectValue(first.terms), rate: { amount: 3380, unit: 'MONTHLY' } }
					}
				]
			},
			'Asia/Kuala_Lumpur',
			(paid) => near(paid, 'BASIC', 3380)
		);
	});

	it.live('overtime follows the attendance period, across a contract that ended in it', () => {
		const seed = pack(
			'MY',
			'Asia/Kuala_Lumpur',
			{
				rate: { amount: 3380, unit: 'MONTHLY' },
				normal_hours_per_day: 8,
				normal_hours_per_week: 48,
				normal_days_per_week: 6,
				statutory_work_category: 'MANUAL_LABOUR',
				work_classification: 'EA_COVERED',
				residency_status: 'CITIZEN',
				wage_payment_method: 'BANK',
				allowances: {}
			},
			{},
			[
				{ date: '2026-01-20', shift: WORK, hours: 12, overtime: 4 },
				{ date: '2026-01-26', shift: WORK, hours: 10, overtime: 2 },
				{ date: '2026-02-10', shift: WORK, hours: 9, overtime: 1 },
				{ date: '2026-02-24', shift: WORK, hours: 12, overtime: 4 }
			],
			[]
		);
		const first = seed.employee_contract?.[0] ?? {};
		return run(
			{
				...seed,
				entity: (seed.entity ?? []).map((row) => ({
					...row,
					payment_schedule: { ...objectValue(row.payment_schedule), pay_cutoff_day: 21 }
				})),
				employee_contract: [
					{ ...first, effective_range: { from: '2025-01-01', to: '2026-01-31' } },
					{ ...first, id: uuid(7), effective_range: { from: '2026-02-01', to: null } }
				],
				roster_entry: (seed.roster_entry ?? []).map((row) =>
					String(row.work_date) < '2026-02-01' ? row : { ...row, employment_id: uuid(7) }
				)
			},
			'Asia/Kuala_Lumpur',
			(paid) => near(paid, 'OVERTIME', (2 + 1) * 1.5 * 16.25)
		);
	});

	it.live('EPF leaves overtime out of its wages; SOCSO keeps it', () =>
		run(
			pack(
				'MY',
				'Asia/Kuala_Lumpur',
				{
					rate: { amount: 3120, unit: 'MONTHLY' },
					normal_hours_per_day: 8,
					normal_hours_per_week: 48,
					normal_days_per_week: 6,
					statutory_work_category: 'MANUAL_LABOUR',
					work_classification: 'EA_COVERED',
					residency_status: 'CITIZEN',
					wage_payment_method: 'BANK',
					allowances: {}
				},
				{},
				[{ date: '2026-02-03', shift: WORK, hours: 48, overtime: 40 }],
				[]
			),
			'Asia/Kuala_Lumpur',
			(paid) => {
				near(paid, 'OVERTIME', 40 * 1.5 * 15);
				near(paid, 'EPF', 344);
				near(paid, 'SOCSO', 20.25);
			}
		)
	);

	it.live("a leave entry raised on one version still counts in another version's run", () => {
		const seed = pack(
			'MY',
			'Asia/Kuala_Lumpur',
			{
				rate: { amount: 2800, unit: 'MONTHLY' },
				normal_hours_per_day: 8,
				normal_hours_per_week: 48,
				normal_days_per_week: 6,
				statutory_work_category: 'MANUAL_LABOUR',
				work_classification: 'EA_COVERED',
				residency_status: 'CITIZEN',
				wage_payment_method: 'BANK',
				allowances: {}
			},
			{},
			[],
			[]
		);
		const later = read(
			join(process.cwd(), 'seed/public/jurisdiction/MY/version_3/leave_catalog.json')
		).find((row) => row.code === 'UNPAID_LEAVE');
		return run(
			{
				...seed,
				entity: (seed.entity ?? []).map((row) => ({
					...row,
					payment_schedule: { ...objectValue(row.payment_schedule), non_working_weekdays: [] }
				})),
				leave_catalog_entry: [
					{
						id: uuid(300),
						entity_id: ENTITY,
						employment_id: uuid(6),
						catalog_id: later?.id ?? '',
						payroll_run_id: null
					}
				],
				leave_catalog_entry_day: [
					{ id: uuid(310), leave_entry_id: uuid(300), incurred_on: '2026-02-10', part: 'AM' },
					{ id: uuid(311), leave_entry_id: uuid(300), incurred_on: '2026-02-10', part: 'PM' }
				]
			},
			'Asia/Kuala_Lumpur',
			(paid) => near(paid, 'BASIC', 2800 - 2800 / 28)
		);
	});

	it.live('a claim entered after its run closed is paid one cycle late, once', () => {
		const seed = pack(
			'MY',
			'Asia/Kuala_Lumpur',
			{
				rate: { amount: 2800, unit: 'MONTHLY' },
				normal_hours_per_day: 8,
				normal_hours_per_week: 48,
				normal_days_per_week: 6,
				statutory_work_category: 'MANUAL_LABOUR',
				work_classification: 'EA_COVERED',
				residency_status: 'CITIZEN',
				wage_payment_method: 'BANK',
				allowances: {}
			},
			{},
			[],
			[]
		);
		const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
		const claim = (seed.claim_catalog ?? []).find(
			(row) => row.code === 'MEDICAL_CLAIM' && row.settings_id === version
		);
		const month = (t: Kit, name: string) => {
			return t
				.as(t.admin)
				.act('payroll_run.create', [
					{ entity_id: ENTITY, period: `2026-${name}`, kind: 'ON_CYCLE' }
				]);
		};
		const paid = Effect.fnUntraced(function* (t: Kit, period: string) {
			const got = yield* t.storedQuery({ payslip: { limit: 10 } });
			return got.payslip.rows
				.filter((row) => row.period === period)
				.flatMap((row) => Schema.decodeUnknownSync(PayslipBreakdown)(row.breakdown).lines)
				.filter((line) => line.code === 'MEDICAL_CLAIM')
				.reduce((total, line) => total + line.amount, 0);
		});
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* month(t, '01');
			yield* t.runDue();
			yield* t.as(t.admin).act('claim_catalog_entry.create', [
				{
					entity_id: ENTITY,
					employment_id: idOf('employee_contract', uuid(6)),
					catalog_id: idOf('claim_catalog', String(claim?.id)),
					quantity: 45,
					incurred_on: PlainDate('2026-01-20')
				}
			]);
			yield* month(t, '02');
			assert.equal(yield* paid(t, '2026-01'), 0);
			assert.equal(yield* paid(t, '2026-02'), 45);
			const sealed = yield* t.storedQuery({ claim_catalog_entry: { limit: 1 } });
			assert.notEqual(sealed.claim_catalog_entry.rows[0]?.payroll_run_id, null);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
	});

	it.live('an off-cycle run pays only the entries it names, and no salary', () => {
		const seed = pack(
			'MY',
			'Asia/Kuala_Lumpur',
			{
				rate: { amount: 2800, unit: 'MONTHLY' },
				normal_hours_per_day: 8,
				normal_hours_per_week: 48,
				normal_days_per_week: 6,
				statutory_work_category: 'MANUAL_LABOUR',
				work_classification: 'EA_COVERED',
				residency_status: 'CITIZEN',
				wage_payment_method: 'BANK',
				allowances: {}
			},
			{},
			[],
			[]
		);
		const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
		const bonus = (seed.adhoc_catalog ?? []).find(
			(row) => row.code === 'BONUS' && row.settings_id === version
		);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(
				t
					.as(t.admin)
					.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-02', kind: 'OFF_CYCLE' }])
			);
			assert.match(String(refused), /Choose what this run pays/);
			yield* t.as(t.admin).act('adhoc_catalog_entry.create', [
				{
					entity_id: ENTITY,
					employment_id: idOf('employee_contract', uuid(6)),
					catalog_id: idOf('adhoc_catalog', String(bonus?.id)),
					description: 'Performance bonus',
					quantity: 1000,
					incurred_on: PlainDate('2026-02-20')
				}
			]);
			const entry = (yield* t.storedQuery({ adhoc_catalog_entry: { limit: 1 } }))
				.adhoc_catalog_entry.rows[0];
			assert.ok(entry !== undefined);
			yield* t.as(t.admin).act('payroll_run.create', [
				{
					entity_id: ENTITY,
					period: '2026-02',
					kind: 'OFF_CYCLE',
					attaches: { adhoc: [entry.id] }
				}
			]);
			const got = yield* t.storedQuery({
				payslip: { limit: 10 },
				payroll_run: { limit: 1 },
				adhoc_catalog_entry: { limit: 1 }
			});
			assert.equal(got.payslip.rows.length, 1);
			assert.equal(String(got.payroll_run.rows[0]?.pay_date), '2026-02-20');
			assert.notEqual(got.adhoc_catalog_entry.rows[0]?.payroll_run_id, null);
			const { lines } = Schema.decodeUnknownSync(PayslipBreakdown)(got.payslip.rows[0]?.breakdown);
			assert.equal(lines.find((line) => line.code === 'BONUS')?.amount, 1000);
			assert.equal(
				lines.some((line) => line.code === 'BASIC'),
				false
			);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
	});

	it.live(
		'deleting an unpaid run removes its payslips, frees what it sealed and undoes the balance',
		() => {
			const seed = pack(
				'MY',
				'Asia/Kuala_Lumpur',
				{
					rate: { amount: 2800, unit: 'MONTHLY' },
					normal_hours_per_day: 8,
					normal_hours_per_week: 48,
					normal_days_per_week: 6,
					statutory_work_category: 'MANUAL_LABOUR',
					work_classification: 'EA_COVERED',
					residency_status: 'CITIZEN',
					wage_payment_method: 'BANK',
					allowances: {}
				},
				{},
				[{ date: '2026-02-10', shift: WORK, hours: 9, overtime: 1 }],
				[]
			);
			const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
			const claim = (seed.claim_catalog ?? []).find(
				(row) => row.code === 'MEDICAL_CLAIM' && row.settings_id === version
			);
			const balance = (t: Kit) =>
				accountsIn(t).pipe(
					Effect.map((accounts) => accounts.pay?.['NET']?.['MY.Y.2026-01-01']?.['total'] ?? 0)
				);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* t.as(t.admin).act('claim_catalog_entry.create', [
					{
						entity_id: ENTITY,
						employment_id: idOf('employee_contract', uuid(6)),
						catalog_id: idOf('claim_catalog', String(claim?.id)),
						quantity: 45,
						incurred_on: PlainDate('2026-02-12')
					}
				]);
				yield* t.runDue();
				yield* t
					.as(t.admin)
					.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]);
				yield* t.runDue();
				assert.ok((yield* balance(t)) > 0);
				const run = (yield* t.storedQuery({ payroll_run: { limit: 1 } })).payroll_run.rows[0];
				assert.ok(run !== undefined);
				const sealed = yield* t.storedQuery({
					claim_catalog_entry: { limit: 1 },
					roster_entry: { limit: 1 }
				});
				const entry = sealed.claim_catalog_entry.rows[0];
				const day = sealed.roster_entry.rows[0];
				assert.ok(entry !== undefined && day !== undefined);
				const editClaim = t
					.as(t.admin)
					.act('claim_catalog_entry.update', [{ target: entry.id, set: { quantity: 50 } }]);
				const editRoster = t
					.as(t.admin)
					.act('roster_entry.update', [
						{ target: day.id, set: { planned_overtime_intervals: [] } }
					]);
				yield* Effect.flip(editClaim);
				yield* Effect.flip(editRoster);
				yield* t.as(t.admin).act('payroll_run.delete', [{ target: run.id }]);
				yield* t.runDue();
				// the run's seal is gone: what it locked is editable again
				yield* editClaim;
				yield* editRoster;
				const got = yield* t.storedQuery({
					payroll_run: { limit: 1 },
					payslip: { limit: 1 },
					claim_catalog_entry: { limit: 1 },
					roster_entry: { limit: 1 }
				});
				assert.equal(got.payroll_run.rows.length, 0);
				assert.equal(got.payslip.rows.length, 0);
				assert.equal(got.claim_catalog_entry.rows.length, 1);
				assert.equal(got.claim_catalog_entry.rows[0]?.payroll_run_id, null);
				assert.equal(String(got.claim_catalog_entry.rows[0]?.quantity), '50');
				assert.equal(got.roster_entry.rows.length, 1);
				assert.equal(got.roster_entry.rows[0]?.payroll_run_id, null);
				assert.equal(yield* balance(t), 0);
				// the same cycle runs again and pays the claim it released
				yield* t
					.as(t.admin)
					.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]);
				yield* t.runDue();
				const rerun = (yield* t.storedQuery({ payroll_run: { limit: 1 } })).payroll_run.rows[0];
				assert.ok(rerun !== undefined);
				yield* t
					.as(t.admin)
					.act('payroll_run.update', [{ target: rerun.id, set: { state: 'PAID' } }]);
				const refused = yield* Effect.flip(
					t.as(t.admin).act('payroll_run.delete', [{ target: rerun.id }])
				);
				assert.match(String(refused), /locked|paid/i);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
		}
	);

	it.live('a leaver is paid the calendar days employed, across a contract split', () => {
		const seed = pack(
			'MY',
			'Asia/Kuala_Lumpur',
			{
				rate: { amount: 1960, unit: 'MONTHLY' },
				normal_hours_per_day: 8,
				normal_hours_per_week: 48,
				normal_days_per_week: 6,
				statutory_work_category: 'MANUAL_LABOUR',
				work_classification: 'EA_COVERED',
				residency_status: 'CITIZEN',
				wage_payment_method: 'BANK',
				allowances: {}
			},
			{},
			[],
			[]
		);
		const first = seed.employee_contract?.[0] ?? {};
		return run(
			{
				...seed,
				entity: (seed.entity ?? []).map((row) => ({
					...row,
					payment_schedule: { ...objectValue(row.payment_schedule), non_working_weekdays: [] }
				})),
				employee_contract: [
					{ ...first, effective_range: { from: '2025-01-01', to: '2026-02-04' } },
					{ ...first, id: uuid(7), effective_range: { from: '2026-02-05', to: '2026-02-10' } }
				]
			},
			'Asia/Kuala_Lumpur',
			(paid) => near(paid, 'BASIC', (1960 * 10) / 28)
		);
	});

	it.live(
		'the first run seals a leave entry; a later run still takes its own dates from it',
		() => {
			const seed = pack(
				'MY',
				'Asia/Kuala_Lumpur',
				{
					rate: { amount: 3120, unit: 'MONTHLY' },
					normal_hours_per_day: 8,
					normal_hours_per_week: 48,
					normal_days_per_week: 6,
					statutory_work_category: 'MANUAL_LABOUR',
					work_classification: 'EA_COVERED',
					residency_status: 'CITIZEN',
					wage_payment_method: 'BANK',
					allowances: {}
				},
				{},
				[],
				[]
			);
			const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
			const unpaid = seed.leave_catalog?.find(
				(row) => row.code === 'UNPAID_LEAVE' && row.settings_id === version
			);
			const entry = idOf('leave_catalog_entry', uuid(200));
			const month = (t: Kit, name: string) => {
				return t
					.as(t.admin)
					.act('payroll_run.create', [
						{ entity_id: ENTITY, period: `2026-${name}`, kind: 'ON_CYCLE' }
					]);
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* month(t, '01');
				yield* t.runDue();
				const sealed = yield* t.storedQuery({
					leave_catalog_entry_day: {
						where: { payroll_run_id: { isNull: false } },
						limit: 1
					}
				});
				assert.ok(sealed.leave_catalog_entry_day.rows.length > 0);
				yield* month(t, '02');
				const got = yield* t.storedQuery({ payslip: { limit: 10 } });
				const lines = got.payslip.rows
					.filter((row) => row.period === '2026-02')
					.flatMap((row) => Schema.decodeUnknownSync(PayslipBreakdown)(row.breakdown).lines);
				// half of one of February's 28 days (Employment Act s.18A), taken from the entry the January run sealed
				const basic = lines.find((row) => row.code === 'BASIC');
				assert.ok(Math.abs((basic?.amount ?? 0) - (3120 - 3120 / 28 / 2)) < 0.01);
			}).pipe(
				Effect.provide(
					workspace({
						seed: {
							...seed,
							leave_catalog_entry: [
								{
									id: entry,
									entity_id: ENTITY,
									employment_id: uuid(6),
									catalog_id: String(unpaid?.id)
								}
							],
							leave_catalog_entry_day: [
								{ id: uuid(650), leave_entry_id: entry, incurred_on: '2026-01-06', part: 'AM' },
								{ id: uuid(651), leave_entry_id: entry, incurred_on: '2026-01-06', part: 'PM' },
								{ id: uuid(652), leave_entry_id: entry, incurred_on: '2026-02-10', part: 'AM' }
							]
						},
						now: '2026-02-26T02:00:00.000Z'
					})
				)
			);
		}
	);

	// ₱15,650 × 12 ÷ 313 = ₱600 a day, ₱75 an hour; the 313 factor already pays holidays, so they add their premium only
	it.live('Philippines: ordinary, rest day, regular and special holiday each pay their band', () =>
		run(
			pack(
				'PH',
				'Asia/Manila',
				{
					rate: { amount: 15650, unit: 'MONTHLY' },
					normal_hours_per_day: 8,
					normal_hours_per_week: 48,
					normal_days_per_week: 6,
					statutory_work_category: 'NON_FIELD',
					work_classification: 'RANK_AND_FILE',
					residency_status: 'CITIZEN',
					wage_payment_method: 'BANK',
					allowances: {}
				},
				{ days_per_year: 313, nationality: 'PH' },
				[
					{ date: '2026-02-02', shift: WORK, hours: 11, overtime: 3 },
					{ date: '2026-02-01', shift: REST, hours: 8 },
					{ date: '2026-02-08', shift: REST, hours: 10 },
					{ date: '2026-02-11', shift: WORK, hours: 8 },
					{ date: '2026-02-12', shift: WORK, hours: 8 },
					{ date: '2026-02-13', shift: WORK, hours: 10, overtime: 2 }
				],
				[
					{ date: '2026-02-11', kind: 'PUBLIC_HOLIDAY' },
					{ date: '2026-02-12', kind: 'SPECIAL_HOLIDAY' },
					{ date: '2026-02-13', kind: 'PUBLIC_HOLIDAY' }
				]
			),
			'Asia/Manila',
			(paid) => {
				near(paid, 'OVERTIME', 3 * 1.25 * 75 + 2 * 1.69 * 75 + 2 * 2.6 * 75);
				near(paid, 'REST_DAY_WORK', 2 * 8 * 1.3 * 75);
				near(paid, 'HOLIDAY_WORK', 2 * 8 * 1 * 75);
				near(paid, 'SPECIAL_HOLIDAY_WORK', 8 * 0.3 * 75);
			}
		)
	);

	it.live('Philippines: a manager is paid no overtime, whatever the roster shows', () =>
		run(
			pack(
				'PH',
				'Asia/Manila',
				{
					rate: { amount: 130000, unit: 'MONTHLY' },
					normal_hours_per_day: 8,
					normal_hours_per_week: 40,
					normal_days_per_week: 5,
					statutory_work_category: 'MANAGERIAL',
					work_classification: 'MANAGERIAL',
					residency_status: 'CITIZEN',
					wage_payment_method: 'BANK',
					allowances: {}
				},
				{ days_per_year: 261, nationality: 'PH' },
				[
					{ date: '2026-02-02', shift: WORK, hours: 11, overtime: 3 },
					{ date: '2026-02-01', shift: REST, hours: 8 }
				],
				[]
			),
			'Asia/Manila',
			(paid) => {
				near(paid, 'OVERTIME', 0);
				near(paid, 'REST_DAY_WORK', 0);
			}
		)
	);

	// Rp 7,378,688 ÷ 173 = Rp 42,651.38 an hour; PP 35/2021 art.31: 1.5 then 2 on a work day, and the rest-day ladder
	it.live('Indonesia: the work-day and rest-day ladders, five-day week', () =>
		run(
			pack(
				'ID',
				'Asia/Jakarta',
				{
					rate: { amount: 7400000, unit: 'MONTHLY' },
					normal_hours_per_day: 8,
					normal_hours_per_week: 40,
					normal_days_per_week: 5,
					statutory_work_category: 'NON_MANUAL',
					work_classification: 'ORDINARY',
					residency_status: 'CITIZEN',
					wage_payment_method: 'BANK',
					allowances: {}
				},
				{ nationality: 'ID', ptkp_dependents_count: 0 },
				[
					{ date: '2026-02-02', shift: WORK, hours: 10, overtime: 2 },
					{ date: '2026-02-01', shift: REST, hours: 10 },
					{ date: '2026-02-11', shift: WORK, hours: 8 }
				],
				[{ date: '2026-02-11', kind: 'PUBLIC_HOLIDAY' }]
			),
			'Asia/Jakarta',
			(paid) => {
				const hourly = 7400000 / 173;
				const workDay = 1 * 1.5 + 1 * 2;
				const restDay = 8 * 2 + 1 * 3 + 1 * 4;
				const holiday = 8 * 2;
				// ID rounds money to whole rupiah
				near(paid, 'OVERTIME', Math.round((workDay + restDay + holiday) * hourly));
			}
		)
	);
});
