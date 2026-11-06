// The year-end paths end to end through `payroll_run`: a refund, the figures a month holds and the late-wage fine.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));

const terms = (amount: number, residency = 'RESIDENT', category = 'NON_MANUAL') => ({
	rate: { amount, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: category,
	work_classification: 'EA_COVERED',
	residency_status: residency,
	wage_payment_method: 'BANK',
	allowances: {}
});
type Seed = ReturnType<typeof pack>;

const itemId = (seed: Seed, family: string, code: string) => {
	const version = seed.employee_contract?.[0]?.input_schema_version_id;
	const row = (seed[family] ?? []).find((r) => r.code === code && r.settings_id === version);
	assert.ok(row !== undefined, code);
	return String(row.id);
};
const run = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
const pay = (t: Kit, seed: Seed, code: string, amount: number, on: string) =>
	t.as(t.admin).act('adhoc_catalog_entry.create', [
		{
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('adhoc_catalog', itemId(seed, 'adhoc_catalog', code)),
			description: code,
			quantity: amount,
			unit: 'MONEY',
			incurred_on: PlainDate(on)
		}
	]);
const slips = (t: Kit) =>
	t.storedQuery({ payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) =>
			got.payslip.rows
				.map((slip) => ({
					slip,
					period: got.payroll_run.rows.find((row) => row.id === slip.payroll_run_id)?.period ?? '',
					breakdown: Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown)
				}))
				.sort((a, b) => a.period.localeCompare(b.period))
		)
	);
const months = (year: number, last = 12) =>
	Array.from({ length: last }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

const JAPAN_FACTS = {
	insured_office_region: 'HOKKAIDO',
	statutory: { INCOME_TAX: { elections: { dependency_declaration_filed: true } } }
};
const japan = (salary: number) =>
	pack(
		'JP',
		'Asia/Tokyo',
		terms(salary, 'RESIDENT', 'SOCIAL_AND_EMPLOYMENT'),
		JAPAN_FACTS,
		[],
		[],
		'2026-06-15'
	);
const statutory = (
	row: { readonly breakdown: PayslipBreakdown } | undefined,
	code: string
): number => row?.breakdown.statutory.find((one) => one.code === code)?.employee ?? 0;
const balance = (t: Kit) =>
	t
		.storedQuery({ employee_balance: { limit: 1 } })
		.pipe(
			Effect.map((got) =>
				Schema.decodeUnknownSync(
					Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Number))
				)(got.employee_balance.rows[0]?.account)
			)
		);

