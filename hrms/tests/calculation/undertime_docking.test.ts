// Per-employee profile undertime minute-docking switch (`employee_profile.dock_undertime`, default false):
// proportional minute rate floored to currency minor unit at PAID_BASIC, half-day leave split across midday break,
// and automatic paid-period amendment + refund on toggle.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/reads.ts';
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
	workspace
} from '../kit.ts';

const EMPLOYMENT = idOf('employment', uuid(6));
const SALARY = 3100; // Jan 2026: 31 days → RM 100.00/day; 8h = 480 min → RM 0.208333.../min
type Seed = ReturnType<typeof pack>;

const BREAK_SHIFT = uuid(31);
const withBreakShift = (
	base: Seed,
	dock_undertime: boolean,
	rosters: Seed['roster_entry']
): Seed => ({
	...base,
	employee_profile: (base.employee_profile ?? []).map((row) => ({ ...row, dock_undertime })),
	shift_definition: [
		...(base.shift_definition ?? []),
		{
			id: BREAK_SHIFT,
			entity_id: ENTITY,
			code: 'MORN_BRK',
			name: 'Morning with break',
			effective_range: { from: '2025-01-01', to: null },
			variant: {
				day_type: 'WORK',
				start_time: '08:30',
				end_time: '17:30',
				ends_next_day: false,
				// 08:30–12:30 (240m) + 13:30–17:30 (240m) = 480m (8h)
				breaks: [{ start_time: '12:30', end_time: '13:30', paid: false }]
			}
		}
	],
	roster_entry: rosters
});

// Asia/Kuala_Lumpur is UTC+8: 08:30 MYT = 00:30Z, 12:30 MYT = 04:30Z, 13:30 MYT = 05:30Z, 17:30 MYT = 09:30Z
const rosterRow = (
	idNum: number,
	date: string,
	startUtc: string,
	endUtc: string,
	shift = BREAK_SHIFT
) => ({
	id: uuid(idNum),
	employment_id: uuid(6),
	work_date: date,
	shift_definition_id: shift,
	actual_worked_intervals: [{ start: `${date}T${startUtc}.000Z`, end: `${date}T${endUtc}.000Z` }],
	planned_overtime_intervals: null,
	findings: []
});

const toggleDockUndertime = (t: Kit, dock_undertime: boolean) =>
	Effect.gen(function* () {
		const [profile] = (yield* storedQuery(t, { employee_profile: { limit: 1 } })).employee_profile
			.rows;
		assert.ok(profile !== undefined);
		yield* (yield* t.as(t.admin)).act({
			'employee_profile.update': [{ target: profile, set: { dock_undertime } }]
		});
		yield* t.run_due();
	});

