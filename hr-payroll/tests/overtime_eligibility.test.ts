// Overtime is a statutory benefit with a personal scope, not a property of the hours alone. The
// seeded eligibility expressions decide who is covered: Malaysia's RM4,000 monthly-wage ceiling
// and manual-labour exception, Thailand's manager exclusion, and the Philippines' managerial and
// field-personnel exclusions. These tests pin those boundaries.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Rule = {
	readonly code: string;
	readonly eligibility?: string;
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
const ruleOf = (code: string, ruleCode: string): Rule => {
	const rows = JSON.parse(
		readFileSync(new URL(`${latest(code)}/overtime_catalog.json`), 'utf8')
	) as readonly Rule[];
	const rule = rows.find((row) => row.code === ruleCode);
	assert.ok(rule?.eligibility !== undefined);
	const [settings] = JSON.parse(
		readFileSync(new URL(`${latest(code)}/jurisdiction_settings.json`), 'utf8')
	) as readonly Rule[];
	return {
		...rule,
		lookup: {
			...((settings?.lookup as Record<string, unknown> | undefined)?.['constants'] as object),
			...settings?.lookup,
			...rule.lookup
		}
	};
};
const eligible = (rule: Rule, context: object) =>
	evaluate(
		rule.eligibility!,
		'CALCULATION',
		{ lookup: rule.lookup ?? {}, ...context },
		`${rule.code}.eligibility`
	);

describe('seeded overtime eligibility', () => {
	it('Malaysia: RM4,000 ceiling, manual labour and contractual opt-in', () => {
		const rule = ruleOf('MY', 'OVERTIME');
		const threshold = Number(rule.lookup?.['monthly_wage_threshold']);
		const context = (
			amount: number,
			options: {
				readonly unit?: string;
				readonly category?: string;
				readonly byContract?: boolean;
				readonly allowances?: Record<string, unknown>;
			} = {}
		) => {
			const fixed = Object.entries(options.allowances ?? {}).reduce(
				(total, [code, value]) =>
					code === 'VAR' ? total : total + Number((value as { amount?: number }).amount ?? 0),
				0
			);
			const unit = options.unit ?? 'MONTHLY';
			return {
				// the engine puts the month's wage on the row (salary plus included allowances; a day or hour is multiplied out)
				month_wage:
					unit === 'MONTHLY' ? amount + fixed : unit === 'DAILY' ? amount * 26 : amount * 8 * 26,
				subject: {
					employment: {
						terms: {
							rate: { amount, unit },
							normal_hours_per_day: 8,
							normal_days_per_week: 5,
							allowances: options.allowances ?? {},
							statutory_work_category: options.category ?? 'NON_MANUAL'
						},
						employee_extension_data: {
							overtime_by_contract: options.byContract ?? false
						}
					}
				}
			};
		};
		assert.equal(eligible(rule, context(threshold)), true);
		assert.equal(eligible(rule, context(threshold + 0.01)), false);
		assert.equal(eligible(rule, context(threshold + 0.01, { category: 'MANUAL_LABOUR' })), true);
		assert.equal(eligible(rule, context(threshold + 0.01, { category: 'VEHICLE_OPERATOR' })), true);
		assert.equal(eligible(rule, context(threshold + 0.01, { byContract: true })), true);
		assert.equal(
			eligible(rule, context(threshold - 500, { allowances: { FIXED: { amount: 500 } } })),
			true
		);
		assert.equal(
			eligible(rule, context(threshold - 499, { allowances: { FIXED: { amount: 500 } } })),
			false
		);
		assert.equal(
			eligible(rule, context(threshold, { allowances: { VAR: { amount: 1000 } } })),
			true
		);
		assert.equal(eligible(rule, context(150, { unit: 'DAILY' })), true);
		assert.equal(eligible(rule, context(200, { unit: 'DAILY' })), false);
		assert.equal(eligible(rule, context(18, { unit: 'HOURLY' })), true);
		assert.equal(eligible(rule, context(20, { unit: 'HOURLY' })), false);
		assert.equal(eligible(rule, context(10000, { category: 'MANUAL_LABOUR' })), true);
	});

	it('Thailand: managers are outside the overtime line', () => {
		const rule = ruleOf('TH', 'OVERTIME');
		const context = (category: string) => ({
			subject: {
				employment: { employee_extension_data: { overtime_category: category } }
			},
			work: { days: [{ day_type: 'WORK', overtime_hours: 1 }] }
		});
		assert.equal(eligible(rule, context('MANAGER')), false);
		assert.equal(eligible(rule, context('GENERAL')), true);
	});

	it('Philippines: managerial, domestic and field personnel are outside overtime', () => {
		const rule = ruleOf('PH', 'OVERTIME');
		const context = (category: string) => ({
			subject: { employment: { terms: { statutory_work_category: category } } }
		});
		assert.equal(eligible(rule, context('MANAGERIAL')), false);
		assert.equal(eligible(rule, context('DOMESTIC')), false);
		assert.equal(eligible(rule, context('FIELD_PERSONNEL')), false);
		assert.equal(eligible(rule, context('ORDINARY')), true);
	});
});
