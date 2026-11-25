// Full-period 0-eligible-day unpaid leave across proration bases (CALENDAR_DAYS, DAY_RATE, WORKING_DAYS),
// arrears cutoffs (sealing post-cutoff slots, deferring prior-window tail slots on non-exit runs, keeping earned prior
// overtime payable), multi-month stretches, exits, and post-paid early-return / late-entry amendments.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import type { PayslipBreakdown } from '../../src/data/model/payroll_run/service/payslip_breakdown.ts';
import { idOf, objectValue } from '../../src/lib/reads.ts';
import { amendments, carriedFor, dates, ownLines, pay, run, slip } from '../amendment_kit.ts';
import {
	ENTITY,
	WORK,
	leaveCreate,
	pack,
	packTerms,
	storedQuery,
	syncAll,
	uuid,
	wholeDays,
	workspace
} from '../kit.ts';

const EMPLOYMENT = idOf('employment', uuid(6));
const SALARY = 3100;
const ALLOWANCE = 300;
type Seed = ReturnType<typeof pack>;

const weekdays = (month: string, exclude: readonly string[] = []) =>
	dates(month).filter(
		(date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) && !exclude.includes(date)
	);

const withCutoff = (base: Seed, pay_cutoff_day: number): Seed => ({
	...base,
	pay_group: (base.pay_group ?? []).map((row) => ({
		...row,
		payment_schedule: { ...objectValue(row.payment_schedule), pay_cutoff_day }
	}))
});

const fileLeave = (t: Kit, catalog_code: string, days: readonly string[]) =>
	t.as(t.admin).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: EMPLOYMENT,
						catalog_code,
						days: wholeDays(...days)
					})
				]
			})
		),
		Effect.andThen(t.run_due())
	);

const checkpoint = (breakdown: PayslipBreakdown, code: string) =>
	breakdown.checkpoints.find((row) => row.code === code)?.value ?? Number.NaN;