describe('a December refund', () => {
	// a one-month spike withholds at that month's high rate; December settles the year and comes back negative
	const CASES = [
		[
			'Indonesia',
			pack('ID', 'Asia/Jakarta', terms(10_000_000, 'CITIZEN'), {}, [], [], '2026-06-15'),
			'BONUS_THR',
			200_000_000
		],
		['Japan', japan(500_000), 'BONUS', 5_000_000],
		[
			'Philippines',
			pack('PH', 'Asia/Manila', terms(60_000), {}, [], [], '2026-06-15'),
			'bonus',
			2_000_000
		],
		[
			'Vietnam, with finalisation authorised',
			pack(
				'VN',
				'Asia/Ho_Chi_Minh',
				terms(60_000_000),
				{ facts: { statutory: { PIT: { elections: { finalisation_authorised: true } } } } },
				[],
				[],
				'2026-06-15'
			),
			'BONUS',
			3_000_000_000
		]
	] as const;

	for (const [name, seed, spike, amount] of CASES)
		it.live(
			`${name}: an overpaid year flags HR, whose Statutory refund entry the next run pays`,
			() =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* pay(t, seed, spike, amount, '2026-10-10');
					for (const period of ['2026-10', '2026-11', '2026-12']) yield* run(t, period);
					const december = (yield* slips(t)).find((row) => row.period === '2026-12');
					const overpaid = (december?.breakdown.statutory ?? []).reduce(
						(sum, row) => sum + (row.overpaid ?? 0),
						0
					);
					assert.ok(overpaid > 0, `${name}: December overpaid nothing`);
					// nothing pays it by itself: the obligation tells the HR controller to enter it
					const entries = (yield* t.storedQuery({
						adhoc_catalog_entry: { where: { is_reversal: { eq: true } }, limit: 10 }
					})).adhoc_catalog_entry.rows;
					assert.deepEqual(entries, []);
					const flagged = (yield* t.storedQuery({
						obligation: { limit: 10000 }
					})).obligation.rows.filter((row) => row.title.startsWith('Tax overpaid in 2026'));
					assert.equal(flagged.length, 1);
					yield* t.as(t.admin).act('adhoc_catalog_entry.create', [
						{
							entity_id: ENTITY,
							employment_id: CONTRACT,
							catalog_id: idOf('adhoc_catalog', itemId(seed, 'adhoc_catalog', 'STATUTORY_REFUND')),
							description: 'Tax overpaid in 2026',
							quantity: overpaid,
							unit: 'MONEY',
							incurred_on: PlainDate('2027-01-05')
						}
					]);
					yield* run(t, '2027-01');
					const january = (yield* slips(t)).find((row) => row.period === '2027-01');
					const line = january?.breakdown.lines.find((row) => row.code === 'STATUTORY_REFUND');
					assert.equal(line?.amount, overpaid);
					assert.equal(line?.direction, 'ADD');
					// the refund is paid once
					yield* run(t, '2027-02');
					const february = (yield* slips(t)).find((row) => row.period === '2027-02');
					assert.equal(
						february?.breakdown.lines.some((row) => row.code === 'STATUTORY_REFUND'),
						false
					);
				}).pipe(Effect.provide(workspace({ seed, now: '2027-02-20T02:00:00.000Z' })))
		);
});

