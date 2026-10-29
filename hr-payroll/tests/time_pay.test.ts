/**
 * `jurisdiction_settings.time_pay`: pay for time employed and worked, one line per reserved key on the synthetic `XX`
 * version (`jurisdiction_kit.ts`). A line pays only when its eligibility holds, a tiered premium is one key's formula,
 * and a key outside the reserved set is refused when the version is saved.
 */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import type { ActInput } from '@norbital-ai/bolt';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { fixtureId, nativeId } from './fixture_values.ts';
import {
	COMPANY,
	TIME_PAY,
	WORK,
	employer,
	employment,
	runOf,
	world,
	type Tables
} from './jurisdiction_kit.ts';

const MARCH = { company_id: COMPANY, period: '2026-03', kind: 'REGULAR' } as const;
/** The tables with the version's `time_pay` replaced. */
const withTimePay = (rows: Tables, time_pay: object): Tables => {
	rows.set(
		'jurisdiction_settings',
		(rows.get('jurisdiction_settings') ?? []).map((row) => ({ ...row, time_pay }))
	);
	return rows;
};

it.effect('a time_pay line whose eligibility is false pays nothing', () => {
	const rows = withTimePay(employer([{ key: 'a', salary: 3000 }]), {
		...TIME_PAY,
		NIGHT_WORK: TIME_PAY.OVERTIME.map((line) => ({
			...line,
			code: 'NIGHT_WORK',
			eligibility: 'false',
			quantity: '1.0',
			rate: '500.0'
		}))
	});
	return world(rows).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			assert.equal((yield* hr.act('payroll_run.create', [MARCH])).kind, 'committed');
			assert.deepEqual((yield* runOf(hr, '2026-03')).slip('a').lines, { BASIC: 3000 });
		})
	);
});

it.effect('a tiered overtime premium is one key: 61 hours pay 60 at 125 % and one at 150 %', () => {
	// an hourly rate of 1,600 / 160 = 10; each tier rounded as its own line would be
	const rows = withTimePay(employer([{ key: 'a', salary: 1600 }]), {
		...TIME_PAY,
		OVERTIME: TIME_PAY.OVERTIME.map((line) => ({
			...line,
			quantity: '1.0',
			rate: 'round(min(work.overtime_hours, 60.0) * (terms.base_salary / 160.0 * 1.25), 0.01, "HALF_UP") + round(max(0.0, work.overtime_hours - 60.0) * (terms.base_salary / 160.0 * 1.5), 0.01, "HALF_UP")'
		}))
	});
	const day = (date: string, hours: number) => ({
		id: nativeId('roster_entry', fixtureId(`xx-tier-${date}`)),
		employment_id: employment('a'),
		work_date: PlainDate(date),
		shift_definition_id: WORK,
		planned_overtime_hours: hours,
		worked_intervals: [
			{
				start: Instant(`${date}T09:00:00.000Z`),
				end: Instant(`${date}T${String(18 + hours).padStart(2, '0')}:00:00.000Z`)
			}
		]
	});
	// twelve weekdays of five hours past the 18:00 shift end, then one of an hour: 61 hours
	const fives = ['02', '03', '04', '05', '06', '09', '10', '11', '12', '13', '16', '17'];
	rows.set('roster_entry', [...fives.map((d) => day(`2026-03-${d}`, 5)), day('2026-03-18', 1)]);
	return world(rows).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			assert.equal((yield* hr.act('payroll_run.create', [MARCH])).kind, 'committed');
			const a = (yield* runOf(hr, '2026-03')).slip('a');
			// 60 × 12.50 + 1 × 15.00
			assert.equal(a.lines['OVERTIME'], 765);
			assert.equal(a.lines['BASIC'], 1600);
		})
	);
});

it.effect('a time_pay key outside the reserved set is refused when the version is saved', () =>
	world(employer([])).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			const draft = {
				code: 'YY',
				name: 'Draft',
				payroll: { currency: 'USD' },
				sources: { entries: [] },
				effective_range: { from: '2026-01-01', to: null }
			} satisfies ActInput<'jurisdiction_settings.create'>[number];
			const line = {
				code: 'BASIC',
				eligibility: 'true',
				quantity: '1.0',
				rate: 'terms.base_salary',
				destination: 'PAY',
				direction: 'ADD',
				counts_toward: []
			} as const;
			// a stored value is not a fresh literal, so the type admits the extra key the save must refuse
			const bonus = { BASIC: [line], BONUS: [line] };
			assert.equal(
				(yield* admin.act('jurisdiction_settings.create', [
					{ ...draft, time_pay: { BASIC: [line, { ...line, code: 'BASIC_DAILY' }] } }
				])).kind,
				'committed'
			);
			yield* Effect.flip(
				admin.act('jurisdiction_settings.create', [{ ...draft, code: 'ZZ', time_pay: bonus }])
			);
			// a line's code names one line across every kind
			yield* Effect.flip(
				admin.act('jurisdiction_settings.create', [
					{ ...draft, code: 'WW', time_pay: { BASIC: [line], OVERTIME: [line] } }
				])
			);
		})
	)
);
