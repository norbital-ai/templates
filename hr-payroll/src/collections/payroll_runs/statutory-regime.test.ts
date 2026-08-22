// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { statutoryRegimeIssues } from '../../datatypes/statutory_regime/+definition.ts';
import { configurationSnapshot } from './lib/configuration.ts';

const regime = () => ({
	overtime_coverage: {
		wage_ceiling: { value: 4_000, currency: 'MYR' },
		ceiling_is_inclusive: true,
		wage_basis: 'STATUTORY_WAGES',
		category_basis: 'STATUTORY_WORK_CATEGORY',
		exempt_categories: ['MANUAL_LABOUR'],
		excluded_categories: ['VESSEL_WORK'],
		authority: 'Employment Act 1955 First Schedule'
	},
	overtime_rules: [
		{
			day_type: 'ORDINARY',
			authority: 'Employment Act 1955 s.60A(3)(a)',
			band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
			award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
		}
	],
	overtime_limits: [
		{
			period: 'MONTH',
			measures: 'OVERTIME_HOURS',
			max_hours: 104,
			on_exceed: 'BLOCK',
			authority: 'Limitation of Overtime Work Regulations 1980 reg.2'
		}
	]
});

test('one snapshot rejects overlapping pricing bands and duplicate limit identities', () => {
	const value = regime();
	value.overtime_rules.push({
		...value.overtime_rules[0],
		authority: 'a conflicting award',
		band: { measure: 'BEYOND_NORMAL', from_hours: 2, to_hours: 4 }
	});
	value.overtime_limits.push({ ...value.overtime_limits[0], authority: 'a duplicate ceiling' });

	const issues = statutoryRegimeIssues(value, 'MYR');
	assert.ok(issues.some((issue) => issue.includes('overtime bands overlap')));
	assert.ok(issues.some((issue) => issue.includes('More than one MONTH limit')));
});

test('coverage is coherent with the parent snapshot currency', () => {
	const value = regime();
	value.overtime_coverage.wage_basis = null;
	value.overtime_coverage.wage_ceiling.currency = 'SGD';
	value.overtime_coverage.excluded_categories.push('MANUAL_LABOUR');

	const issues = statutoryRegimeIssues(value, 'MYR');
	assert.ok(issues.some((issue) => issue.includes('wage basis')));
	assert.ok(issues.some((issue) => issue.includes('SGD')));
	assert.ok(issues.some((issue) => issue.includes('both always covered and never covered')));
});

test('the PAID configuration snapshot retains the exact regime revision and authorities', () => {
	const value = regime();
	const snapshot = configurationSnapshot(
		{
			company: {
				id: 'company-my',
				pay_cutoff_day: 21,
				pay_day: 28,
				overtime_calculation_method: 'STATUTORY',
				settlement_policy: { kind: 'MONTHLY' }
			},
			jurisdiction: {
				id: 'jurisdiction-my-2026',
				proration: { by: 'CALENDAR_DAYS' },
				ordinary_rate_basis: 'DAYS_PER_MONTH',
				ordinary_rate_divisor: 26,
				tax_year_start_month: 1,
				effective_range: { from: '2026-01-01', to: null },
				regime: value
			},
			contributions: [],
			treatments: new Map(),
			payComponents: [],
			overtimeRules: value.overtime_rules,
			overtimeLimits: value.overtime_limits,
			overtimeCoverageRule: value.overtime_coverage,
			shiftById: new Map(),
			holidays: new Map(),
			leaveTypes: []
		},
		'2026-08'
	);

	assert.deepEqual(snapshot.statutory_regime, {
		effective_range: { from: '2026-01-01', to: null },
		value
	});
	assert.equal(
		snapshot.statutory_regime.value.overtime_rules[0].authority,
		'Employment Act 1955 s.60A(3)(a)'
	);
});
