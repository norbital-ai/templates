// The employer facts come from the sealed entity version in force on the relevant date, not the first row. A missing
// covering version is a data problem: the rule refuses rather than defaulting.
// Kept on VN: only VN's registered rules read the employer versions by date; no MY row selects one to vary.
import { DateTime } from 'effect';
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../../src/lib/payroll_engine/expressions.ts';
import { isJsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { lawAt } from '../kit.ts';

const LAW = lawAt('VN', '2026-12-31');
/** A registered rule's check, with the law's shared lookup under its own. */
const ruleOf = (code: string) => {
	const rule = LAW.rows.registered_rule.find((row) => row.code === code);
	const validate = rule?.validate;
	assert.ok(typeof validate === 'string', code);
	return {
		validate,
		lookup: {
			...(isJsonObject(LAW.settings.lookup) ? LAW.settings.lookup : {}),
			...(isJsonObject(rule?.lookup) ? rule.lookup : {})
		}
	};
};
const employer = (region: string, from: string, to: string | null, rest = false) => ({
	status: 'SEALED',
	effective_range: { from, to },
	entity_extension_data: { region, rest_averaged_monthly: rest }
});
const worked = (date: string) => ({
	work_date: date,
	actual_worked_intervals: [
		{
			start: DateTime.formatIso(DateTime.makeUnsafe(`${date}T01:00:00.000Z`)),
			end: DateTime.formatIso(DateTime.makeUnsafe(`${date}T09:00:00.000Z`))
		}
	]
});

describe('the employer version a rule reads', () => {
	it('is the one in force on the contract start, and none covering it refuses', () => {
		const rule = ruleOf('MINIMUM_WAGE_FLOOR');
		const a = employer('IV', '2026-01-01', '2026-12-31');
		const b = employer('I', '2027-01-01', null);
		const context = (from: string, amount: number, versions: readonly object[]) => ({
			lookup: rule.lookup,
			entry: { effective_range: { from }, terms: { rate: { amount, unit: 'MONTHLY' } } },
			reads: { entity_profile_version: versions }
		});
		// B is first: reading [0] would take B's region floor, which the amount does not reach
		assert.equal(
			evaluate(rule.validate, 'CALCULATION', context('2026-12-20', 4_000_000, [b, a]), 'x'),
			true
		);
		assert.equal(
			evaluate(rule.validate, 'CALCULATION', context('2027-02-01', 5_000_000, [a, b]), 'x'),
			false
		);
		// no sealed version covers the date: refuse
		assert.equal(
			evaluate(rule.validate, 'CALCULATION', context('2027-02-01', 5_000_000, [a]), 'x'),
			false
		);
	});
	it('is the one in force on the roster day', () => {
		const rule = ruleOf('WEEKLY_REST');
		const a = employer('I', '2026-01-01', '2026-12-31', false);
		const b = employer('I', '2027-01-01', null, true);
		const days = Array.from({ length: 27 }, (_, index) => {
			const date = `2026-02-${String(index + 1).padStart(2, '0')}`;
			// one rest day in the final seven, so the weekly cycle has its 24 hours
			return date === '2026-02-22'
				? { work_date: date, actual_worked_intervals: [] }
				: worked(date);
		});
		const context = (versions: readonly object[]) => ({
			lookup: rule.lookup,
			entry: {
				work_date: '2026-02-28',
				actual_worked_intervals: worked('2026-02-28').actual_worked_intervals
			},
			reads: { roster_entry: days, entity_profile_version: versions }
		});
		// B is first: reading [0] would apply the monthly averaging (1 rest < 4) and fail
		assert.equal(evaluate(rule.validate, 'CALCULATION', context([b, a]), 'x'), true);
		assert.equal(evaluate(rule.validate, 'CALCULATION', context([b]), 'x'), false);
		// all seven worked in the window is a violation under the version in force
		const noRest = days.map((day) => worked(day.work_date));
		assert.equal(
			evaluate(
				rule.validate,
				'CALCULATION',
				{ ...context([b, a]), reads: { roster_entry: noRest, entity_profile_version: [b, a] } },
				'x'
			),
			false
		);
	});
});
