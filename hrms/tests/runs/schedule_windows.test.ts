// What a run prices and seals when its pay group's schedule attends in arrears or splits the month, as an HR controller
// runs it: every entry is priced once, by the run whose window holds it, sealed by that run, and never by a run without its
// person's payslip. The schedule is the pay group's; the law pack is only the fixture.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { DateTime, Duration, Effect, Schema } from 'effect';
import { attendanceOf, cycleOf, payDateOf } from '../../src/lib/payroll_engine/pay_cycle.ts';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { loadRun } from '../../src/lib/payroll_engine/run_calculation.ts';
import {
	EMPLOYMENT,
	ENTITY,
	OFF,
	PAY_GROUP,
	WORK,
	leaveCreate,
	pack,
	uuid,
	wholeDays,
	workspace,
	storedQuery,
	storedReader,
	decimalNumber,
	packTerms
} from '../kit.ts';

const STINT = idOf('employment', EMPLOYMENT);
type Seed = ReturnType<typeof pack>;
// A twice-monthly schedule: two halves a month, each attending the half before it
const ARREARS = {
	frequency: 'SEMI_MONTHLY',
	business_day: 'PREVIOUS',
	non_working_weekdays: [0, 6],
	short_month: 'LAST_DAY',
	pay_days: [15, 31],
	pay_cutoff_day: 16
};
/** One person's stint over these days; `changes` are the firsts of months its terms are agreed again from. */
const seedOf = (
	amount: number,
	effective_range: { readonly from: string; readonly to: string | null },
	days: Parameters<typeof pack>[4] = [],
	changes: readonly string[] = []
): Seed => {
	const seed = pack('MY', 'Asia/Kuala_Lumpur', packTerms(amount, 'MANUAL_LABOUR'), {}, days, []);
	return {
		...seed,
		pay_group: (seed.pay_group ?? []).map((row) => ({ ...row, payment_schedule: ARREARS })),
		employment: (seed.employment ?? []).map((row) => ({ ...row, effective_range })),
		contract_terms: [
			...(seed.contract_terms ?? []),
			...changes.map((effective_from, index) => ({
				id: uuid(7 + index),
				employment_id: EMPLOYMENT,
				effective_from,
				rate: { amount, unit: 'MONTHLY' }
			}))
		]
	};
};
const run = (t: Kit, period: string) =>
	t
		.as(t.member(['hr_controller']))
		.pipe(
			Effect.andThen((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
			)
		)
		.pipe(Effect.andThen(t.run_due()));
const runIds = (t: Kit) =>
	storedQuery(t, { payroll_run: { limit: 100 } }).pipe(
		Effect.map(
			(got) => new Map(got.payroll_run.rows.map((row) => [row.period, String(row.id)] as const))
		)
	);
/** A period's run, as stored. */
const runOf = (t: Kit, period: string) =>
	storedQuery(t, { payroll_run: { where: { period: { eq: period } }, limit: 1 } }).pipe(
		Effect.map((got) => got.payroll_run.rows[0])
	);
/** The one payslip of a period's run, as lines and statutory rows; undefined when the run paid nobody. */
const slipOf = (t: Kit, period: string) =>
	storedQuery(t, { payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
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
const unpaidLeave = (t: Kit, ...dates: readonly string[]) =>
	t.as(t.admin).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: STINT,
						catalog_code: 'NPL',
						days: wholeDays(...dates)
					})
				]
			})
		)
	);
const sealedBy = (t: Kit) =>
	storedQuery(t, {
		leave_catalog_entry_day: { limit: 100 },
		adhoc_catalog_entry: { limit: 100 },
		roster_entry: { limit: 100 }
	}).pipe(
		Effect.map((got) => ({
			slots: got.leave_catalog_entry_day.rows.map((row) => row.payroll_run_id),
			adhoc: got.adhoc_catalog_entry.rows.map((row) => row.payroll_run_id),
			roster: got.roster_entry.rows.map((row) => row.payroll_run_id)
		}))
	);