describe('figures a month holds, across runs', () => {
	it.live('Japan: the health ceiling runs April to March, across January', () => {
		const seed = japan(500_000);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, seed, 'BONUS', 4_000_000, '2026-06-10');
			yield* pay(t, seed, 'BONUS', 4_000_000, '2026-12-10');
			yield* pay(t, seed, 'BONUS', 1_000_000, '2027-01-10');
			yield* pay(t, seed, 'BONUS', 1_000_000, '2027-04-10');
			for (const period of ['2026-06', '2026-12', '2027-01', '2027-04']) yield* run(t, period);
			const paid = yield* slips(t);
			const of = (period: string) =>
				statutory(
					paid.find((row) => row.period === period),
					'HEALTH_BONUS'
				);
			const perYen = of('2026-06') / 4_000_000;
			// ¥5,730,000 a year: ¥1,730,000 of it left in December, none in January, a new year in April
			assert.ok(Math.abs(of('2026-12') - perYen * 1_730_000) < 2, String(of('2026-12')));
			assert.equal(of('2027-01'), 0);
			assert.ok(Math.abs(of('2027-04') - perYen * 1_000_000) < 2, String(of('2027-04')));
		}).pipe(Effect.provide(workspace({ seed, now: '2027-05-01T02:00:00.000Z' })));
	});

	it.live('Japan: a second bonus in a month has what is left of the pension ceiling', () => {
		const seed = japan(500_000);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, seed, 'BONUS', 1_000_000, '2026-06-10');
			yield* run(t, '2026-06');
			yield* pay(t, seed, 'BONUS', 1_000_000, '2026-06-26');
			const entry = (yield* t.storedQuery({
				adhoc_catalog_entry: { where: { payroll_run_id: { isNull: true } }, limit: 1 }
			})).adhoc_catalog_entry.rows[0];
			assert.ok(entry !== undefined);
			yield* t.as(t.admin).act('payroll_run.create', [
				{
					entity_id: ENTITY,
					period: '2026-06',
					kind: 'OFF_CYCLE',
					attaches: { adhoc: [entry.id] }
				}
			]);
			yield* t.runDue();
			const [first, second] = (yield* slips(t)).sort(
				(a, b) => statutory(b, 'PENSION_BONUS') - statutory(a, 'PENSION_BONUS')
			);
			// ¥1,500,000 in a month: ¥1,000,000 of it went on the first bonus
			assert.ok(
				Math.abs(statutory(second, 'PENSION_BONUS') - statutory(first, 'PENSION_BONUS') / 2) < 2
			);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-06-28T02:00:00.000Z' })));
	});

	it.live('Japan: a January bonus reads December pay, past the year end', () => {
		const seed = japan(500_000);
		const bonusTax = (months: readonly string[]) =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, seed, 'BONUS', 1_000_000, '2027-01-10');
				for (const period of months) yield* run(t, period);
				const paid = yield* slips(t);
				return statutory(
					paid.find((row) => row.period === '2027-01'),
					'INCOME_TAX'
				);
			}).pipe(Effect.provide(workspace({ seed, now: '2027-02-01T02:00:00.000Z' })));
		return Effect.gen(function* () {
			const after = yield* bonusTax(['2026-12', '2027-01']);
			const alone = yield* bonusTax(['2027-01']);
			assert.notEqual(after, alone);
		});
	});

	it.live('Japan: a month older than twelve leaves the balance with a dated entry', () => {
		const seed = japan(500_000);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			for (const period of [...months(2026), '2027-01', '2027-02']) yield* run(t, period);
			const { month = {} } = yield* balance(t);
			assert.equal(
				Object.keys(month).some((key) => key.startsWith('2026-01.')),
				false
			);
			assert.equal(
				Object.keys(month).some((key) => key.startsWith('2026-02.')),
				true
			);
			assert.equal(month['2027-02.BASIC'], 500_000);
		}).pipe(Effect.provide(workspace({ seed, now: '2027-03-01T02:00:00.000Z' })));
	});

	it.live('a salary in cents crosses the year end and keeps posting', () => {
		const seed = pack('PH', 'Asia/Manila', terms(33_333.33), {}, [], [], '2026-06-15');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			for (const period of [...months(2026), '2027-01', '2027-02']) yield* run(t, period);
			const { ytd = {}, month = {} } = yield* balance(t);
			assert.equal(ytd['TAX_YEAR'], 2027);
			assert.ok(month['2027-02.ORDINARY_WAGES'] !== undefined);
			assert.equal(
				Object.keys(month).some((key) => key.startsWith('2026-01.')),
				false
			);
		}).pipe(Effect.provide(workspace({ seed, now: '2027-03-01T02:00:00.000Z' })));
	});

	// a year of RM8,000 sums to 142.80000000000004 of EIS, past the digits the ledger keeps
	it.live('Malaysia: a balance in float dust closes the year, and that run can still go', () => {
		const seed = pack('MY', 'Asia/Kuala_Lumpur', terms(8000, 'CITIZEN'), {}, [], [], '2026-06-15');
		const january = (t: Kit) =>
			t.storedQuery({ payroll_run: { where: { period: { eq: '2027-01' } }, limit: 1 } });
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			for (const period of [...months(2026), '2027-01']) yield* run(t, period);
			assert.equal((yield* balance(t)).ytd?.['BASIC'], 8000);
			const target = (yield* january(t)).payroll_run.rows[0]?.id;
			assert.ok(target !== undefined);
			yield* t.as(t.admin).act('payroll_run.delete', [{ target: idOf('payroll_run', target) }]);
			yield* t.runDue();
			assert.equal((yield* balance(t)).ytd?.['BASIC'], 12 * 8000);
			yield* run(t, '2027-01');
			assert.equal((yield* balance(t)).ytd?.['BASIC'], 8000);
		}).pipe(Effect.provide(workspace({ seed, now: '2027-02-01T02:00:00.000Z' })));
	});

	it.live('Vietnam: a bonus in a second run is taxed as if the month were one run', () => {
		const seed = pack('VN', 'Asia/Ho_Chi_Minh', terms(30_000_000), {}, [], [], '2026-06-15');
		const pit = (split: boolean) =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				if (!split) yield* pay(t, seed, 'BONUS', 100_000_000, '2026-06-10');
				yield* run(t, '2026-06');
				if (split) {
					yield* pay(t, seed, 'BONUS', 100_000_000, '2026-06-26');
					const entry = (yield* t.storedQuery({ adhoc_catalog_entry: { limit: 1 } }))
						.adhoc_catalog_entry.rows[0];
					assert.ok(entry !== undefined);
					yield* t.as(t.admin).act('payroll_run.create', [
						{
							entity_id: ENTITY,
							period: '2026-06',
							kind: 'OFF_CYCLE',
							attaches: { adhoc: [entry.id] }
						}
					]);
				}
				return (yield* slips(t)).reduce((sum, row) => sum + statutory(row, 'PIT'), 0);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-06-28T02:00:00.000Z' })));
		return Effect.gen(function* () {
			assert.equal(yield* pit(true), yield* pit(false));
		});
	});

	it.live('Philippines: two cycles charge what one month would, on the month’s wages', () => {
		const monthly = pack('PH', 'Asia/Manila', terms(30_000), {}, [], [], '2026-06-15');
		const semi = {
			...monthly,
			entity_profile_version: (monthly.entity_profile_version ?? []).map((row) => ({
				...row,
				payment_schedule: {
					frequency: 'SEMI_MONTHLY',
					business_day: 'PREVIOUS',
					non_working_weekdays: [0, 6],
					short_month: 'LAST_DAY',
					anchors: [
						{ cycle_part: 1, day: 15, month_offset: 0 },
						{ cycle_part: 2, day: 30, month_offset: 0 }
					]
				}
			}))
		};
		const charged = (seed: Seed, periods: readonly string[]) =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				for (const period of periods) yield* run(t, period);
				const paid = yield* slips(t);
				return ['SSS', 'SSS_MPF', 'HDMF'].map((code) =>
					paid.reduce((sum, row) => sum + statutory(row, code), 0)
				);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-06-30T02:00:00.000Z' })));
		return Effect.gen(function* () {
			assert.deepEqual(
				yield* charged(semi, ['2026-05-1', '2026-05-2']),
				yield* charged(monthly, ['2026-05'])
			);
		});
	});
});

