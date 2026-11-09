// What a run prices and seals when attendance runs half a month in arrears, as an HR controller runs it: every entry is
// priced once, by the run whose window holds it, sealed by that run, and never by a run without its person's payslip.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate, addMonths, datePeriod, eachDay } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { attendanceOf, cycleOf, payDateOf } from '../src/lib/payroll_engine/pay_cycle.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { loadRun } from '../src/lib/payroll_engine/run_calculation.ts';
import {
	ENTITY,
	OFF,
	WORK,
	catalogRow,
	leaveCreate,
	pack,
	uuid,
	wholeDays,
	workspace
} from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
type Seed = ReturnType<typeof pack>;
const terms = (amount: number) => ({
	rate: { amount, unit: 'MONTHLY' },
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'RESIDENT',
	wage_payment_method: 'BANK',
	allowances: {}
});
// Company C's schedule: two halves a month, each attending the half before it
const ARREARS = {
	frequency: 'SEMI_MONTHLY',
	business_day: 'PREVIOUS',
	non_working_weekdays: [0, 6],
	short_month: 'LAST_DAY',
	pay_days: [15, 31],
	pay_cutoff_day: 16
};
const seedOf = (
	amount: number,
	ranges: readonly { readonly from: string; readonly to: string | null }[],
	days: Parameters<typeof pack>[4] = []
): Seed => {
	const seed = pack('PH', 'Asia/Manila', terms(amount), {}, days, []);
	const [contract] = seed.employee_contract ?? [];
	assert.ok(contract !== undefined);
	return {
		...seed,
		entity: (seed.entity ?? []).map((row) => ({ ...row, payment_schedule: ARREARS })),
		employee_contract: ranges.map((effective_range, index) => ({
			...contract,
			id: uuid(6 + index),
			effective_range
		}))
	};
};
const run = (t: Kit, period: string) =>
	t
		.as(t.member(['hr_controller']))
		.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
const runIds = (t: Kit) =>
	t
		.storedQuery({ payroll_run: { limit: 100 } })
		.pipe(
			Effect.map(
				(got) => new Map(got.payroll_run.rows.map((row) => [row.period, String(row.id)] as const))
			)
		);
/** The one payslip of a period's run, as lines and statutory rows; undefined when the run paid nobody. */
const slipOf = (t: Kit, period: string) =>
	t.storedQuery({ payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) => {
			const ran = got.payroll_run.rows.find((row) => row.period === period);
			const slip = got.payslip.rows.find((row) => row.payroll_run_id === ran?.id);
			return slip === undefined
				? undefined
				: Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown);
		})
	);
const lineOf = (slip: PayslipBreakdown | undefined, code: string) =>
	slip?.lines
		.filter((line) => line.code === code)
		.reduce((total, line) => total + line.amount, 0) ?? 0;
const unpaidLeave = (t: Kit, seed: Seed, ...dates: readonly string[]) =>
	t.as(t.admin).act('leave_catalog_entry.create', [
		leaveCreate({
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', 'UNPAID_LEAVE')),
			days: wholeDays(...dates)
		})
	]);
const sealedBy = (t: Kit) =>
	t
		.storedQuery({
			leave_catalog_entry_day: { limit: 100 },
			adhoc_catalog_entry: { limit: 100 },
			roster_entry: { limit: 100 }
		})
		.pipe(
			Effect.map((got) => ({
				slots: got.leave_catalog_entry_day.rows.map((row) => row.payroll_run_id),
				adhoc: got.adhoc_catalog_entry.rows.map((row) => row.payroll_run_id),
				roster: got.roster_entry.rows.map((row) => row.payroll_run_id)
			}))
		);

describe('leave in an arrears window', () => {
	it.live('is deducted by the run whose attendance holds it, and sealed by that run', () => {
		const seed = seedOf(30_000, [{ from: '2025-01-01', to: null }]);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* unpaidLeave(t, seed, '2026-01-07');
			// the first half pays 1–15 January but attends 16–31 December: the 7th is not its own
			yield* run(t, '2026-01-1');
			assert.deepEqual((yield* sealedBy(t)).slots, [null, null]);
			assert.equal(lineOf(yield* slipOf(t, '2026-01-1'), 'BASIC'), 15_000);
			yield* run(t, '2026-01-2');
			const ids = yield* runIds(t);
			assert.deepEqual((yield* sealedBy(t)).slots, [ids.get('2026-01-2'), ids.get('2026-01-2')]);
			assert.ok(lineOf(yield* slipOf(t, '2026-01-2'), 'BASIC') < 15_000);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
	});
});

