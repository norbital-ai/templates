// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Work supplies output metadata: a band emits lines, and each OT class needs a pay item of its own
 * (one line per OT class). The old per-scheme treatment map is gone — opt-ins live on
 * the band — so its ACCUMULATE refusal has nothing left to test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConfiguration } from '../src/collections/payroll_runs/lib/validate.ts';

const EPF = {
	row: {
		id: 'scheme-epf',
		code: 'EPF',
		assessment_period: 'PAY_PERIOD',
		employee_share_annual_cap: null,
		shared_cap_group: null,
		project_relief_annually: false,
		rules: [
			{
				when: 'base >= 0.0',
				employee: 'round_cent(base * 11.0 / 100.0)',
				employer: 'round_cent(base * 13.0 / 100.0)'
			}
		]
	},
	rules: [
		{
			when: 'base >= 0.0',
			employee: 'round_cent(base * 11.0 / 100.0)',
			employer: 'round_cent(base * 13.0 / 100.0)'
		}
	]
};

const component = (code, definition) => ({
	id: `pc-${code.toLowerCase()}`,
	family: 'WORK',
	output: code === 'INCENTIVE' ? 'INCENTIVE' : 'OVERTIME',
	company_id: 'co-1',
	code,
	destination: 'PAY',
	direction: 'ADD',
	eligibility: '',
	definition: definition ?? { source: 'DERIVED_OVERTIME', unit: 'MONEY' }
});

/** A twelve-hour day: an overtime limit, so the planned excess can be incentive on any band. */
const DAILY_TOTAL = {
	key: 'daily_total',
	period: 'DAY',
	measure: 'TOTAL_WORK_HOURS',
	max_hours: 12,
	unit: 'WORKED_HOURS'
};

const configuration = (catalogueComponents, bands = [], limits = [DAILY_TOTAL]) => ({
	company: { id: 'co-1', name: 'Fixture Co' },
	jurisdiction: { id: 'jur-1', code: 'MY' },
	work: {
		proration: { by: 'CALENDAR_DAYS' },
		ordinary_divisor_days: '26.0',
		overtime_when: '',
		bands,
		limits
	},
	contributions: [EPF],
	catalogueComponents,
	limits: [],
	breaks: [],
	nightPremium: null,
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
		when: 'worked_hours > normal_hours',
		take_hours: 'hours_beyond_normal',
		price_amount: 'hours_beyond_normal * ordinary_hour'
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

	// With no overtime limit nothing is ever incentive: the band needs its OVERTIME line only.
	const unlimited = validateConfiguration(configuration([], [band], [])).filter(
		(issue) => issue.code === 'WORK_BAND_COMPONENT_MISSING'
	);
	assert.deepEqual(
		unlimited.map((issue) => /INCENTIVE/.test(issue.message)),
		[false]
	);
});
