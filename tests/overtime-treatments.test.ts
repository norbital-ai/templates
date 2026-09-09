// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/** Work supplies output metadata; Contribution never derives a pay item from an overtime label. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { accumulateBases } from '../src/collections/payroll_runs/lib/accumulate.ts';
import { validateConfiguration } from '../src/collections/payroll_runs/lib/validate.ts';

const EPF = {
	row: {
		id: 'scheme-epf',
		code: 'EPF',
		sequence: 10,
		special_rules: [],
		relief_for: [],
		rounding: 'NEAREST_CENT'
	},
	rates: [
		{
			id: 'band-1',
			statutory_contribution_id: 'scheme-epf',
			selector: { by: 'WAGE', from: 0, to: null },
			award: { kind: 'PERCENT', employee: 11, employer: 13 }
		}
	]
};

const component = (code, treatments, definition) => ({
	id: `pc-${code.toLowerCase()}`,
	family: 'WORK',
	output: code === 'OVERTIME_EXCESS' ? 'overtime_excess' : 'overtime',
	company_id: 'co-1',
	code,
	is_statutory: true,
	nature: 'EARNING',
	contribution_treatments: treatments,
	sequence: 20,
	eligibility: '',
	definition: definition ?? { source: 'DERIVED_OVERTIME', unit: 'MONEY' }
});

const configuration = (catalogueComponents, overtimeRules = []) => {
	const treatments = new Map();
	for (const row of catalogueComponents)
		for (const contribution of [EPF]) {
			const cell = row.contribution_treatments[contribution.row.code];
			if (cell != null) treatments.set(`${row.id}:${contribution.row.id}`, cell);
		}
	return {
		company: { id: 'co-1', name: 'Fixture Co' },
		jurisdiction: { id: 'jur-1', code: 'MY' },
		work: { proration: { by: 'CALENDAR_DAYS' } },
		leaveProfiles: [],
		contributions: [EPF],
		treatments,
		catalogueComponents,
		overtimeRules,
		overtimeLimits: [],
		restBreakRules: [],
		overtimeCoverageRule: null,
		shiftById: new Map(),
		patternById: new Map(),
		holidays: new Map(),
		catalogueLeaves: [],
		hash: 'test'
	};
};

const overtimeLine = (catalogueComponent, label, amount = 100) => ({
	catalogueComponent,
	nature: 'EARNING',
	label,
	amount
});

test('ACCUMULATE refuses an OVERTIME row whose map has no cell for the scheme, naming both', () => {
	assert.throws(
		() =>
			accumulateBases({
				configuration: configuration([component('OVERTIME', {})]),
				items: [overtimeLine(component('OVERTIME', {}), 'OT_ORDINARY_BEYOND_NORMAL_0')],
				employeeNumber: 'EMP-1'
			}),
		(error) => /No EPF treatment exists for OVERTIME/.test(error.message)
	);
});

test('the OVERTIME and OVERTIME_EXCESS rows decide the scheme base of derived overtime', () => {
	const rows = [
		component('OVERTIME', { EPF: { kind: 'INCLUDE' } }),
		component('OVERTIME_EXCESS', { EPF: { kind: 'EXCLUDE' } })
	];
	const [base] = accumulateBases({
		configuration: configuration(rows),
		items: [
			overtimeLine(rows[0], 'OT_ORDINARY_BEYOND_NORMAL_0', 120),
			overtimeLine(rows[1], 'OT_EXCESS_ORDINARY_BEYOND_NORMAL_0', 45)
		],
		employeeNumber: 'EMP-1'
	});
	assert.equal(
		base.base,
		120,
		'the excess row excludes its line and the ordinary row includes its own'
	);
});

test('a jurisdiction that prices overtime needs both statutory rows before the run is built', () => {
	const rule = {
		day_type: 'ORDINARY',
		authority: 'EA 1955 s.60A(3)(a)',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
	};
	const issues = validateConfiguration(
		configuration([component('OVERTIME', { EPF: { kind: 'EXCLUDE' } })], [rule])
	);
	const missing = issues.filter((issue) => issue.code === 'OVERTIME_COMPONENT_MISSING');
	assert.equal(missing.length, 1, JSON.stringify(issues));
	assert.match(missing[0].message, /overtime_excess/);
	assert.match(missing[0].message, /MY/);
	assert.equal(
		validateConfiguration(configuration([], [])).filter(
			(issue) => issue.code === 'OVERTIME_COMPONENT_MISSING'
		).length,
		0,
		'a regime with no overtime rules never prices overtime and needs no row'
	);
});

test('a DERIVED_OVERTIME component is never measured through the catalogue walk', () => {
	const issues = validateConfiguration(
		configuration([
			component('OVERTIME', { EPF: { kind: 'EXCLUDE' } }),
			component('OVERTIME_EXCESS', { EPF: { kind: 'EXCLUDE' } })
		])
	);
	assert.deepEqual(
		issues.filter((issue) => issue.code === 'TREATMENT_MISSING'),
		[],
		'the rows carry their cells like any other component'
	);
});
