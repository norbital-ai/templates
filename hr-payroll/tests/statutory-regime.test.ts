// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Result, Schema } from 'effect';
import {
	statutoryRegimeIssues,
	statutoryRegimeSchema
} from '../src/datatypes/statutory_regime/+definition.ts';
import { configurationSnapshot } from '../src/collections/payroll_runs/lib/configuration.ts';

const regime = () => ({
	holiday_rest_precedence: 'REST_DAY',
	overtime_coverage: {
		wage_ceiling: { value: 4_000, currency: 'MYR' },
		ceiling_is_inclusive: true,
		wage_basis: 'STATUTORY_WAGES',
		category_basis: 'STATUTORY_WORK_CATEGORY',
		exempt_categories: ['MANUAL_LABOUR'],
		excluded_categories: ['VESSEL_WORK']
	},
	overtime_rules: [
		{
			day_type: 'ORDINARY',
			band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
			award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
		}
	],
	overtime_limits: [
		{
			period: 'MONTH',
			measures: 'OVERTIME_HOURS',
			max_hours: 104,
			on_exceed: 'BLOCK'
		}
	]
});

test('one snapshot rejects overlapping pricing bands and duplicate limit identities', () => {
	const value = regime();
	value.overtime_rules.push({
		...value.overtime_rules[0],
		band: { measure: 'BEYOND_NORMAL', from_hours: 2, to_hours: 4 }
	});
	value.overtime_limits.push({ ...value.overtime_limits[0] });

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

test('the PAID configuration snapshot retains the exact regime revision', () => {
	const value = regime();
	const snapshot = configurationSnapshot(
		{
			company: {
				id: 'company-my',
				pay_cutoff_day: 21,
				pay_frequency: 'MONTHLY'
			},
			work: {
				proration: { by: 'CALENDAR_DAYS' },
				ordinary_rate: [{ eligibility: '', per: 'DAY', divisor: 26 }],
				regime: value
			},
			jurisdiction: {
				id: 'jurisdiction-my-2026',
				proration: { by: 'CALENDAR_DAYS' },
				ordinary_rate: [{ eligibility: '', per: 'DAY', divisor: 26 }],
				tax_year_start_month: 1,
				effective_range: { start: '2026-01-01', end: null },
				regime: value
			},
			contributions: [],
			leaveProfiles: [],
			treatments: new Map(),
			catalogueComponents: [],
			overtimeRules: value.overtime_rules,
			overtimeLimits: value.overtime_limits,
			overtimeCoverageRule: value.overtime_coverage,
			shiftById: new Map(),
			patternById: new Map(),
			holidays: new Map(),
			holidayCalendars: [],
			holidayInputs: [],
			catalogueLeaves: []
		},
		'2026-08'
	);

	assert.deepEqual(snapshot.statutory_regime, {
		effective_range: { start: '2026-01-01', end: null },
		value
	});
});

test('an INCENTIVE boundary sits beside the statutory ceilings and must be a daily total-work limit', () => {
	const incentive = (overrides = {}) => ({
		period: 'DAY',
		measures: 'TOTAL_WORK_HOURS',
		max_hours: 11,
		on_exceed: 'INCENTIVE',
		...overrides
	});
	const statutory = [
		{
			period: 'DAY',
			measures: 'TOTAL_WORK_HOURS',
			max_hours: 12,
			on_exceed: 'BLOCK'
		},
		{
			period: 'MONTH',
			measures: 'OVERTIME_HOURS',
			max_hours: 104,
			on_exceed: 'WARN'
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

/**
 * The weekly rest rule decodes through the strict view — and, critically, a snapshot that predates
 * the member still decodes. `rest_break_rules` learnt this the hard way: a required member would
 * have failed every seeded snapshot, which is a migration disguised as a schema change.
 */
test('the weekly rest rule is optional, bounded and strict', () => {
	const decode = (weekly) =>
		Schema.decodeUnknownResult(statutoryRegimeSchema)(
			weekly === undefined ? regime() : { ...regime(), weekly_rest_rule: weekly }
		);
	const lawful = {
		max_consecutive_work_days: 12,
		discharged_by: 'REST_OR_OFF',
		on_exceed: 'BLOCK'
	};
	assert.ok(Result.isSuccess(decode(lawful)), 'a snapshot that declares one');
	assert.ok(Result.isSuccess(decode(undefined)), 'and one seeded before the member existed');

	for (const [why, bad] of [
		['a run of zero days is not a rule', { ...lawful, max_consecutive_work_days: 0 }],
		['nor is a fraction of a day', { ...lawful, max_consecutive_work_days: 6.5 }],
		// The hook reads a fixed 31-day neighbourhood; a limit above 30 would be unenforceable
		// there, so the schema is where it is refused rather than where it silently under-reads.
		['a limit past the read window', { ...lawful, max_consecutive_work_days: 31 }],
		['an unknown discharge', { ...lawful, discharged_by: 'HOLIDAY' }]
	]) {
		assert.ok(Result.isFailure(decode(bad)), why);
	}
});
