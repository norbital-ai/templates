// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * E7 goldens (docs/capability-plan.md §E7): a scheme's base, cadence and company-wide aggregates
 * are stored expressions and rows. Every figure is hand-computed below from jurisdiction-free
 * fixtures, except the last test, which prices the MY lineage's own seeded Part F rule through
 * its seeded `reference_rows` band to prove the seed carries the rates the old literal did.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { closesWindow, contribute, contributeCompany } from '../src/lib/payroll/run/contribute.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
import { referenceTables, TABLES } from '../src/lib/expressions/functions/tables.ts';
import { headcountAverage, headcountOn } from '../src/lib/expressions/functions/company.ts';
import { evaluateNumber } from '../src/lib/expressions/evaluate.ts';

const NOBODY = personContext({
	employee: null,
	employment: { service_start: '' },
	terms: null,
	asOf: '2026-03-31'
});

const schemeOf = (code, rules, over = {}) => ({
	row: {
		id: `id-${code}`,
		code,
		assessment_period: 'PAY_PERIOD',
		assessment_scope: 'EMPLOYMENT',
		elections: [],
		employee_share_annual_cap: null,
		shared_cap_group: null,
		project_relief_annually: false,
		rules,
		assessed_on: 'BASE',
		...over
	},
	rules
});

const accumulationOf = (base) => ({
	reserved: {
		BASE: base,
		OVERTIME: 0,
		NIGHT_PREMIUM: 0,
		ABSENCE: 0,
		NO_PAY_LEAVE: 0,
		ENCASHMENT: 0,
		INCENTIVE: 0
	},
	codes: new Map(),
	familyOf: new Map(),
	countsTowardOf: new Map(),
	lines: []
});

const periodOf = (month, over = {}) => {
	const [year, m] = month.split('-').map(Number);
	const end = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
	return {
		key: month,
		start: `${month}-01`,
		end,
		index: 1,
		instalments: 1,
		monthlyOn: 'FIRST',
		lastOfYear: false,
		...over
	};
};

const YEAR = { start: '2026-01-01', end: '2026-12-31', months_employed: 12 };

const charge = (schemes, base, over = {}) =>
	contribute({
		accumulation: accumulationOf(base),
		contributions: schemes,
		facts: new Map(),
		yearToDate: () => ({ employee: 0, employer: 0, base: 0, ordinary: 0 }),
		yearEarned: new Map(),
		period: periodOf('2026-03'),
		year: YEAR,
		projection: { payslipsRemaining: 1, futurePayslipEquivalents: 0 },
		person: NOBODY,
		minimumWage: null,
		currency: 'XXX',
		...over
	});

const percent = (when, employee, employer) => ({
	when,
	employee: `round(base * ${employee}.0 / 100.0, 0.01, 'HALF_UP')`,
	employer: `round(base * ${employer}.0 / 100.0, 0.01, 'HALF_UP')`
});

// A band table: one open band above zero carrying both shares; the rule keeps the rounding.
const SHARES = {
	name: 'SHARES',
	keys: [],
	range: { from_inclusive: false, to_inclusive: true },
	columns: [
		{ key: 'employee_percent', type: 'number', required: true },
		{ key: 'employer_percent', type: 'number', required: true }
	]
};
const SHARE_ROWS = [
	{
		table: 'SHARES',
		code: 'ALL',
		effective_range: { from: '2026-01-01', to: null },
		range_from: 0,
		range_to: null,
		values: { employee_percent: 2, employer_percent: 2 }
	}
];
const EMPLOYEE = "round(base * band('SHARES', base).employee_percent / 100.0, 0.01, 'TRUNCATE')";
const BANDED = schemeOf('BANDED', [
	{
		when: 'base > 0.0',
		employee: EMPLOYEE,
		employer: `round(base * (band('SHARES', base).employee_percent + band('SHARES', base).employer_percent) / 100.0, 1, 'UP') - ${EMPLOYEE}`
	}
]);

