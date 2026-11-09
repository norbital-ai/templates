// Labour Code art.107: 200 overtime hours a year, or 300 in the listed sectors after notification. The model's only
// overtime fact is the roster entry's planned overtime intervals, summed for the calendar year.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { Instant } from '@norbital-ai/std/date';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Rule = {
	readonly code: string;
	readonly validate?: string;
	readonly lookup?: Record<string, unknown>;
	readonly references?: readonly { readonly title: string }[];
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
const rule = load<readonly Rule[]>(`${latest('VN')}/registered_rule.json`).find(
	(row) => row.code === 'OVERTIME_ANNUAL_CAP'
);
assert.ok(rule?.validate !== undefined);

const HOUR = 3_600_000;
const span = (start: string, hours: number) => ({
	start: Instant(start),
	end: Instant(new Date(Date.parse(start) + hours * HOUR).toISOString())
});
const entry = { work_date: '2027-05-03', planned_overtime_intervals: [span('2027-05-03T10:00:00.000Z', 2)] };
const sibling = (hours: number) => ({
	work_date: '2027-01-05',
	planned_overtime_intervals: hours === 0 ? [] : [span('2027-01-05T00:00:00.000Z', hours)]
});
const employer = (sector: boolean, from = '2027-01-01', to: string | null = null) => ({
	status: 'SEALED',
	effective_range: { from, to },
	entity_extension_data: { overtime_300h_sector: sector }
});
const valid = (before: number, sector: boolean, versions = [employer(sector)]) =>
	evaluate(
		rule.validate!,
		'CALCULATION',
		{
			lookup: rule.lookup ?? {},
			entry,
			subject: { employment: { entity_id: 'entity-1' } },
			reads: { roster_entry: before === 0 ? [] : [sibling(before)], entity_profile_version: versions }
		},
		rule.code
	);

describe('VN annual overtime cap', () => {
	it('ordinary work stops at 200 hours and the sector case at 300', () => {
		assert.equal(valid(198, false), true);
		assert.equal(valid(199, false), false);
		assert.equal(valid(199, true), true);
		assert.equal(valid(299, true), false);
	});
	it('uses the employer version in force on the roster day, not the first one', () => {
		const versions = [employer(true, '2025-01-01', '2026-12-31'), employer(false)];
		// 201 hours is over the ordinary 200 cap although the older version allowed 300
		assert.equal(valid(199, false, versions), false);
	});
	it('the reference counts planned overtime intervals, not a balance that does not exist', () => {
		const prose = (rule.references ?? []).map((row) => row.title).join(' ');
		assert.match(prose, /planned overtime intervals/);
		assert.doesNotMatch(prose, /hours\.year/);
	});
});