describe('employee_profile.dock_undertime', () => {
	it.live(
		'off by default (zero deduction); on docks exact unworked shift minutes floored to minor unit at PAID_BASIC, including half-day leave split across midday break',
		() => {
			const special = new Map([
				// 2026-01-05: full shift 08:30–17:30, arrived 20m late (08:50 = 00:50Z) and left 15m early (17:15 = 09:15Z) → 35m undertime
				['2026-01-05', ['00:50:00', '09:15:00'] as const],
				// 2026-01-06: PM half-day leave → expected 08:30–12:30; worked 08:25–12:35 → 0m undertime
				['2026-01-06', ['00:25:00', '04:35:00'] as const],
				// 2026-01-07: PM half-day leave → expected 08:30–12:30; left 10m early at 12:20 (04:20Z) → 10m undertime
				['2026-01-07', ['00:30:00', '04:20:00'] as const],
				// 2026-01-08: AM half-day leave → expected 13:30–17:30; arrived 5m late at 13:35 (05:35Z) → 5m undertime
				['2026-01-08', ['05:35:00', '09:30:00'] as const]
			]);
			const rosters = dates('2026-01')
				.filter((date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()))
				.map((date, index) => {
					const [startUtc, endUtc] = special.get(date) ?? ['00:30:00', '09:30:00'];
					return rosterRow(101 + index, date, startUtc, endUtc);
				});
			const makeSeed = (dock: boolean) =>
				withBreakShift(
					pack('MY', 'Asia/Kuala_Lumpur', packTerms(SALARY, 'MANUAL_LABOUR'), {}, [], []),
					dock,
					rosters
				);
			const seedLeaves = (t: Kit) =>
				syncAll(t).pipe(
					Effect.andThen(t.as(t.admin)),
					Effect.andThen((caller) =>
						caller.act({
							'leave_catalog_entry.create': [
								leaveCreate({
									entity_id: ENTITY,
									employment_id: EMPLOYMENT,
									catalog_code: 'ANNUAL_LEAVE',
									days: [
										{ date: '2026-01-06', part: 'PM' },
										{ date: '2026-01-07', part: 'PM' },
										{ date: '2026-01-08', part: 'AM' }
									]
								})
							]
						})
					),
					Effect.andThen(t.run_due())
				);
			return Effect.gen(function* () {
				// Default OFF: zero UNDERTIME deduction
				const off = yield* Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* seedLeaves(t);
					yield* run(t, '2026-01');
					return yield* ownLines(t, '2026-01');
				}).pipe(
					Effect.provide(workspace({ seed: makeSeed(false), now: '2026-01-25T02:00:00.000Z' }))
				);
				assert.equal(off['UNDERTIME/EMPLOYEE'], undefined);

				// ON: total 35 + 0 + 10 + 5 = 50 minutes.
				// Exact proportional amount: (3100 / 31) / 480 * 50 = 100 / 480 * 50 = 10.416666... → floored to 10.41 (NOT 10.42!)
				const onSlip = yield* Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* seedLeaves(t);
					yield* run(t, '2026-01');
					return yield* slip(t, '2026-01');
				}).pipe(
					Effect.provide(workspace({ seed: makeSeed(true), now: '2026-01-25T02:00:00.000Z' }))
				);
				const utLine = onSlip.breakdown.lines.find((line) => line.code === 'UNDERTIME');
				assert.ok(utLine !== undefined);
				assert.equal(utLine.direction, 'DEDUCT');
				assert.equal(utLine.subtotal, 'PAID_BASIC');
				assert.equal(utLine.source, 'roster_entry');
				assert.equal(utLine.amount, 10.41);
				assert.equal(utLine.unit, 'HOUR');
				assert.equal(utLine.quantity, Number((50 / 60).toFixed(4)));
				assert.equal(
					onSlip.breakdown.checkpoints.find((c) => c.code === 'PAID_BASIC')?.value,
					Number((SALARY - 10.41).toFixed(2))
				);
			});
		}
	);

	it.live(
		'toggling dock_undertime ON after a paid period automatically amends that period on the next payslip, and toggling OFF refunds it cleanly',
		() => {
			// WORK shift is 08:00–16:00 MYT (00:00Z–08:00Z = 480m).
			// Jan 05: arrived 30m late (00:30Z–08:00Z) → 30m undertime → floor((3100/31)/480 * 30) = floor(6.25) = 6.25
			// Feb 05: arrived 28m late (00:28Z–08:00Z) → 28m undertime → floor((3100/28)/480 * 28) = floor(6.45833) = 6.45
			const base = pack('MY', 'Asia/Kuala_Lumpur', packTerms(SALARY, 'MANUAL_LABOUR'), {}, [], []);
			const seed: Seed = {
				...base,
				roster_entry: [
					rosterRow(110, '2026-01-05', '00:30:00', '08:00:00', WORK),
					rosterRow(111, '2026-02-05', '00:28:00', '08:00:00', WORK)
				]
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				// Pay Jan with dock_undertime = false (default)
				yield* pay(t, '2026-01');
				assert.equal((yield* ownLines(t, '2026-01'))['UNDERTIME/EMPLOYEE'], undefined);

				// Turn ON dock_undertime → amends 2026-01 automatically
				yield* toggleDockUndertime(t, true);
				assert.deepEqual(
					(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
					[['2026-01', null]]
				);

				// Pay Feb → carries -6.25 for Jan AND docks -6.45 for Feb
				yield* pay(t, '2026-02');
				assert.equal((yield* carriedFor(t, '2026-02', '2026-01'))['UNDERTIME/EMPLOYEE'], -6.25);
				assert.equal((yield* ownLines(t, '2026-02'))['UNDERTIME/EMPLOYEE'], -6.45);

				// Turn OFF dock_undertime → amends 2026-01 and 2026-02; Mar refunds both cleanly
				yield* toggleDockUndertime(t, false);
				yield* pay(t, '2026-03');
				assert.equal((yield* carriedFor(t, '2026-03', '2026-01'))['UNDERTIME/EMPLOYEE'], 6.25);
				assert.equal((yield* carriedFor(t, '2026-03', '2026-02'))['UNDERTIME/EMPLOYEE'], 6.45);
				assert.equal((yield* ownLines(t, '2026-03'))['UNDERTIME/EMPLOYEE'], undefined);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-03-25T02:00:00.000Z' })));
		}
	);
});