describe('full-period 0-eligible-day unpaid leave', () => {
	it.live(
		'clears 100% of basic pay and prorated allowances on CALENDAR_DAYS (with weekends and public holidays) and keeps partial months prorated by missed days',
		() => {
			const MAY_HOLIDAYS = ['2026-05-01', '2026-05-27'];
			const seed = pack(
				'MY',
				'Asia/Kuala_Lumpur',
				{ ...packTerms(SALARY, 'MANUAL_LABOUR'), allowances: { SUA: { amount: ALLOWANCE } } },
				{},
				[],
				MAY_HOLIDAYS.map((date) => ({ date, kind: 'PUBLIC_HOLIDAY' as const }))
			);
			const fullMay = weekdays('2026-05', MAY_HOLIDAYS);
			return Effect.gen(function* () {
				// Full-month NPL covering all 19 scheduled non-holiday weekdays of May 2026
				const full = yield* Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* fileLeave(t, 'NPL', fullMay);
					yield* run(t, '2026-05');
					return yield* slip(t, '2026-05');
				}).pipe(Effect.provide(workspace({ seed, now: '2026-05-25T02:00:00.000Z' })));
				assert.equal(checkpoint(full.breakdown, 'PAID_BASIC'), 0);
				assert.equal(
					full.breakdown.lines.find((line) => line.code === 'SUA'),
					undefined
				);
				assert.equal(full.net, 0);

				// Partial month: 18 NPL days + 1 paid ANNUAL_LEAVE day does NOT zero weekends
				const partial = yield* Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* syncAll(t);
					yield* fileLeave(t, 'NPL', fullMay.slice(0, -1));
					yield* fileLeave(t, 'ANNUAL_LEAVE', fullMay.slice(-1));
					yield* run(t, '2026-05');
					return yield* slip(t, '2026-05');
				}).pipe(Effect.provide(workspace({ seed, now: '2026-05-25T02:00:00.000Z' })));
				assert.ok(
					checkpoint(partial.breakdown, 'PAID_BASIC') > 0,
					`1 paid day keeps weekend pay: ${checkpoint(partial.breakdown, 'PAID_BASIC')}`
				);
				assert.ok((partial.breakdown.lines.find((line) => line.code === 'SUA')?.amount ?? 0) > 0);
			});
		}
	);

	it.live('clears 100% of basic pay on DAY_RATE (ID) and WORKING_DAYS (SG) jurisdictions too', () =>
		Effect.gen(function* () {
			const idSeed = pack(
				'ID',
				'Asia/Jakarta',
				packTerms(10_000_000),
				{ work_region: 'Provinsi Aceh/Kabupaten Aceh Barat' },
				[],
				[]
			);
			const idSlip = yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* fileLeave(t, 'NPL', weekdays('2026-04'));
				yield* run(t, '2026-04');
				return yield* slip(t, '2026-04');
			}).pipe(Effect.provide(workspace({ seed: idSeed, now: '2026-04-25T02:00:00.000Z' })));
			assert.equal(checkpoint(idSlip.breakdown, 'PAID_BASIC'), 0);

			const sgSeed = pack('SG', 'Asia/Singapore', packTerms(4000), {}, [], []);
			const sgSlip = yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* fileLeave(t, 'NPL', weekdays('2026-04'));
				yield* run(t, '2026-04');
				return yield* slip(t, '2026-04');
			}).pipe(Effect.provide(workspace({ seed: sgSeed, now: '2026-04-25T02:00:00.000Z' })));
			assert.equal(checkpoint(sgSlip.breakdown, 'PAID_BASIC'), 0);
		})
	);

	it.live(
		'with a 21st cutoff: seals 21–31 May to May, preserves earned Apr 21–30 overtime, and defers Apr 21–30 unpaid slots to June without double-deduction',
		() => {
			const MAY_HOLIDAYS = ['2026-05-01', '2026-05-27'];
			const seed = withCutoff(
				pack(
					'MY',
					'Asia/Kuala_Lumpur',
					packTerms(SALARY, 'MANUAL_LABOUR'),
					{},
					[{ date: '2026-04-22', shift: WORK, hours: 10, overtime: 2 }],
					MAY_HOLIDAYS.map((date) => ({ date, kind: 'PUBLIC_HOLIDAY' as const }))
				),
				21
			);
			const aprTail = weekdays('2026-04').filter((date) => date >= '2026-04-23');
			const fullMay = weekdays('2026-05', MAY_HOLIDAYS);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-04');
				// Apr 23–30 NPL + full May NPL
				yield* fileLeave(t, 'NPL', [...aprTail, ...fullMay]);
				const mayRun = yield* pay(t, '2026-05');
				const maySlip = yield* slip(t, '2026-05');
				// May basic is 0, but earned Apr 22 overtime is preserved and paid!
				assert.equal(checkpoint(maySlip.breakdown, 'PAID_BASIC'), 0);
				assert.ok(
					(maySlip.breakdown.lines.find((line) => line.code === 'OVERTIME')?.amount ?? 0) > 0,
					'prior-window earned OT must stay payable'
				);
				assert.ok(maySlip.net > 0);
				// May sealed 1–31 May and left Apr 23–30 unsealed for June
				const afterMay = (yield* storedQuery(t, { leave_catalog_entry_day: { limit: 200 } }))
					.leave_catalog_entry_day.rows;
				assert.ok(
					afterMay
						.filter((row) => row.incurred_on >= '2026-05-01')
						.every((row) => row.payroll_run_id === mayRun.id),
					'May must seal 1–31 May including post-cutoff slots'
				);
				assert.ok(
					afterMay
						.filter((row) => row.incurred_on < '2026-05-01')
						.every((row) => row.payroll_run_id === null),
					'non-exit full-unpaid May must defer Apr tail slots'
				);

				// June picks up deferred Apr 23–30 ONLY (never double-deducting May 21–31)
				const junRun = yield* pay(t, '2026-06');
				const junOwn = yield* ownLines(t, '2026-06');
				const aprDayRate = Number((SALARY / 30).toFixed(2));
				assert.equal(junOwn['NPL/EMPLOYEE'], -Number((aprTail.length * aprDayRate).toFixed(2)));
				const afterJun = (yield* storedQuery(t, { leave_catalog_entry_day: { limit: 200 } }))
					.leave_catalog_entry_day.rows;
				assert.ok(
					afterJun
						.filter((row) => row.incurred_on < '2026-05-01')
						.every((row) => row.payroll_run_id === junRun.id)
				);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-06-25T02:00:00.000Z' })));
		}
	);

	it.live(
		'defers prior-window unpaid slots across two consecutive full-unpaid months (Feb + Mar) into April',
		() => {
			const seed = withCutoff(
				pack('MY', 'Asia/Kuala_Lumpur', packTerms(SALARY, 'MANUAL_LABOUR'), {}, [], []),
				21
			);
			const janTail = weekdays('2026-01').filter((date) => date >= '2026-01-21');
			const fullFeb = weekdays('2026-02');
			const fullMar = weekdays('2026-03');
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-01');
				yield* fileLeave(t, 'NPL', [...janTail, ...fullFeb, ...fullMar]);
				yield* pay(t, '2026-02');
				yield* pay(t, '2026-03');
				assert.equal(checkpoint((yield* slip(t, '2026-02')).breakdown, 'PAID_BASIC'), 0);
				assert.equal(checkpoint((yield* slip(t, '2026-03')).breakdown, 'PAID_BASIC'), 0);
				// April picks up Jan 21–31 at Jan's ÷31 rate; Feb 21–28 and Mar 21–31 were already sealed
				yield* pay(t, '2026-04');
				const aprOwn = yield* ownLines(t, '2026-04');
				assert.equal(aprOwn['NPL/EMPLOYEE'], -Number((janTail.length * (SALARY / 31)).toFixed(2)));
			}).pipe(Effect.provide(workspace({ seed, now: '2026-04-25T02:00:00.000Z' })));
		}
	);

	it.live(
		'early return after a paid full-unpaid month amends May and releases 21–24 May slots to June',
		() => {
			const seed = withCutoff(
				pack('MY', 'Asia/Kuala_Lumpur', packTerms(SALARY, 'MANUAL_LABOUR'), {}, [], []),
				21
			);
			const fullMay = weekdays('2026-05');
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-04');
				yield* fileLeave(t, 'NPL', fullMay);
				yield* pay(t, '2026-05');
				assert.equal(checkpoint((yield* slip(t, '2026-05')).breakdown, 'PAID_BASIC'), 0);

				// Delete 25–29 May slots (employee returned early): May is no longer full-unpaid
				const { leave_catalog_entry, leave_catalog_entry_day } = yield* storedQuery(t, {
					leave_catalog_entry: { limit: 1 },
					leave_catalog_entry_day: { limit: 200 }
				});
				const entry = leave_catalog_entry.rows[0];
				assert.ok(entry !== undefined);
				const toDelete = leave_catalog_entry_day.rows.filter(
					(row) => row.incurred_on >= '2026-05-25'
				);
				yield* (yield* t.as(t.admin)).act({
					'leave_catalog_entry.update': [
						{
							target: entry,
							set: {
								leave_catalog_entry_day: {
									delete: toDelete.map(({ id, revision }) => ({ id, revision }))
								}
							}
						}
					]
				});
				yield* t.run_due();
				assert.deepEqual(
					(yield* amendments(t)).map((row) => row.period),
					['2026-05']
				);

				// June carries May's refund (May now only deducts 1–20 May) AND deducts released 21–22 May in June
				const junRun = yield* pay(t, '2026-06');
				const mayCarried = yield* carriedFor(t, '2026-06', '2026-05');
				assert.ok((mayCarried['NPL/EMPLOYEE'] ?? 0) > 0, 'May gives back excess NPL');
				const junOwn = yield* ownLines(t, '2026-06');
				const releasedDays = fullMay.filter((d) => d >= '2026-05-21' && d < '2026-05-25');
				assert.equal(
					junOwn['NPL/EMPLOYEE'],
					-Number((releasedDays.length * (SALARY / 31)).toFixed(2))
				);
				const slotsAfter = (yield* storedQuery(t, { leave_catalog_entry_day: { limit: 200 } }))
					.leave_catalog_entry_day.rows;
				assert.ok(
					slotsAfter
						.filter((row) => row.incurred_on >= '2026-05-21')
						.every((row) => row.payroll_run_id === junRun.id)
				);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-06-25T02:00:00.000Z' })));
		}
	);

	it.live(
		'late entry of 21–31 May NPL after May is paid turns May full-unpaid, seals 21–31 May to May, and releases Apr tail to June',
		() => {
			const seed = withCutoff(
				pack('MY', 'Asia/Kuala_Lumpur', packTerms(SALARY, 'MANUAL_LABOUR'), {}, [], []),
				21
			);
			const aprTail = weekdays('2026-04').filter((date) => date >= '2026-04-21');
			const mayFirst = weekdays('2026-05').filter((date) => date <= '2026-05-20');
			const mayTail = weekdays('2026-05').filter((date) => date >= '2026-05-21');
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-04');
				yield* fileLeave(t, 'NPL', [...aprTail, ...mayFirst]);
				yield* pay(t, '2026-05');
				// Originally May was partial (deducted Apr 21–30 + May 1–20)
				assert.ok(checkpoint((yield* slip(t, '2026-05')).breakdown, 'PAID_BASIC') > 0);

				// Late entry of May 21–31 NPL after May is paid
				yield* fileLeave(t, 'NPL', mayTail);
				assert.deepEqual(
					(yield* amendments(t))
						.filter((row) => row.payroll_run_id === null)
						.map((row) => row.period),
					['2026-05']
				);

				// June recalculates May to PAID_BASIC = 0 (carrying remaining May NPL) and takes released Apr 21–30 in June
				yield* pay(t, '2026-06');
				const junOwn = yield* ownLines(t, '2026-06');
				const aprDayRate = Number((SALARY / 30).toFixed(2));
				assert.equal(junOwn['NPL/EMPLOYEE'], -Number((aprTail.length * aprDayRate).toFixed(2)));
				// Net total NPL across May own + Jun carried(May) + Jun own = full May (3100) + Apr tail!
				const mayOwn = yield* ownLines(t, '2026-05');
				const mayCarried = yield* carriedFor(t, '2026-06', '2026-05');
				const totalMayNpl = Number(
					((mayOwn['NPL/EMPLOYEE'] ?? 0) + (mayCarried['NPL/EMPLOYEE'] ?? 0)).toFixed(2)
				);
				assert.equal(totalMayNpl, -SALARY);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-06-25T02:00:00.000Z' })));
		}
	);

	it.live(
		'exit run on a full-unpaid month seals prior-window tail and post-cutoff slots cleanly so nothing stays unsealed after exit',
		() => {
			const base = withCutoff(
				pack('MY', 'Asia/Kuala_Lumpur', packTerms(SALARY, 'MANUAL_LABOUR'), {}, [], []),
				21
			);
			const seed: Seed = {
				...base,
				employment: (base.employment ?? []).map((row) => ({
					...row,
					effective_range: { from: '2025-01-01', to: '2026-05-31' }
				}))
			};
			const aprTail = weekdays('2026-04').filter((date) => date >= '2026-04-21');
			const fullMay = weekdays('2026-05');
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-04');
				yield* fileLeave(t, 'NPL', [...aprTail, ...fullMay]);
				const mayRun = yield* pay(t, '2026-05');
				assert.equal(checkpoint((yield* slip(t, '2026-05')).breakdown, 'PAID_BASIC'), 0);
				const slots = (yield* storedQuery(t, { leave_catalog_entry_day: { limit: 200 } }))
					.leave_catalog_entry_day.rows;
				assert.ok(
					slots.every((row) => row.payroll_run_id === mayRun.id),
					'exit run must seal both prior-window tail and current-month unpaid slots'
				);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-06-05T02:00:00.000Z' })));
		}
	);
});
