// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Work supplies output metadata: a band emits lines, and each OT class needs a pay item of its own
 * (RFC 0001 §6, one line per OT class). The old per-scheme treatment map is gone — opt-ins live on
 * the band — so its ACCUMULATE refusal has nothing left to test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConfiguration } from '../src/collections/payroll_runs/lib/validate.ts';

const EPF = {
	row: {
		id: 'scheme-epf',
		code: 'EPF',
		sequence: 10,
		assessment_period: 'PAY_PERIOD',
		eligibility: '',
		rules: {
			relief: '',
			base_transform: '',
			share_for_dependants: '',
			rounding: ['NEAREST_CENT'],
			no_withholding_below: 0,
			use_period_table: true,
			additional_remuneration_channel: false,
			employee_share_annual_cap: null,
			shared_cap_group: null,
			project_relief_annually: false,
			total_rounded_employee_floored: false
		}
	},
	rates: [
		{
			when: 'base >= 0.0',
			employee: 'base * 11.0 / 100.0',
			employer: 'base * 13.0 / 100.0'
		}
	],
	relievedIds: []
};

const component = (code, definition) => ({
	id: `pc-${code.toLowerCase()}`,
	family: 'WORK',
	output: code === 'INCENTIVE' ? 'INCENTIVE' : 'OVERTIME',
	company_id: 'co-1',
	code,
	is_statutory: true,
	destination: 'PAY',
	direction: 'ADD',
	optIns: [],
	sequence: 20,
	eligibility: '',
	definition: definition ?? { source: 'DERIVED_OVERTIME', unit: 'MONEY' }
});

const configuration = (catalogueComponents, bands = []) => ({
	company: { id: 'co-1', name: 'Fixture Co' },
	jurisdiction: { id: 'jur-1', code: 'MY' },
	work: { proration: { by: 'CALENDAR_DAYS' }, rates: { ordinary: [], bands } },
	contributions: [EPF],
	catalogueComponents,
	limits: [],
	breaks: [],
	nightPremium: null,
	overtimeCoverageRule: null,
	shiftById: new Map(),
	patternById: new Map(),
	holidays: new Map(),
	holidayInputs: [],
	catalogueLeaves: [],
	hash: 'test'
});

test('a work band needs a pay item of its own, and names the lines it emits', () => {
	const band = {
		label: '1.5',
		line: 'OVERTIME',
		when: 'worked_hours > normal_hours',
		take: 'hours_beyond_normal',
		price: 'hours_beyond_normal * ordinary_hour',
		funnel: { above: 'limits.daily_total', line: 'INCENTIVE' },
		statutory_opt_ins: []
	};
	const missing = validateConfiguration(configuration([], [band])).filter(
		(issue) => issue.code === 'WORK_BAND_COMPONENT_MISSING'
	);
	assert.equal(missing.length, 2, JSON.stringify(missing));
	assert.match(missing.map((issue) => issue.message).join('\n'), /OVERTIME 1\.5/);
	assert.match(missing.map((issue) => issue.message).join('\n'), /INCENTIVE 1\.5/);

	const complete = validateConfiguration(
		configuration(
			[
				{ ...component('OVERTIME'), output: 'OVERTIME:1.5' },
				{ ...component('INCENTIVE'), output: 'INCENTIVE:1.5' }
			],
			[band]
		)
	).filter((issue) => issue.code === 'WORK_BAND_COMPONENT_MISSING');
	assert.equal(complete.length, 0, JSON.stringify(complete));
});