describe('leave in an arrears window', () => {
	it.live('is deducted by the run whose attendance holds it, and sealed by that run', () => {
		const seed = seedOf(30_000, { from: '2025-01-01', to: null });
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* unpaidLeave(t, '2026-01-07');
			// the first half pays 1–15 January but attends 16–31 December: the 7th is not its own
			yield* run(t, '2026-01-1');
			assert.deepEqual((yield* sealedBy(t)).slots, [null, null]);
			assert.equal(lineOf(yield* slipOf(t, '2026-01-1'), 'NPL'), 0);
			yield* run(t, '2026-01-2');
			const ids = yield* runIds(t);
			assert.deepEqual((yield* sealedBy(t)).slots, [ids.get('2026-01-2'), ids.get('2026-01-2')]);
			assert.ok(lineOf(yield* slipOf(t, '2026-01-2'), 'NPL') > 0);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
	});
});

describe('a leaver', () => {
	it.live(
		'is paid everything up to the last day by the run covering it, and no later run seals it',
		() => {
			const seed = seedOf(30_000, { from: '2025-01-01', to: '2026-02-11' }, [
				{ date: '2026-02-09', shift: WORK, hours: 10, overtime: 2 }
			]);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* unpaidLeave(t, '2026-02-05');
				yield* t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'adhoc_catalog_entry.create': [
								{
									entity_id: ENTITY,
									employment_id: STINT,
									catalog_code: 'BPAYBS',
									description: 'Last half',
									quantity: '1000',
									incurred_on: '2026-02-11'
								}
							]
						})
					)
				);
				for (const period of ['2026-01-1', '2026-01-2', '2026-02-1', '2026-02-2'])
					yield* run(t, period);
				const last = yield* slipOf(t, '2026-02-1');
				assert.equal(lineOf(last, 'BPAYBS'), 1000);
				assert.ok(lineOf(last, 'OVERTIME') > 0);
				assert.equal(yield* slipOf(t, '2026-02-2'), undefined);
				const paidBy = (yield* runIds(t)).get('2026-02-1');
				const sealed = yield* sealedBy(t);
				assert.deepEqual(sealed, { slots: [paidBy, paidBy], adhoc: [paidBy], roster: [paidBy] });
			}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })));
		}
	);
});

