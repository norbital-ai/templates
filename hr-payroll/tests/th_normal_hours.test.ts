// LPA s.23: normal time is at most 48 hours a week, or 42 for hazardous work. The roster rule counts a rolling
// seven-day window ending on the entry, and planned overtime is not normal time.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Rule = {
	readonly code: string;
	readonly validate?: string;
	readonly lookup?: Record<string, unknown>;
};

const latest = (code: string): string => {
	const dir = new URL(`../seed/public/jurisdiction/${code}/`, import.meta.url);
	const versions = readdirSync(dir)
		.filter((name) => /^version_\d+$/.test(name))
		.sort((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
	const found = versions.at(-1);
	assert.ok(found !== undefined);
	return `${dir.href}${found}`;
};
const load = <T>(path: string): T => JSON.parse(readFileSync(new URL(path), 'utf8')) as T;
const rule = load<readonly Rule[]>(`${latest('TH')}/registered_rule.json`).find(
	(row) => row.code === 'NORMAL_HOURS'
);
assert.ok(rule?.validate !== undefined);

type RosterDay = {
	readonly id: string;
	readonly employment_id: string;
	readonly work_date: string;
	readonly actual_worked_intervals: readonly {
		readonly start: string;
		readonly end: string;
		readonly breaks: readonly { readonly start: string; readonly end: string }[];
	}[];
	readonly planned_overtime_intervals: readonly { readonly start: string; readonly end: string }[];
};
/** One worked day, as one interval with its original recorded break. */
const day = (id: string, work_date: string, hours: number): RosterDay => {
	const begin = `${work_date}T01:00:00.000Z`;
	const end = `${work_date}T10:00:00.000Z`;
	const break_end = `${work_date}T${hours === 7 ? '07' : '06'}:00:00.000Z`;
	return {
		id,
		employment_id: 'employment-1',
		work_date,
		actual_worked_intervals: [
			{
				start: begin,
				end,
				breaks: [{ start: `${work_date}T05:00:00.000Z`, end: break_end }]
			}
		],
		planned_overtime_intervals: []
	};
};
const validates = (category: string, days: readonly RosterDay[], entry: RosterDay) =>
	evaluate(
		rule.validate!,
		'CALCULATION',
		{
			lookup: rule.lookup ?? {},
			entry,
			subject: { employment: { terms: { statutory_work_category: category } } },
			reads: { roster_entry: days.filter((row) => row.id !== entry.id) }
		},
		rule.code
	);

describe('TH normal hours', () => {
	it('ordinary work: six eight-hour days pass, the seventh is refused', () => {
		const days = [
			'2026-11-01',
			'2026-11-02',
			'2026-11-03',
			'2026-11-04',
			'2026-11-05',
			'2026-11-06'
		].map((date, index) => day(String(index), date, 8));
		const seventh = day('6', '2026-11-07', 8);
		assert.equal(validates('ORDINARY', days, seventh), false);
		assert.equal(validates('ORDINARY', days, days[5]!), true);
	});
	it('hazardous work: six seven-hour days pass, the seventh is refused', () => {
		const days = [
			'2026-11-01',
			'2026-11-02',
			'2026-11-03',
			'2026-11-04',
			'2026-11-05',
			'2026-11-06'
		].map((date, index) => day(String(index), date, 7));
		const seventh = day('6', '2026-11-07', 7);
		assert.equal(validates('HAZARDOUS', days, seventh), false);
		assert.equal(validates('HAZARDOUS', days, days[5]!), true);
	});
	it('planned overtime does not count as normal time', () => {
		const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map(
			(date, index) => day(String(index), date, 8)
		);
		const long = {
			...day('5', '2026-11-06', 8),
			actual_worked_intervals: [
				{
					start: '2026-11-06T01:00:00.000Z',
					end: '2026-11-06T12:00:00.000Z',
					breaks: [{ start: '2026-11-06T05:00:00.000Z', end: '2026-11-06T06:00:00.000Z' }]
				}
			]
		};
		assert.equal(validates('ORDINARY', days, long), false);
		assert.equal(
			validates('ORDINARY', days, {
				...long,
				planned_overtime_intervals: [
					{ start: '2026-11-06T10:00:00.000Z', end: '2026-11-06T12:00:00.000Z' }
				]
			}),
			true
		);
	});
});
