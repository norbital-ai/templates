// Household domestic workers are outside the Labour Standards Act and the Minimum Wage Act. The general monthly and
// hourly floors skip them; their own announced monthly threshold starts with new or renewed contracts on 2022-08-10.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Rule = {
	readonly code: string;
	readonly validate?: string;
	readonly lookup?: Record<string, unknown>;
};
const read = <T>(file: string): T =>
	JSON.parse(
		readFileSync(
			new URL(`../seed/public/jurisdiction/TW/version_5/${file}`, import.meta.url),
			'utf8'
		)
	) as T;
const [settings] = read<readonly { lookup?: Record<string, unknown> }[]>(
	'jurisdiction_settings.json'
);
const ruleOf = (code: string) => {
	const rule = read<readonly Rule[]>('registered_rule.json').find((row) => row.code === code);
	assert.ok(rule?.validate !== undefined);
	return { ...rule, lookup: { ...settings?.lookup, ...rule.lookup } };
};
const monthly = ruleOf('MINIMUM_WAGE_FLOOR');
const hourly = ruleOf('MINIMUM_WAGE_HOURLY');
const domestic = ruleOf('DOMESTIC_MIGRANT_WAGE');
const valid = (
	rule: typeof monthly,
	worker: string,
	engagement: string,
	unit: string,
	amount: number,
	from = '2022-08-10'
) =>
	evaluate(
		rule.validate!,
		'CALCULATION',
		{
			lookup: rule.lookup ?? {},
			entry: {
				engagement,
				effective_range: { from },
				terms: { rate: { amount, unit } },
				employee_extension_data: { worker_category: worker }
			}
		},
		rule.code
	);

describe('TW domestic wage floor', () => {
	it('the general monthly and hourly floors skip household domestic workers', () => {
		assert.equal(valid(monthly, 'DOMESTIC_CAREGIVER', 'EMPLOYEE', 'MONTHLY', 20_000), true);
		assert.equal(valid(monthly, 'DOMESTIC_HELPER', 'EMPLOYEE', 'MONTHLY', 20_000), true);
		assert.equal(valid(hourly, 'DOMESTIC_CAREGIVER', 'PART_TIME', 'HOURLY', 100), true);
	});
	it('the domestic threshold applies to full-time monthly contracts from 2022-08-10', () => {
		assert.equal(valid(domestic, 'DOMESTIC_CAREGIVER', 'EMPLOYEE', 'MONTHLY', 20_000), true);
		assert.equal(valid(domestic, 'DOMESTIC_HELPER', 'EMPLOYEE', 'MONTHLY', 19_999), false);
		assert.equal(String(domestic.lookup?.['regime_from']), '2022-08-10');
		assert.equal(Number(domestic.lookup?.['monthly_wage']), 20_000);
	});
	it('part-time, non-monthly, pre-2022 and non-domestic contracts are outside it', () => {
		assert.equal(valid(domestic, 'DOMESTIC_CAREGIVER', 'PART_TIME', 'MONTHLY', 10_000), true);
		assert.equal(valid(domestic, 'DOMESTIC_CAREGIVER', 'EMPLOYEE', 'HOURLY', 100), true);
		assert.equal(
			valid(domestic, 'DOMESTIC_CAREGIVER', 'EMPLOYEE', 'MONTHLY', 15_000, '2021-01-01'),
			true
		);
		assert.equal(valid(domestic, 'SHOP_ASSISTANT', 'EMPLOYEE', 'MONTHLY', 1), true);
	});
});