describe('a change of terms', () => {
	it.live('is not an exit: the half before it withholds, never refunds', () => {
		const seed = seedOf(60_000, { from: '2025-01-01', to: null }, [], ['2026-02-01']);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-01-1');
			yield* run(t, '2026-01-2');
			const wtax = (slip: PayslipBreakdown | undefined) =>
				slip?.statutory.find((row) => row.code === 'PCB')?.employee ?? 0;
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
		Array.from(
			{
				length:
					Duration.toDays(DateTime.distance(DateTime.makeUnsafe(from), DateTime.makeUnsafe(to))) + 1
			},
			(_, i) => DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(from), { days: i }))
		)
			.map(String)
			.map((date) =>
				[0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())
					? { date, shift: OFF, hours: 0 }
					: { date, shift: WORK, hours: 8 }
			);
	const open = { from: '2025-01-01', to: null };
	/** Every half from February 2025 to January 2026 has run and sealed the roster days it attended. */
	const history = (): Seed => {
		const seed = seedOf(30_000, open, rosterOf('2025-01-16', WINDOW.to));
		const runs = Array.from({ length: 12 }, (_, month) =>
			DateTime.formatIsoDate(
				DateTime.add(DateTime.makeUnsafe('2025-02-01'), { months: month })
			).slice(0, 7)
		)
			.flatMap((month) => [`${month}-1`, `${month}-2`])
			.map((key, index) => ({
				row: {
					id: uuid(600 + index),
					run_number: index + 1,
					entity_id: ENTITY,
					pay_group_id: PAY_GROUP,
					period: key,
					kind: 'ON_CYCLE',
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
					catalog_code: 'NPL',
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
		storedQuery(t, { payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
			Effect.map((got) => {
				const ran = got.payroll_run.rows.find((row) => row.period === PERIOD);
				const slip = got.payslip.rows.find((row) => row.payroll_run_id === ran?.id);
				assert.ok(slip !== undefined);
				const { checkpoints, lines, statutory } = Schema.decodeUnknownSync(PayslipBreakdown)(
					slip.breakdown
				);
				return {
					net: decimalNumber(slip.net_pay),
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
			yield* unpaidLeave(t, '2026-01-20');
			yield* run(t, PERIOD);
			return yield* figures(t);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));

	it.live('reads only its window, and pays what a run with no history pays', () => {
		const seed = history();
		return Effect.gen(function* () {
			const read = yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* unpaidLeave(t, '2026-01-20');
				const salary = cycle(PERIOD);
				return yield* loadRun(
					storedReader(t),
					{
						entity_id: ENTITY,
						pay_group_id: PAY_GROUP,
						salary_coverage: { from: salary.from, to: salary.to }
					},
					{ attendance: attendanceOf(ARREARS, salary) },
					'MY'
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
				yield* paid(seedOf(30_000, open, rosterOf(WINDOW.from, WINDOW.to)))
			);
		});
	});
});

describe('attendance a run has priced', () => {
	const NOW = '2026-02-20T02:00:00.000Z';
	const LOAN = uuid(950);
	const HELD = /Run 1 holds this person and is not paid yet/;
	const seed = seedOf(30_000, { from: '2025-01-01', to: null });
	const pay = (t: Kit, period: string) =>
		Effect.gen(function* () {
			const ran = yield* runOf(t, period);
			assert.ok(ran !== undefined, `${period} did not run`);
			yield* t
				.as(t.admin)
				.pipe(
					Effect.andThen((caller) =>
						caller.act({ 'payroll_run.update': [{ target: ran, set: { state: 'PAID' } }] })
					)
				);
			yield* t.run_due();
		});
	const amendments = (t: Kit) =>
		storedQuery(t, { pay_amendment: { limit: 100 } }).pipe(
			Effect.map(({ pay_amendment }) =>
				pay_amendment.rows.map((row) => [row.period, row.payroll_run_id])
			)
		);
	const roster = (t: Kit, date: string) =>
		t.as(t.admin).pipe(
			Effect.andThen((caller) =>
				caller.act({
					'roster_entry.create': [
						{
							employment_id: STINT,
							work_date: date,
							shift_definition_id: idOf('shift_definition', WORK)
						}
					]
				})
			)
		);
	it.live(
		'a roster day is refused while the run is unpaid, and amends the period once it is paid',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				// the first half of February attends 16–31 January
				yield* run(t, '2026-02-1');
				assert.match(String(yield* Effect.flip(roster(t, '2026-01-20'))), HELD);
				// days after what the run priced stay open
				yield* roster(t, '2026-02-17');
				assert.deepEqual(yield* amendments(t), []);
				yield* pay(t, '2026-02-1');
				yield* roster(t, '2026-01-20');
				assert.deepEqual(yield* amendments(t), [['2026-02-1', null]]);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live(
		'an instalment is refused while the run is unpaid; once it is paid the next run carries it',
		() => {
			const withLoan: Seed = {
				...seed,
				loan_catalog_entry: [
					{
						id: LOAN,
						entity_id: ENTITY,
						employment_id: uuid(6),
						catalog_code: 'LOAN_RECOVERY_FESTIVE_ADVANCE',
						quantity: 1000,
						repayment_period: { from: '2026-01-01', to: '2026-06-30' }
					}
				]
			};
			const instalment = (t: Kit, date: string) =>
				t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'loan_catalog_entry_repayment.create': [
								{
									entity_id: ENTITY,
									employment_id: STINT,
									loan_id: idOf('loan_catalog_entry', LOAN),
									amount: '100',
									paid_on: date
								}
							]
						})
					)
				);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t, '2026-02-1');
				assert.match(String(yield* Effect.flip(instalment(t, '2026-01-20'))), HELD);
				yield* pay(t, '2026-02-1');
				yield* instalment(t, '2026-01-20');
				assert.deepEqual(yield* amendments(t), [['2026-02-1', null]]);
				// the second half deducts it for the half that held its date
				yield* run(t, '2026-02-2');
				assert.deepEqual(
					(yield* slipOf(t, '2026-02-2'))?.lines
						.filter((line) => line.code === 'LOAN_RECOVERY_FESTIVE_ADVANCE')
						.map((line) => [line.period, line.direction, line.amount]),
					[['2026-02-1', 'DEDUCT', 100]]
				);
				assert.deepEqual(yield* amendments(t), [
					['2026-02-1', (yield* runIds(t)).get('2026-02-2')]
				]);
			}).pipe(Effect.provide(workspace({ seed: withLoan, now: NOW })));
		}
	);
});

describe('a claim entered after its run', () => {
	it.live(
		'dated last month, before the terms changed, is carried by the next run for its own period',
		() => {
			const seed = seedOf(30_000, { from: '2025-01-01', to: null }, [], ['2026-02-01']);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t, '2026-01-2');
				const january = yield* runOf(t, '2026-01-2');
				assert.ok(january !== undefined);
				yield* t
					.as(t.admin)
					.pipe(
						Effect.andThen((caller) =>
							caller.act({ 'payroll_run.update': [{ target: january, set: { state: 'PAID' } }] })
						)
					);
				yield* t.run_due();
				yield* t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'claim_catalog_entry.create': [
								{
									entity_id: ENTITY,
									employment_id: STINT,
									catalog_code: 'MEDICAL_CLAIM',
									quantity: '500',
									incurred_on: '2026-01-10'
								}
							]
						})
					)
				);
				// the second half of February attends 1–15 February, under the terms agreed from February
				yield* run(t, '2026-02-2');
				assert.deepEqual(
					(yield* slipOf(t, '2026-02-2'))?.lines
						.filter((line) => line.code === 'MEDICAL_CLAIM')
						.map((line) => [line.period, line.amount]),
					[['2026-01-2', 500]]
				);
				const paidBy = (yield* runIds(t)).get('2026-02-2');
				const { claim_catalog_entry } = yield* storedQuery(t, {
					claim_catalog_entry: { limit: 10 }
				});
				assert.deepEqual(
					claim_catalog_entry.rows.map((row) => row.payroll_run_id),
					[paidBy]
				);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })));
		}
	);
});