describe('a leaver', () => {
	it.live(
		'is paid everything up to the last day by the run covering it, and no later run seals it',
		() => {
			const seed = seedOf(
				30_000,
				[{ from: '2025-01-01', to: '2026-02-11' }],
				[{ date: '2026-02-09', shift: WORK, hours: 10, overtime: 2 }]
			);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* unpaidLeave(t, seed, '2026-02-05');
				yield* t.as(t.admin).act('adhoc_catalog_entry.create', [
					{
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: idOf('adhoc_catalog', catalogRow(seed, 'adhoc_catalog', 'BACKPAY_BASIC')),
						description: 'Last half',
						quantity: 1000,
						incurred_on: PlainDate('2026-02-11')
					}
				]);
				for (const period of ['2026-01-1', '2026-01-2', '2026-02-1', '2026-02-2'])
					yield* run(t, period);
				const last = yield* slipOf(t, '2026-02-1');
				assert.equal(lineOf(last, 'BACKPAY_BASIC'), 1000);
				assert.ok(lineOf(last, 'OVERTIME') > 0);
				assert.equal(yield* slipOf(t, '2026-02-2'), undefined);
				const paidBy = (yield* runIds(t)).get('2026-02-1');
				const sealed = yield* sealedBy(t);
				assert.deepEqual(sealed, { slots: [paidBy, paidBy], adhoc: [paidBy], roster: [paidBy] });
			}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })));
		}
	);
});

describe('a new contract version', () => {
	it.live('is not an exit: the half before it withholds, never refunds', () => {
		const seed = seedOf(60_000, [
			{ from: '2025-01-01', to: '2026-01-31' },
			{ from: '2026-02-01', to: null }
		]);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-01-1');
			yield* run(t, '2026-01-2');
			const wtax = (slip: PayslipBreakdown | undefined) =>
				slip?.statutory.find((row) => row.code === 'WTAX')?.employee ?? 0;
			assert.ok(wtax(yield* slipOf(t, '2026-01-1')) > 0);
			assert.ok(wtax(yield* slipOf(t, '2026-01-2')) > 0);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
	});
});

describe('a run after thirteen months of history', () => {
	const NOW = '2026-02-20T02:00:00.000Z';
	const PERIOD = '2026-02-1';
	const cycle = (key: string) => {
		const found = cycleOf(ARREARS, key);
		assert.ok(found !== undefined);
		return found;
	};
	// its window: the half before it attended, up to the end of the half it pays
	const WINDOW = { from: attendanceOf(ARREARS, cycle(PERIOD)).from, to: cycle(PERIOD).to };
	const rosterOf = (from: string, to: string) =>
		eachDay(datePeriod(from, to))
			.map(String)
			.map((date) =>
				[0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())
					? { date, shift: OFF, hours: 0 }
					: { date, shift: WORK, hours: 8 }
			);
	const open = { from: '2025-01-01', to: null };
	/** Every half from February 2025 to January 2026 has run and sealed the roster days it attended. */
	const history = (): Seed => {
		const seed = seedOf(30_000, [open], rosterOf('2025-01-16', WINDOW.to));
		const settings = String(seed.entity_profile_version?.[0]?.input_schema_version_id);
		const runs = Array.from({ length: 12 }, (_, month) =>
			String(addMonths('2025-02-01', month)).slice(0, 7)
		)
			.flatMap((month) => [`${month}-1`, `${month}-2`])
			.map((key, index) => ({
				row: {
					id: uuid(600 + index),
					run_number: index + 1,
					entity_id: ENTITY,
					period: key,
					kind: 'ON_CYCLE',
					settings_id: settings,
					salary_coverage: { from: cycle(key).from, to: cycle(key).to },
					pay_date: String(payDateOf(ARREARS, key)),
					state: 'PAID'
				},
				attends: attendanceOf(ARREARS, cycle(key))
			}));
		const sealer = (date: string) =>
			runs.find(({ attends }) => attends.from <= date && date <= attends.to)?.row.id ?? null;
		return {
			...seed,
			payroll_run: runs.map(({ row }) => row),
			roster_entry: (seed.roster_entry ?? []).map((row) => ({
				...row,
				payroll_run_id: sealer(String(row.work_date))
			})),
			leave_catalog_entry: [
				{
					id: uuid(900),
					entity_id: ENTITY,
					employment_id: uuid(6),
					catalog_id: catalogRow(seed, 'leave_catalog', 'UNPAID_LEAVE'),
					payroll_run_id: sealer('2025-06-10')
				}
			],
			leave_catalog_entry_day: (['AM', 'PM'] as const).map((part, index) => ({
				id: uuid(901 + index),
				leave_entry_id: uuid(900),
				incurred_on: '2025-06-10',
				part,
				payroll_run_id: sealer('2025-06-10')
			}))
		};
	};
	/** What the period's payslip pays, without the ids each workspace mints. */
	const figures = (t: Kit) =>
		t.storedQuery({ payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
			Effect.map((got) => {
				const ran = got.payroll_run.rows.find((row) => row.period === PERIOD);
				const slip = got.payslip.rows.find((row) => row.payroll_run_id === ran?.id);
				assert.ok(slip !== undefined);
				const { checkpoints, lines, statutory } = Schema.decodeUnknownSync(PayslipBreakdown)(
					slip.breakdown
				);
				return {
					net: slip.net_pay?.toNumber(),
					checkpoints: checkpoints.map(({ code, value }) => [code, value]),
					lines: lines.map(({ code, amount, direction, party }) => [
						code,
						amount,
						direction,
						party
					]),
					statutory
				};
			})
		);
	const paid = (seed: Seed) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* unpaidLeave(t, seed, '2026-01-20');
			yield* run(t, PERIOD);
			return yield* figures(t);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));

	it.live('reads only its window, and pays what a run with no history pays', () => {
		const seed = history();
		return Effect.gen(function* () {
			const read = yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* unpaidLeave(t, seed, '2026-01-20');
				const salary = cycle(PERIOD);
				return yield* loadRun(
					t.storedQuery,
					{
						entity_id: ENTITY,
						settings_id: String(seed.entity_profile_version?.[0]?.input_schema_version_id),
						salary_coverage: { from: salary.from, to: salary.to }
					},
					{ attendance: attendanceOf(ARREARS, salary) }
				);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
			const dates = (read.roster_entry ?? []).map((row) => String(row.work_date));
			assert.equal(dates.length, rosterOf(WINDOW.from, WINDOW.to).length);
			assert.ok(dates.every((date) => WINDOW.from <= date && date <= WINDOW.to));
			// the sealed June leave is history: only the window's own entry is read
			assert.deepEqual(
				(read.leave_catalog_entry ?? []).map((row) => row.id === uuid(900)),
				[false]
			);
			assert.deepEqual(
				yield* paid(seed),
				yield* paid(seedOf(30_000, [open], rosterOf(WINDOW.from, WINDOW.to)))
			);
		});
	});
});