test('a scheme rule reads its rates from the version’s band table on the person’s date', () => {
	const person = { ...NOBODY, [TABLES]: referenceTables([SHARES], SHARE_ROWS)('2026-03-31') };
	// 3,456.78 × 2% = 69.1356 → 69.13 (cents dropped); total 138.2712 → 139; employer 139 − 69.13.
	const [row] = charge([BANDED], 3456.78, { person });
	assert.deepEqual([row.employee, row.employer], [69.13, 69.87]);
	// 1,000 × 2% = 20.00 exactly; total 40 needs no rounding.
	const [even] = charge([BANDED], 1000, { person });
	assert.deepEqual([even.employee, even.employer], [20, 20]);
	// A version without the table bound refuses rather than charging zero.
	assert.throws(() => charge([BANDED], 1000), /no reference tables are bound here/);
});

test('the first base override whose condition holds replaces assessed_on', () => {
	const scheme = schemeOf('DAILY', [percent('base > 0.0', 1, 1)], {
		elections: [{ key: 'day_wage', type: 'number' }],
		base_when: [
			{
				when: 'scheme.elections.day_wage > 0.0',
				base: 'scheme.elections.day_wage * 25.0',
				authority: 'fixture'
			}
		]
	});
	const facts = (dayWage) =>
		new Map([[scheme.row.id, { kind: 'REGISTERED', elections: { day_wage: dayWage } }]]);
	// A declared day wage of 150 states the month as 150 × 25 = 3,750; 1% is 37.50.
	const [daily] = charge([scheme], 3000, { facts: facts(150) });
	assert.deepEqual([daily.base, daily.employee], [3750, 37.5]);
	// No day wage declared: the override does not hold and BASE (3,000) stands; 1% is 30.
	const [monthly] = charge([scheme], 3000, { facts: facts(0) });
	assert.deepEqual([monthly.base, monthly.employee], [3000, 30]);
});

test('a QUARTER or YEAR window closes on its last month, its last instalment, or the exit', () => {
	const at = (end, over = {}) => ({
		period: { ...periodOf(end.slice(0, 7)), ...over },
		year: { start: '2026-04-01', end: '2027-03-31' },
		person: NOBODY
	});
	// A tax year opening in April closes its quarters in June, September, December and March.
	assert.equal(closesWindow('QUARTER', at('2026-05-31')), false);
	assert.equal(closesWindow('QUARTER', at('2026-06-30')), true);
	assert.equal(closesWindow('QUARTER', at('2026-12-31')), true);
	assert.equal(closesWindow('QUARTER', at('2027-03-31')), true);
	assert.equal(closesWindow('YEAR', at('2026-12-31')), false);
	assert.equal(closesWindow('YEAR', at('2027-03-31')), true);
	// Semi-monthly: only the month's last instalment closes it.
	assert.equal(closesWindow('YEAR', at('2027-03-31', { index: 1, instalments: 2 })), false);
	assert.equal(closesWindow('YEAR', at('2027-03-31', { index: 2, instalments: 2 })), true);
	// A leaver's final period closes every window.
	const leaver = { ...NOBODY, employment: { ...NOBODY.employment, exit_date: '2026-05-20' } };
	assert.equal(closesWindow('YEAR', { ...at('2026-05-31'), person: leaver }), true);
	// The other cadences charge every period.
	assert.equal(closesWindow('MONTH', at('2026-05-31')), true);
});

test('a YEAR scheme charges once on the year’s wages; a consumer reads zero before it', () => {
	const annual = schemeOf('ANNUAL', [percent('base > 0.0', 1, 0)], {
		assessment_period: 'YEAR',
		assessed_on: 'year.earned.BASIC + BASE'
	});
	const reader = schemeOf('READER', [
		{ when: 'true', employee: 'produced.ANNUAL.employee', employer: '0.0' }
	]);
	const earned = new Map([['BASIC', 33000]]);
	const november = charge([annual, reader], 3000, {
		period: periodOf('2026-11'),
		yearEarned: earned
	});
	assert.deepEqual(
		november.map((row) => [row.contribution.row.code, row.employee]),
		[['READER', 0]]
	);
	// December: 33,000 earlier + 3,000 now = 36,000; 1% is 360.
	const december = charge([annual], 3000, { period: periodOf('2026-12'), yearEarned: earned });
	assert.deepEqual([december[0].base, december[0].employee], [36000, 360]);
	// A March leaver is charged in March on what the year paid so far: 6,000 + 3,000 → 90.
	const leaver = { ...NOBODY, employment: { ...NOBODY.employment, exit_date: '2026-03-20' } };
	const exit = charge([annual], 3000, {
		person: leaver,
		yearEarned: new Map([['BASIC', 6000]])
	});
	assert.deepEqual([exit[0].base, exit[0].employee], [9000, 90]);
});