describe('a ten-day schedule with a cutoff', () => {
	// a run prices [previous cutoff, current cutoff − 1]: a no-pay day keyed in that window after the part is paid leaves
	// that part to be worked out again, even when the day's calendar part is another
	const tenDay = (cutoff: number): Seed => {
		const seed = seedOf(30_000, { from: '2025-01-01', to: null });
		return {
			...seed,
			pay_group: (seed.pay_group ?? []).map((row) => ({
				...row,
				payment_schedule: {
					frequency: 'TEN_DAY',
					business_day: 'PREVIOUS',
					non_working_weekdays: [0, 6],
					short_month: 'LAST_DAY',
					pay_days: [10, 20, 31],
					pay_cutoff_day: cutoff
				}
			}))
		};
	};
	for (const [cutoff, day] of [
		[1, '2026-02-03'],
		[25, '2026-02-12']
	] as const)
		it.live(
			`cutoff ${cutoff}: a no-pay day in the attendance the first part paid leaves that part to be worked out again`,
			() => {
				const seed = tenDay(cutoff);
				return Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* run(t, '2026-02-1');
					const first = yield* runOf(t, '2026-02-1');
					assert.ok(first !== undefined);
					yield* t
						.as(t.admin)
						.pipe(
							Effect.andThen((caller) =>
								caller.act({ 'payroll_run.update': [{ target: first, set: { state: 'PAID' } }] })
							)
						);
					yield* t.run_due();
					yield* unpaidLeave(t, day);
					const { pay_amendment } = yield* storedQuery(t, { pay_amendment: { limit: 10 } });
					assert.deepEqual(
						pay_amendment.rows.map((row) => [row.period, row.payroll_run_id ?? null]),
						[['2026-02-1', null]]
					);
				}).pipe(Effect.provide(workspace({ seed, now: '2026-02-15T02:00:00.000Z' })));
			}
		);
});
