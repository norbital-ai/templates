/**
 * The payroll engine composes each payslip from the configured records alone: the synthetic `XX` version's work lines,
 * schemes and the attendance terms it states (`jurisdiction_kit.ts`). Every figure below follows from those records:
 * BASIC pays covered working days over the month's; FUND charges its wage's band (3,000 and below 5 %, above 10 %);
 * WHT withholds 10 % from 2,000; PIT is a monthly ladder (0 % to 1,000, 10 % to 5,000, 20 % above).
 */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { fixtureId, nativeId } from './fixture_values.ts';
import { COMPANY, WORK, employer, employment, runOf, world } from './jurisdiction_kit.ts';

const MARCH = { company_id: COMPANY, period: '2026-03', kind: 'REGULAR' } as const;

it.effect(
	'a slip is its configured lines and schemes: prorated, banded at the seam, withheld from a minimum, laddered monthly',
	() =>
		world(
			employer([
				{ key: 'a', salary: 3000 },
				{ key: 'b', salary: 3000.01 },
				// March 2026 has 22 working days; from Monday the 16th it has 12
				{ key: 'c', salary: 2200, from: '2026-03-16' },
				{ key: 'd', salary: 6000 }
			])
		).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				assert.equal((yield* hr.act('payroll_run.create', MARCH)).kind, 'committed');
				const run = yield* runOf(hr, '2026-03');
				assert.equal(run.count, 4, String(run.warnings));
				const a = run.slip('a');
				assert.deepEqual(a.lines, { BASIC: 3000 });
				assert.deepEqual(a.statutory, { FUND: 150, WHT: 300, PIT: 200 });
				assert.equal(a.gross, 3000);
				assert.equal(a.net, 2350);
				// a cent past the band's ceiling charges the next band's rate on the whole wage
				const b = run.slip('b');
				assert.deepEqual(b.statutory, { FUND: 300, WHT: 300, PIT: 200 });
				assert.equal(b.net, 2200.01);
				// the joiner: 12 of 22 working days, below the withholding minimum
				const c = run.slip('c');
				assert.deepEqual(c.lines, { BASIC: 1200 });
				assert.equal(c.quantities['BASIC'], 0.545455);
				assert.deepEqual(c.statutory, { FUND: 60, WHT: 0, PIT: 20 });
				assert.equal(c.net, 1120);
				// the ladder runs over the month's wage: 6,000 a month is 600, not a twelfth of 72,000's 13,800
				const d = run.slip('d');
				assert.deepEqual(d.statutory, { FUND: 600, WHT: 600, PIT: 600 });
				assert.equal(d.net, 4200);
			})
		),
	60_000
);

it.effect(
	'overtime is the clock past the planned shift, up to its approval, in completed half-hours',
	() => {
		const rows = employer([{ key: 'a', salary: 3000 }]);
		const day = (date: string, approved: number, end: string) => ({
			id: nativeId('roster_entry', fixtureId(`xx-ot-${date}`)),
			employment_id: employment('a'),
			work_date: PlainDate(date),
			shift_definition_id: WORK,
			planned_overtime_hours: approved,
			worked_intervals: [
				{ start: Instant(`${date}T09:00:00.000Z`), end: Instant(`${date}T${end}:00.000Z`) }
			]
		});
		rows.set('roster_entry', [
			// 2h10m past 18:00 under a 3-hour approval: two completed half-hour steps' worth, 2.0
			day('2026-03-03', 3, '20:10'),
			// 3 hours past 18:00 under a 1-hour approval: 1.0
			day('2026-03-04', 1, '21:00')
		]);
		return world(rows).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				yield* hr.act('payroll_run.create', MARCH);
				const run = yield* runOf(hr, '2026-03');
				const a = run.slip('a');
				assert.equal(a.quantities['OVERTIME'], 3);
				assert.equal(a.lines['OVERTIME'], 45);
				assert.equal(a.lines['BASIC'], 3000);
				// the run settles the attended days it paid
				assert.equal(run.pins.filter((pin) => pin.collection === 'roster_entry').length, 2);
			})
		);
	},
	60_000
);

it.effect(
	'a published holiday is paid as one; retracted, the day is ordinary again',
	() => {
		const rows = employer([{ key: 'a', salary: 3000 }]);
		const holiday = nativeId('holiday', fixtureId('xx-founders-day'));
		rows.set('holiday', [
			{
				id: holiday,
				company_id: COMPANY,
				date: PlainDate('2026-03-25'),
				name: 'Founders Day',
				kind: 'PUBLIC_HOLIDAY',
				published_at: Instant('2026-01-01T00:00:00.000Z')
			}
		]);
		return world(rows).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				yield* hr.act('payroll_run.create', MARCH);
				const published = yield* runOf(hr, '2026-03');
				assert.deepEqual(published.slip('a').lines, { BASIC: 3000, HOLIDAY: 100 });
				yield* hr.act('payroll_run.delete', { target: [published.id] });
				yield* hr.act('holiday.update', { target: holiday, set: { published_at: null } });
				yield* hr.act('payroll_run.create', MARCH);
				assert.deepEqual((yield* runOf(hr, '2026-03')).slip('a').lines, { BASIC: 3000 });
			})
		);
	},
	60_000
);