describe('the late-wage fine', () => {
	const seed = pack('ID', 'Asia/Jakarta', terms(10_000_000, 'CITIZEN'), {}, [], [], '2026-06-15');
	const fines = (t: Kit) =>
		t
			.storedQuery({ obligation: { limit: 100 } })
			.pipe(
				Effect.map((got) =>
					got.obligation.rows.filter((row) => row.title === 'Late wage: fine owed to the worker')
				)
			);
	const paidOn = (date: string) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-06');
			const held = (yield* t.storedQuery({ payroll_run: { limit: 1 } })).payroll_run.rows[0];
			assert.ok(held !== undefined);
			assert.equal(String(held.pay_date), '2026-06-25');
			t.clock.set(`${date}T02:00:00.000Z`);
			yield* t.as(t.admin).act('payroll_run.update', [{ target: held.id, set: { state: 'PAID' } }]);
			yield* t.runDue();
			return (yield* fines(t)).length;
		}).pipe(Effect.provide(workspace({ seed, now: '2026-06-20T02:00:00.000Z' })));

	it.live('paid within three days of the pay date: no fine', () =>
		Effect.gen(function* () {
			assert.equal(yield* paidOn('2026-06-27'), 0);
		})
	);
	it.live('paid from the fourth day: the employer owes each worker the fine', () =>
		Effect.gen(function* () {
			assert.equal(yield* paidOn('2026-06-28'), 1);
		})
	);
});