test('a QUARTER scheme prices the quarter as the year so far less the bases already assessed', () => {
	const quarterly = schemeOf('QUARTERLY', [percent('base > 0.0', 1, 0)], {
		assessment_period: 'QUARTER',
		assessed_on: 'year.earned.BASIC + BASE - scheme.year_to_date.base'
	});
	assert.deepEqual(
		charge([quarterly], 3000, {
			period: periodOf('2026-02'),
			yearEarned: new Map([['BASIC', 3000]])
		}),
		[]
	);
	// March closes Q1: 6,000 + 3,000 − 0 = 9,000 → 90.
	const march = charge([quarterly], 3000, { yearEarned: new Map([['BASIC', 6000]]) });
	assert.deepEqual([march[0].base, march[0].employee], [9000, 90]);
	// June closes Q2: 15,000 + 3,000 − 9,000 assessed in Q1 = 9,000 → 90.
	const june = charge([quarterly], 3000, {
		period: periodOf('2026-06'),
		yearEarned: new Map([['BASIC', 15000]]),
		yearToDate: () => ({ employee: 90, employer: 0, base: 9000, ordinary: 0 })
	});
	assert.deepEqual([june[0].base, june[0].employee], [9000, 90]);
});

test('a company YEAR levy trues up the recorded estimate at the year’s close', () => {
	const levy = schemeOf(
		'LEVY',
		[
			{
				when: 'base > 0.0',
				employee: '0.0',
				employer: "round(base / 100.0, 1.0, 'DOWN') - person.company.facts.levy_estimate"
			}
		],
		{
			assessment_scope: 'COMPANY',
			assessment_period: 'YEAR',
			assessed_on: 'year.earned.BASIC + BASE'
		}
	);
	const entity = personContext({
		employee: null,
		employment: { service_start: '' },
		terms: null,
		company: { facts: { levy_estimate: 10000 } },
		asOf: '2026-12-31'
	});
	const company = (month) =>
		contributeCompany({
			accumulation: accumulationOf(100000),
			contributions: [levy],
			period: periodOf(month),
			year: YEAR,
			person: entity,
			minimumWage: null,
			currency: 'XXX',
			projection: { payslipsRemaining: 1, futurePayslipEquivalents: 0 },
			yearEarned: new Map([['BASIC', 1100000]])
		});
	assert.deepEqual(company('2026-11'), []);
	// 1,100,000 earlier + 100,000 now = 1,200,000; 1% is 12,000; less the 10,000 estimate = 2,000.
	const [december] = company('2026-12');
	assert.deepEqual([december.base, december.employer], [1200000, 2000]);
});

// A–D: A holds two contracts (one head); B leaves at June's end; C joins in July with weight 2;
// D carries weight 0.5 and a boolean all year; E starts next year.
const facts = (value) => () => value;
const ACCESS = {
	year: { from: '2026-01-01', to: '2026-12-31' },
	employments: [
		{ employee_id: 'A', from: '2026-01-01', to: null },
		{ employee_id: 'A', from: '2026-03-01', to: '2026-08-31' },
		{ employee_id: 'B', from: '2026-01-01', to: '2026-06-30' },
		{ employee_id: 'C', from: '2026-07-01', to: null, facts: facts({ disability_weight: 2 }) },
		{
			employee_id: 'D',
			from: '2025-05-01',
			to: null,
			facts: facts({ disability_weight: 0.5, registered: true })
		},
		{ employee_id: 'E', from: '2027-01-01', to: null }
	]
};

