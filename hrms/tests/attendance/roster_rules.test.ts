// Roster rules a write checks: a monthly overtime cap counts every day or only the day types it names, and a shift code
// a contract schedules may not run longer than that contract's ordinary day. The figures are synthetic.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/reads.ts';
import { ENTITY, pack, refusal, storedQuery, uuid, workspace, packTerms } from '../kit.ts';
import {
	dayFindings,
	limits,
	rosterDayProblem,
	type DayType
} from '../../src/data/model/roster_entry/service/roster_warnings.ts';
import type { JsonObject } from '../../src/lib/contracts.ts';

const HOUR = 3_600_000;
const day = (date: string, hours: number, type: DayType): JsonObject => {
	const start = Date.parse(`${date}T10:00:00.000Z`);
	return {
		work_date: date,
		type,
		planned_overtime_intervals: [
			{ start: new Date(start).toISOString(), end: new Date(start + hours * HOUR).toISOString() }
		]
	};
};
const typeOf = (entry: JsonObject): DayType => (entry.type === 'REST' ? 'REST' : 'WORK');
const days = [
	day('2026-03-02', 2, 'WORK'),
	day('2026-03-03', 2, 'WORK'),
	day('2026-03-08', 3, 'REST')
];
const [, , rest] = days;
const monthly = (cap: JsonObject[string]) => {
	assert.ok(rest !== undefined);
	return dayFindings(
		limits({ roster_warnings: { monthly_overtime_hours: cap } }),
		days,
		typeOf
	)(rest).filter((finding) => finding.code === 'roster.monthly_overtime');
};

describe('monthly overtime cap', () => {
	it('a plain cap counts every day', () => {
		assert.equal(monthly(4).length, 1);
		assert.equal(monthly(7).length, 0);
	});
	it('a cap that names its day types counts only those days', () => {
		assert.equal(monthly({ hours: 4, day_types: ['WORK'] }).length, 0);
		assert.equal(monthly({ hours: 3, day_types: ['WORK'] }).length, 1);
		assert.equal(monthly({ hours: 4, day_types: ['WORK', 'REST'] }).length, 1);
	});
});

const LONG_SHIFT = idOf('shift_definition', uuid(20));
const PATTERN = idOf('shift_pattern', uuid(21));
const base = pack(
	'ZZ',
	'Asia/Kuala_Lumpur',
	{ ...packTerms(60_000), shift_pattern_id: PATTERN },
	{},
	[],
	[]
);
const map = {
	MONDAY: LONG_SHIFT,
	TUESDAY: LONG_SHIFT,
	WEDNESDAY: LONG_SHIFT,
	THURSDAY: LONG_SHIFT,
	FRIDAY: LONG_SHIFT,
	SATURDAY: LONG_SHIFT,
	SUNDAY: LONG_SHIFT
};
const seed = {
	...base,
	shift_definition: [
		{
			id: LONG_SHIFT,
			entity_id: ENTITY,
			code: 'LONG',
			name: 'Long day',
			effective_range: { from: '2025-01-01', to: null },
			variant: {
				day_type: 'WORK',
				start_time: '08:00',
				end_time: '18:00',
				ends_next_day: false,
				breaks: []
			}
		}
	],
	shift_pattern: [
		{
			id: PATTERN,
			entity_id: ENTITY,
			code: 'LONG-WEEK',
			name: 'Long week',
			effective_range: { from: '2025-01-01', to: null },
			pattern: { week_start: 'MONDAY', days: map }
		}
	]
};

describe('a contract shift pattern', () => {
	it.live('refuses a shift longer than its normal day', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const [held] = (yield* storedQuery(t, { contract_terms: { limit: 1 } })).contract_terms.rows;
			assert.ok(held !== undefined);
			const admin = yield* t.as(t.admin);
			const refused = yield* Effect.flip(
				admin.act({
					'contract_terms.update': [{ target: held, set: { job_title: 'Changed' } }]
				})
			);
			assert.ok(refused._tag === 'ActRefused');
			assert.equal(refused.key, 'errors.contract_terms_shift_overlong');
			assert.equal(refused.values?.hours, 8);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-11-20T02:00:00.000Z' })))
	);
});

describe('a roster day', () => {
	const stint = {
		entity_id: { id: 'company' },
		effective_range: { from: '2026-03-01', to: '2026-03-31' }
	};
	const at = (hour: number) => `2026-03-02T${String(hour).padStart(2, '0')}:00:00.000Z`;
	it('falls inside its stint, on a shift of its company, with intervals a run can price', () => {
		const on = (more: JsonObject, shift?: JsonObject) =>
			rosterDayProblem({ work_date: '2026-03-02', ...more }, stint, shift);
		assert.equal(on({}), undefined);
		assert.equal(on({}, { entity_id: 'company' }), undefined);
		assert.match(String(on({}, { entity_id: 'another' })), /shift belongs to another company/);
		assert.match(
			String(rosterDayProblem({ work_date: '2026-04-01' }, stint, undefined)),
			/2026-04-01 is outside this employment/
		);
		// clocked in and not yet out is a day in progress
		assert.equal(on({ actual_worked_intervals: [{ start: at(9) }] }), undefined);
		assert.match(
			String(on({ actual_worked_intervals: [{ start: at(17), end: at(9) }] })),
			/positive and nonoverlapping/
		);
		assert.match(
			String(
				on({
					planned_overtime_intervals: [
						{ start: at(18), end: at(20) },
						{ start: at(19), end: at(21) }
					]
				})
			),
			/positive and nonoverlapping/
		);
	});
	it.live('is refused by the write when it falls outside its stint', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			const refused = yield* refusal(
				admin.act({
					'roster_entry.create': [
						{ employment_id: idOf('employment', uuid(6)), work_date: '1990-01-01' }
					]
				})
			);
			assert.match(String(refused.message), /1990-01-01 is outside this employment/);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })))
	);
});
