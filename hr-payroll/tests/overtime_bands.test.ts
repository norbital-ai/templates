// A payroll run prices worked days in the right band: real sealed law, a synthetic employee, a roster and a month, end to
// end through `payroll_run.create`. Every expected figure is the statute's arithmetic, worked here by hand.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf, objectValue } from '../src/lib/payroll_engine/reads.ts';
import { workspace } from './kit.ts';

const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const ENTITY = idOf('entity', uuid(1));
const WORK = uuid(11),
	REST = uuid(12),
	OFF = uuid(13);
const read = (path: string): readonly JsonObject[] => {
	const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
	return Schema.decodeUnknownSync(Schema.Array(JsonObject))(Array.isArray(value) ? value : [value]);
};
const ON = '2026-02-15';
type Day = {
	readonly date: string;
	readonly shift: string;
	readonly hours: number;
	readonly overtime?: number;
};
type Holiday = { readonly date: string; readonly kind: string };
/** One jurisdiction's public law plus one employee, one roster and the holidays of a February. */
const pack = (
	code: string,
	zone: string,
	terms: JsonObject,
	extension: JsonObject,
	days: readonly Day[],
	holidays: readonly Holiday[]
): { readonly [model: string]: readonly JsonObject[] } => {
	const rows: { [model: string]: JsonObject[] } = {};
	const root = join(process.cwd(), 'seed/public/jurisdiction', code);
	let settings = '';
	for (const version of readdirSync(root))
		for (const file of readdirSync(join(root, version))) {
			const own = read(join(root, version, file));
			(rows[file.replace('.json', '')] ??= []).push(...own);
			for (const row of own) {
				const { from, to } = Schema.decodeUnknownSync(
					Schema.Struct({ from: Schema.String, to: Schema.NullOr(Schema.String) })
				)(file === 'jurisdiction_settings.json' ? row.effective_range : { from: '9', to: '0' });
				if (from <= ON && (to === null || ON <= to)) settings = String(row.id);
			}
		}
	const instant = (date: string, hours: number) =>
		new Date(Date.parse(`${date}T00:00:00.000Z`) + hours * 3_600_000).toISOString();
	const shift = (id: string, name: string, variant: JsonObject) => ({
		id,
		entity_id: ENTITY,
		code: name,
		name,
		effective_range: { from: '2025-01-01', to: null },
		variant
	});
	return {
		...rows,
		entity: [{ id: ENTITY, code: 'E1', name: 'Entity', settings_code: code }],
		entity_profile_version: [
			{
				id: uuid(2),
				entity_id: ENTITY,
				name: 'Entity',
				settings_code: code,
				input_schema_version_id: settings,
				effective_range: { from: '2025-01-01', to: null },
				time_zone: zone,
				pay_cutoff_day: 1,
				payment_schedule: {
					frequency: 'MONTHLY',
					business_day: 'PREVIOUS',
					non_working_weekdays: [0, 6],
					short_month: 'LAST_DAY',
					anchors: [{ cycle_part: 1, day: 25, month_offset: 0 }]
				},
				entity_extension_data: {},
				status: 'SEALED'
			}
		],
		sys_user: [{ id: uuid(3), name: 'Worker', email: 'worker@example.test', kind: 'staff' }],
		employee_profile: [{ id: uuid(4), user_id: uuid(3), name: 'Worker' }],
		employee_balance: [{ id: uuid(5), employee_id: uuid(4), account: {} }],
		employee_contract: [
			{
				id: uuid(6),
				employee_id: uuid(4),
				entity_id: ENTITY,
				employee_number: 'W1',
				employee_name: 'Worker',
				engagement: 'EMPLOYEE',
				status: 'SEALED',
				effective_range: { from: '2025-01-01', to: null },
				input_schema_version_id: settings,
				terms,
				payroll: { date_of_birth: '1990-01-01', gender: 'MALE', marital_status: 'SINGLE' },
				bank: {
					bank_name: 'Bank',
					bank_code: '001',
					bank_account_number: '1',
					bank_account_name: 'Worker'
				},
				employee_extension_data: extension,
				service_started_on: '2025-01-01'
			}
		],
		shift_definition: [
			shift(WORK, 'DAY', {
				day_type: 'WORK',
				start_time: '08:00',
				end_time: '16:00',
				ends_next_day: false,
				breaks: []
			}),
			shift(REST, 'REST', { day_type: 'REST', ends_next_day: false, breaks: [] }),
			shift(OFF, 'OFF', { day_type: 'OFF', ends_next_day: false, breaks: [] })
		],
		holiday: holidays.map((holiday, index) => ({
			id: uuid(20 + index),
			entity_id: ENTITY,
			date: holiday.date,
			name: holiday.kind,
			kind: holiday.kind,
			given_to: 'EVERYONE',
			published_at: '2025-12-01T00:00:00.000Z'
		})),
		roster_entry: days.map((day, index) => ({
			id: uuid(100 + index),
			employment_id: uuid(6),
			work_date: day.date,
			shift_definition_id: day.shift,
			actual_worked_intervals: [{ start: instant(day.date, 0), end: instant(day.date, day.hours) }],
			planned_overtime_intervals:
				day.overtime === undefined
					? null
					: [
							{
								start: instant(day.date, day.hours - day.overtime),
								end: instant(day.date, day.hours)
							}
						],
			findings: []
		}))
	};
};
const february = { from: PlainDate('2026-02-01'), to: PlainDate('2026-02-28') };
const lines = Effect.fnUntraced(function* (t: Kit, zone: string, attendance = february) {
	const settings = (yield* t.storedQuery({
		employee_contract: { limit: 1 }
	})).employee_contract.rows[0]?.input_schema_version_id;
	yield* t.as(t.admin).act('payroll_run.create', [
		{
			entity_id: ENTITY,
			settings_id: idOf('jurisdiction_settings', String(settings)),
			period: '2026-02',
			kind: 'REGULAR',
			salary_coverage: february,
			attendance_coverage: attendance,
			pay_date: PlainDate('2026-02-25'),
			pay_due_date: PlainDate('2026-02-25'),
			payment_timezone: zone,
			occurrence_key: 'february',
			state: 'FINALISED'
		}
	]);
	const payslip = (yield* t.storedQuery({ payslip: { limit: 1 } })).payslip.rows[0];
	const breakdown = Schema.decodeUnknownSync(PayslipBreakdown)(payslip?.breakdown);
	return Object.fromEntries(breakdown.lines.map((line) => [line.code, line.amount]));
});
const run = (
	seed: ReturnType<typeof pack>,
	zone: string,
	check: (paid: Paid) => void,
	attendance = february
) =>
	Effect.gen(function* () {
		check(yield* lines(yield* TestWorkspace, zone, attendance));
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
					{ date: '2026-02-12', shift: WORK, hours: 10 }
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
			const version = seed.employee_contract?.[0]?.input_schema_version_id;
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
			const entry = { entity_id: ENTITY, employment_id: uuid(6), is_reversal: false };
			return run(
				{
					...seed,
					leave_catalog_entry: [
						{
							...entry,
							id: uuid(200),
							catalog_id: String(unpaid?.id),
							days: [...half('2026-01-06'), ...half('2026-02-10'), ...half('2026-03-03')]
						}
					],
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
					// one unpaid day of February's twenty weekdays, not the three on the entry
					near(paid, 'BASIC', (3120 * 19) / 20);
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
				employee_contract: [
					{ ...first, effective_range: { from: '2025-01-01', to: '2026-01-31' } },
					{ ...first, id: uuid(7), effective_range: { from: '2026-02-01', to: null } }
				],
				roster_entry: (seed.roster_entry ?? []).map((row) =>
					String(row.work_date) < '2026-02-01' ? row : { ...row, employment_id: uuid(7) }
				)
			},
			'Asia/Kuala_Lumpur',
			(paid) => near(paid, 'OVERTIME', (2 + 1) * 1.5 * 16.25),
			{ from: PlainDate('2026-01-21'), to: PlainDate('2026-02-20') }
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
				entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
					...row,
					payment_schedule: { ...objectValue(row.payment_schedule), non_working_weekdays: [] }
				})),
				leave_catalog_entry: [
					{
						id: uuid(300),
						entity_id: ENTITY,
						employment_id: uuid(6),
						catalog_id: later?.id ?? '',
						payroll_run_id: null,
						days: [
							{ date: '2026-02-10', part: 'AM' },
							{ date: '2026-02-10', part: 'PM' }
						],
						is_reversal: false
					}
				]
			},
			'Asia/Kuala_Lumpur',
			(paid) => near(paid, 'BASIC', (2800 * 27) / 28)
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
		const version = seed.employee_contract?.[0]?.input_schema_version_id;
		const claim = (seed.claim_catalog ?? []).find(
			(row) => row.code === 'MEDICAL_CLAIM' && row.settings_id === version
		);
		const month = (t: Kit, name: string, last: `${number}`) => {
			const cover = {
				from: PlainDate(`2026-${name}-01`),
				to: PlainDate(`2026-${name}-${last}`)
			};
			return t.as(t.admin).act('payroll_run.create', [
				{
					entity_id: ENTITY,
					settings_id: idOf('jurisdiction_settings', String(version)),
					period: `2026-${name}`,
					kind: 'REGULAR',
					salary_coverage: cover,
					attendance_coverage: cover,
					pay_date: PlainDate(`2026-${name}-25`),
					pay_due_date: PlainDate(`2026-${name}-25`),
					payment_timezone: 'Asia/Kuala_Lumpur',
					occurrence_key: name,
					state: 'FINALISED'
				}
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
			yield* month(t, '01', '31');
			yield* t.as(t.admin).act('claim_catalog_entry.create', [
				{
					entity_id: ENTITY,
					employment_id: idOf('employee_contract', uuid(6)),
					catalog_id: idOf('claim_catalog', String(claim?.id)),
					quantity: 45,
					incurred_on: PlainDate('2026-01-20')
				}
			]);
			yield* month(t, '02', '28');
			assert.equal(yield* paid(t, '2026-01'), 0);
			assert.equal(yield* paid(t, '2026-02'), 45);
			const sealed = yield* t.storedQuery({ claim_catalog_entry: { limit: 1 } });
			assert.notEqual(sealed.claim_catalog_entry.rows[0]?.payroll_run_id, null);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
	});

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
				entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
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
			const version = seed.employee_contract?.[0]?.input_schema_version_id;
			const unpaid = seed.leave_catalog?.find(
				(row) => row.code === 'UNPAID_LEAVE' && row.settings_id === version
			);
			const entry = idOf('leave_catalog_entry', uuid(200));
			const month = (t: Kit, name: string, last: `${number}`) => {
				const cover = {
					from: PlainDate(`2026-${name}-01`),
					to: PlainDate(`2026-${name}-${last}`)
				};
				return t.as(t.admin).act('payroll_run.create', [
					{
						entity_id: ENTITY,
						settings_id: idOf('jurisdiction_settings', String(version)),
						period: `2026-${name}`,
						kind: 'REGULAR',
						salary_coverage: cover,
						attendance_coverage: cover,
						pay_date: PlainDate(`2026-${name}-25`),
						pay_due_date: PlainDate(`2026-${name}-25`),
						payment_timezone: 'Asia/Kuala_Lumpur',
						occurrence_key: name,
						state: 'FINALISED'
					}
				]);
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* month(t, '01', '31');
				const sealed = yield* t.storedQuery({ leave_catalog_entry: { limit: 1 } });
				assert.notEqual(sealed.leave_catalog_entry.rows[0]?.payroll_run_id, null);
				yield* Effect.flip(
					t
						.as(t.admin)
						.act('leave_catalog_entry.update', [{ target: entry, set: { is_reversal: true } }])
				);
				yield* month(t, '02', '28');
				const got = yield* t.storedQuery({ payslip: { limit: 10 } });
				const basic = got.payslip.rows
					.filter((row) => row.period === '2026-02')
					.map(
						(row) =>
							Schema.decodeUnknownSync(PayslipBreakdown)(row.breakdown).lines.find(
								(line) => line.code === 'BASIC'
							)?.amount
					);
				// half of one of February's twenty weekdays, taken from the entry the January run sealed
				assert.deepEqual(basic, [3120 * (19.5 / 20)]);
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
									catalog_id: String(unpaid?.id),
									days: [
										{ date: '2026-01-06', part: 'AM' },
										{ date: '2026-01-06', part: 'PM' },
										{ date: '2026-02-10', part: 'AM' }
									],
									is_reversal: false
								}
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
					{ date: '2026-02-08', shift: REST, hours: 10, overtime: 2 },
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
					rate: { amount: 7378688, unit: 'MONTHLY' },
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
				const hourly = 7378688 / 173;
				const workDay = 1 * 1.5 + 1 * 2;
				const restDay = 8 * 2 + 1 * 3 + 1 * 4;
				const holiday = 8 * 2;
				near(paid, 'OVERTIME', (workDay + restDay + holiday) * hourly);
			}
		)
	);
});