describe('attendance a run has priced', () => {
	const NOW = '2026-02-20T02:00:00.000Z';
	const LOAN = uuid(950);
	const seed = seedOf(30_000, [{ from: '2025-01-01', to: null }]);
	const roster = (t: Kit, date: string) =>
		t.as(t.admin).act('roster_entry.create', [
			{
				employment_id: CONTRACT,
				work_date: PlainDate(date),
				shift_definition_id: idOf('shift_definition', WORK)
			}
		]);
	it.live('takes no roster day: what it missed is paid as arrears by the next run', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			// the first half of February attends 16–31 January
			yield* run(t, '2026-02-1');
			const refused = yield* Effect.flip(roster(t, '2026-01-20'));
			assert.match(
				String(refused),
				/2026-01-20 is in attendance a payroll run has already priced\. .*arrears adhoc entry/
			);
			// attendance no run has priced stays open
			yield* roster(t, '2026-02-03');
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('takes no instalment: it is dated in the next period to run', () => {
		const withLoan: Seed = {
			...seed,
			loan_catalog_entry: [
				{
					id: LOAN,
					entity_id: ENTITY,
					employment_id: uuid(6),
					catalog_id: catalogRow(seed, 'loan_catalog', 'LOAN_RECOVERY_COMPANY'),
					quantity: 1000,
					repayment_period: { from: '2026-01-01', to: '2026-06-30' }
				}
			]
		};
		const instalment = (t: Kit, date: string) =>
			t.as(t.admin).act('loan_catalog_entry_repayment.create', [
				{
					entity_id: ENTITY,
					employment_id: CONTRACT,
					loan_id: idOf('loan_catalog_entry', LOAN),
					amount: 100,
					paid_on: PlainDate(date)
				}
			]);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-02-1');
			const refused = yield* Effect.flip(instalment(t, '2026-01-20'));
			assert.match(String(refused), /2026-01-20 is in attendance .* Date the instalment/);
			yield* instalment(t, '2026-02-05');
			// the second half attends 1–15 February: it deducts the instalment
			yield* run(t, '2026-02-2');
			assert.equal(lineOf(yield* slipOf(t, '2026-02-2'), 'LOAN_RECOVERY_COMPANY'), 100);
		}).pipe(Effect.provide(workspace({ seed: withLoan, now: NOW })));
	});
});

describe('a claim entered after its run', () => {
	it.live('dated last month, on the contract before this one, is paid by the next run', () => {
		const seed = seedOf(30_000, [
			{ from: '2025-01-01', to: '2026-01-31' },
			{ from: '2026-02-01', to: null }
		]);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-01-2');
			yield* t.as(t.admin).act('claim_catalog_entry.create', [
				{
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_id: idOf('claim_catalog', catalogRow(seed, 'claim_catalog', 'MEDICAL_CLAIM')),
					quantity: 500,
					incurred_on: PlainDate('2026-01-10')
				}
			]);
			// the second half of February attends 1–15 February, where the January contract is not in force
			yield* run(t, '2026-02-2');
			assert.equal(lineOf(yield* slipOf(t, '2026-02-2'), 'MEDICAL_CLAIM'), 500);
			const paidBy = (yield* runIds(t)).get('2026-02-2');
			const { claim_catalog_entry } = yield* t.storedQuery({ claim_catalog_entry: { limit: 10 } });
			assert.deepEqual(
				claim_catalog_entry.rows.map((row) => row.payroll_run_id),
				[paidBy]
			);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })));
	});
});