test('company headcounts count heads on a day and average the month ends', () => {
	assert.equal(headcountOn(ACCESS, '2026-06-30'), 3); // A, B, D
	assert.equal(headcountOn(ACCESS, '2026-07-31'), 3); // A, C, D
	assert.equal(headcountOn(ACCESS, '2026-06-30', 'disability_weight'), 0.5);
	assert.equal(headcountOn(ACCESS, '2026-07-31', 'disability_weight'), 2.5);
	assert.equal(headcountOn(ACCESS, '2026-07-31', 'registered'), 1);
	assert.equal(headcountAverage(ACCESS), 3);
	// (6 × 0.5 + 6 × 2.5) / 12 = 1.5.
	assert.equal(headcountAverage(ACCESS, 'disability_weight'), 1.5);
});

test('a quota levy is one expression over the company aggregates', () => {
	// ponytail: needs COMPANY_FUNCTIONS registered in functions/index.ts (the stabilise step).
	const engine = { minimumWage: () => 0, company: ACCESS };
	const context = { company: { facts: {}, year: ACCESS.year } };
	// max(0, 3 × 0.75 − 1.5) × 1,000 = 750.
	assert.equal(
		evaluateNumber(
			engine,
			"max(0.0, company.year.headcount_average() * 0.75 - company.year.headcount_average('disability_weight')) * 1000.0",
			context
		),
		750
	);
	assert.equal(evaluateNumber(engine, "company.headcount_on('2026-07-31')", context), 3);
	assert.throws(
		() => evaluateNumber({ minimumWage: () => 0 }, "company.headcount_on('2026-07-31')", context),
		/no company employments are bound here/
	);
});

test('the MY Part F rule prices through its seeded band as the old literal did', () => {
	const read = (file) => {
		const bytes = readFileSync(new URL(`../seed/jurisdiction/MY/${file}`, import.meta.url));
		return JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8'));
	};
	const versions = read('jurisdiction_settings.json');
	const rows = read('reference_rows.json');
	const version = versions.find(
		(row) => row.effective_range.end.startsWith('9999') && row.tables?.length > 0
	);
	const scheme = read('statutory_contributions.json.gz').find(
		(row) => row.code === 'EPF_NON_CITIZEN' && row.settings_id === version.id
	);
	const own = rows.filter((row) => row.settings_id === version.id);
	const person = {
		...personContext({
			employee: { date_of_birth: '1990-01-15' },
			employment: { service_start: '2030-01-01' },
			terms: { residency_status: 'FOREIGNER' },
			asOf: '2032-03-31'
		}),
		[TABLES]: referenceTables(version.tables, own)('2032-03-31')
	};
	const [row] = charge([schemeOf('EPF_NON_CITIZEN', scheme.rules)], 3456.78, {
		person,
		period: periodOf('2032-03'),
		year: { start: '2032-01-01', end: '2032-12-31', months_employed: 3 }
	});
	// The old literal: 3,456.78 × 2% truncated to the cent = 69.13; × 4% up to the unit = 139; 139 − 69.13.
	assert.deepEqual([row.employee, row.employer], [69.13, 69.87]);
});

test('a base override compiles at the assessment site, cites its law and reads no other scheme', async () => {
	const { default: schemes } =
		await import('../src/data/collection/statutory_contributions/+collection.ts');
	const { runTransform } = await import('./helpers/ctx.ts');
	const write = (base_when) =>
		runTransform(
			schemes,
			[
				{
					settings_id: 'draft',
					code: 'DAILY',
					assessed_on: 'BASE',
					elections: [{ key: 'day_wage', type: 'number' }],
					rules: [],
					base_when
				}
			],
			{
				tables: {
					jurisdiction_settings: [{ id: 'draft', code: 'PUB', name: 'Draft', sealed_at: null }],
					statutory_contributions: []
				}
			}
		);
	const override = {
		when: 'scheme.elections.day_wage > 0.0',
		base: 'scheme.elections.day_wage * 25.0',
		authority: 'fixture'
	};
	await write([override]);
	await assert.rejects(write([{ ...override, authority: ' ' }]), /cite the law/);
	await assert.rejects(write([{ ...override, when: 'scheme.elections.day_wage' }]), /override 1/);
	await assert.rejects(
		write([{ ...override, base: 'produced.OTHER.employee' }]),
		/reads another scheme/
	);
});
