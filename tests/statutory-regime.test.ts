// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { statutoryRegimeIssues } from '../src/datatypes/statutory_regime/+definition.ts';
import { configurationSnapshot } from '../src/collections/payroll_runs/lib/configuration.ts';

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
				pay_frequency: 'MONTHLY'
			},
			jurisdiction: {
				id: 'jurisdiction-my-2026',
				proration: { by: 'CALENDAR_DAYS' },
				ordinary_rate: { per: 'DAY', divisor: 26 },
				tax_year_start_month: 1,
				effective_range: { start: '2026-01-01', end: null },
				regime: value
			},
			contributions: [],
			leaveProfiles: [],
			treatments: new Map(),
			payComponents: [],
			overtimeRules: value.overtime_rules,
			overtimeLimits: value.overtime_limits,
			overtimeCoverageRule: value.overtime_coverage,
			shiftById: new Map(),
			patternById: new Map(),
			holidays: new Map(),
			leaveTypes: []
		},
		'2026-08'
	);

	assert.deepEqual(snapshot.statutory_regime, {
		effective_range: { start: '2026-01-01', end: null },
		value
	});
	assert.equal(
		snapshot.statutory_regime.value.overtime_rules[0].authority,
		'Employment Act 1955 s.60A(3)(a)'
	);
});

test('an INCENTIVE boundary sits beside the statutory ceilings and must be a daily total-work limit', () => {
	const incentive = (overrides = {}) => ({
		period: 'DAY',
		measures: 'TOTAL_WORK_HOURS',
		max_hours: 11,
		on_exceed: 'INCENTIVE',
		authority: 'Nihon Pigment arrangement, 7 September 2026',
		...overrides
	});
	const statutory = [
		{
			period: 'DAY',
			measures: 'TOTAL_WORK_HOURS',
			max_hours: 12,
			on_exceed: 'BLOCK',
			authority: 'EA 1955 s.60A(7)'
		},
		{
			period: 'MONTH',
			measures: 'OVERTIME_HOURS',
			max_hours: 104,
			on_exceed: 'WARN',
			authority: 'EA 1955 s.60A(4)(a)'
		}
	];
	assert.deepEqual(
		statutoryRegimeIssues({ ...regime(), overtime_limits: [...statutory, incentive()] }, 'MYR'),
		[]
	);
	assert.match(
		statutoryRegimeIssues(
			{
				...regime(),
				overtime_limits: [incentive({ period: 'MONTH', measures: 'OVERTIME_HOURS' })]
			},
			'MYR'
		).join(' '),
		/INCENTIVE boundary is a DAY limit on TOTAL_WORK_HOURS/
	);
	assert.match(
		statutoryRegimeIssues(
			{ ...regime(), overtime_limits: [incentive(), incentive({ max_hours: 10 })] },
			'MYR'
		).join(' '),
		/More than one INCENTIVE DAY limit/
	);
});
