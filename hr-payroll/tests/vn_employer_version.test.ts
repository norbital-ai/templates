// The employer facts come from the sealed entity version in force on the relevant date, not the first row. A missing
// covering version is a data problem: the rule refuses rather than defaulting.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { Instant } from '@norbital-ai/std/date';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Row = {
	readonly code: string;
	readonly validate?: string;
	readonly lookup?: Record<string, unknown>;
};
const load = <T>(version: number, file: string): T =>
	JSON.parse(
		readFileSync(
			new URL(`../seed/public/jurisdiction/VN/version_${version}/${file}`, import.meta.url),
			'utf8'
		)
	) as T;
const ruleOf = (version: number, code: string) => {
	const rule = load<readonly Row[]>(version, 'registered_rule.json').find((row) => row.code === code);
	assert.ok(rule?.validate !== undefined);
	const [settings] = load<readonly { lookup?: Record<string, unknown> }[]>(
		version,
		'jurisdiction_settings.json'
	);
	return { ...rule, lookup: { ...settings?.lookup, ...rule.lookup } };
};
const employer = (region: string, from: string, to: string | null, rest = false) => ({
	status: 'SEALED',
	effective_range: { from, to },
	entity_extension_data: { region, rest_averaged_monthly: rest }
});
const worked = (date: string) => ({
	work_date: date,
	actual_worked_intervals: [
		{ start: Instant(`${date}T01:00:00.000Z`), end: Instant(`${date}T09:00:00.000Z`) }
	]
});

describe('VN employer version selection', () => {
	it('minimum wage uses the version in force on the contract start', () => {
		const v6 = ruleOf(6, 'MINIMUM_WAGE_FLOOR');
		const v7 = ruleOf(7, 'MINIMUM_WAGE_FLOOR');
		const a = employer('IV', '2026-01-01', '2026-12-31');
		const b = employer('I', '2027-01-01', null);
		const context = (rule: typeof v6, from: string, amount: number, versions: readonly object[]) => ({
			lookup: rule.lookup ?? {},
			entry: { effective_range: { from }, terms: { rate: { amount, unit: 'MONTHLY' } } },
			reads: { entity_profile_version: versions }
		});
		// B is first: reading [0] would take region I's 5,310,000 and fail 4,000,000
		assert.equal(evaluate(v6.validate!, 'CALCULATION', context(v6, '2026-12-20', 4_000_000, [b, a]), 'x'), true);
		assert.equal(evaluate(v7.validate!, 'CALCULATION', context(v7, '2027-02-01', 5_000_000, [a, b]), 'x'), false);
		// no sealed version covers the date: refuse
		assert.equal(evaluate(v7.validate!, 'CALCULATION', context(v7, '2027-02-01', 5_000_000, [a]), 'x'), false);
	});
	it('weekly rest uses the version in force on the roster day', () => {
		const rule = ruleOf(7, 'WEEKLY_REST');
		const a = employer('I', '2026-01-01', '2026-12-31', false);
		const b = employer('I', '2027-01-01', null, true);
		const days = Array.from({ length: 27 }, (_, index) => {
			const date = `2026-02-${String(index + 1).padStart(2, '0')}`;
			// one rest day in the final seven, so the weekly cycle has its 24 hours
			return date === '2026-02-22' ? { work_date: date, actual_worked_intervals: [] } : worked(date);
		});
		const context = (versions: readonly object[]) => ({
			lookup: rule.lookup ?? {},
			entry: { work_date: '2026-02-28', actual_worked_intervals: worked('2026-02-28').actual_worked_intervals },
			reads: { roster_entry: days, entity_profile_version: versions }
		});
		// B is first: reading [0] would apply the monthly averaging (1 rest < 4) and fail
		assert.equal(evaluate(rule.validate!, 'CALCULATION', context([b, a]), 'x'), true);
		assert.equal(evaluate(rule.validate!, 'CALCULATION', context([b]), 'x'), false);
		// all seven worked in the window is a violation under the version in force
		const noRest = days.map((day) => worked(day.work_date));
		assert.equal(
			evaluate(
				rule.validate!,
				'CALCULATION',
				{ ...context([b, a]), reads: { roster_entry: noRest, entity_profile_version: [b, a] } },
				'x'
			),
			false
		);
	});
	it('annual overtime uses the version in force on the roster day', () => {
		const rule = ruleOf(7, 'OVERTIME_ANNUAL_CAP');
		const a = employer('I', '2026-01-01', '2026-12-31', false);
		const b = employer('I', '2027-01-01', null, true);
		(a.entity_extension_data as Record<string, unknown>).overtime_300h_sector = false;
		(b.entity_extension_data as Record<string, unknown>).overtime_300h_sector = true;
		const hour = { start: Instant('2026-06-01T00:00:00.000Z'), end: Instant('2026-06-09T09:00:00.000Z') };
		const entry = { work_date: '2026-06-09', planned_overtime_intervals: [hour] };
		const context = (versions: readonly object[]) => ({
			lookup: rule.lookup ?? {},
			entry,
			subject: { employment: { entity_id: 'entity-1' } },
			reads: { roster_entry: [], entity_profile_version: versions }
		});
		// 201 hours at the entry: the 2026 cap is 200, the 2027 sector cap is 300
		assert.equal(evaluate(rule.validate!, 'CALCULATION', context([b, a]), 'x'), false);
	});
});
