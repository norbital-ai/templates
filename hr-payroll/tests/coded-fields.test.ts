// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Fields with a finite set of valid values take them from stored configuration: a value outside the
 * table or wage order is refused by name, a listed one passes, and a lineage that declares none
 * admits only empty. The write admits what some sealed version of the lineage admits.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import companies from '../src/data/collection/companies/+collection.ts';
import employees from '../src/data/collection/employees/+collection.ts';
import terms from '../src/data/collection/employment_terms/+collection.ts';
import worksites from '../src/data/collection/worksites/+collection.ts';
import holidays from '../src/data/collection/jurisdiction_holidays/+collection.ts';
import presence from '../src/data/collection/presence_periods/+collection.ts';
import { CODED_FIELDS, codedFieldFault, wageKeyFault } from '../src/lib/coded-fields.ts';
import { wagePlaces, wageRegions, wageSectors } from '../src/lib/datatypes/wages.ts';
import { EXPRESSION_CONTEXTS } from '../src/lib/expressions/contexts.ts';
import { entityFactsOwed } from '../src/lib/facts-owed.ts';
import { transform } from './helpers/bodies.ts';

const wages = {
	by_region: { North: 1000, South: 900 },
	daily_by_worksite: { 'Hill/Upper': 40 },
	daily_by_sector: { HOTEL: 45 },
	classified_by_worksite: {
		single_establishment_fact: 'single',
		headcount_fact: 'headcount',
		rows: [{ worksite: 'Coast/Port', sector: 'FARM', rate_key: 'k' }]
	}
};
const version = (id, code, over = {}) => ({
	id,
	code,
	jurisdiction_code: code,
	sealed_at: '2025-11-30T00:00:00.000Z',
	voided_at: null,
	approval_id: null,
	effective_range: { from: '2025-01-01', to: null },
	facts: [],
	terms_facts: [],
	worksite_facts: [],
	payroll: { vocabularies: {} },
	work_rules: { wages },
	tables: [{ name: 'RISK_CLASS', keys: ['code'], columns: [] }],
	...over
});
const rows = [
	{ id: 'r1', settings_id: 'v1', table: 'RISK_CLASS', code: 'III' },
	{ id: 'r2', settings_id: 'v1', table: 'RACE', code: 'ALPHA' },
	{ id: 'r3', settings_id: 'v1', table: 'RELIGION', code: 'FAITH_A' },
	{ id: 'r4', settings_id: 'v1', table: 'RELIGION', code: 'FAITH_B' },
	{ id: 'r5', settings_id: 'v1', table: 'INDUSTRY', code: 'IND1', parent_code: 'North' }
];
const tables = (over = {}) => ({
	jurisdiction_settings: [
		version('v1', 'AAA', {
			tables: ['RISK_CLASS', 'RACE', 'RELIGION', 'INDUSTRY'].map((name) => ({
				name,
				keys: ['code'],
				columns: []
			})),
			worksite_facts: [{ key: 'industry', type: 'code', table: 'INDUSTRY', parent_fact: 'region' }]
		}),
		// lineage BBB declares no tables and no wage order
		version('v2', 'BBB', { tables: [], work_rules: {} })
	],
	reference_rows: rows,
	...over
});

test('wage helpers list the keys a wage order prices', () => {
	assert.deepEqual(wagePlaces(wages).toSorted(), ['Coast/Port', 'Hill/Upper']);
	assert.deepEqual(wagePlaces({ ...wages, workplace_keyed: true }).toSorted(), [
		'Coast/Port',
		'Hill/Upper',
		'North',
		'South'
	]);
	assert.deepEqual(wageSectors(wages).toSorted(), ['FARM', 'HOTEL']);
	assert.deepEqual(wageRegions({ ...wages, hourly_by_region: { East: 5 } }).toSorted(), [
		'East',
		'North',
		'South'
	]);
	assert.deepEqual(wagePlaces(null), []);
});

test('a code outside the table is refused by name; a listed one passes; undeclared admits only empty', () => {
	const codes = (table, code) =>
		rows.some((row) => row.table === table && row.code === code) ? { parent_code: null } : null;
	const declared = [{ tables: [{ name: 'RISK_CLASS' }] }];
	assert.equal(codedFieldFault('AAA', 'risk_class', 'RISK_CLASS', 'III', declared, codes), null);
	assert.equal(codedFieldFault('AAA', 'risk_class', 'RISK_CLASS', '', declared, codes), null);
	assert.match(
		codedFieldFault('AAA', 'risk_class', 'RISK_CLASS', 'IX', declared, codes),
		/risk_class IX is not a RISK_CLASS code/
	);
	assert.equal(
		codedFieldFault('BBB', 'risk_class', 'RISK_CLASS', null, [{ tables: [] }], codes),
		null
	);
	assert.match(
		codedFieldFault('BBB', 'risk_class', 'RISK_CLASS', 'III', [{ tables: [] }], codes),
		/BBB declares no RISK_CLASS codes, so risk_class must be empty/
	);
	// a comma list judges each part
	assert.equal(
		codedFieldFault(
			'AAA',
			'religion',
			'RELIGION',
			'FAITH_A, FAITH_B',
			[{ tables: [{ name: 'RELIGION' }] }],
			codes,
			true
		),
		null
	);
	assert.match(
		codedFieldFault(
			'AAA',
			'religion',
			'RELIGION',
			'FAITH_A,NONE',
			[{ tables: [{ name: 'RELIGION' }] }],
			codes,
			true
		),
		/religion NONE is not a RELIGION code/
	);
});

test('a sector classification with a code pattern admits any matching code', () => {
	const open = { by_region: {}, sector_code_pattern: '^[0-9]{5}$', verified_ordinary_sectors: [] };
	assert.equal(wageKeyFault('ID', 'worksite_sector', 'sectors', '46599', [open]), null);
	assert.match(
		wageKeyFault('ID', 'worksite_sector', 'sectors', 'SHOP', [open]),
		/must be empty|is not a wage sector/
	);
});

test('a company risk class and region are its lineage’s codes, as written', async () => {
	const write = (input, over) =>
		transform(companies, [{ settings_code: 'AAA', name: 'Co', ...input }], {
			tables: tables(over)
		});
	await write({ risk_class: 'III', region: 'North' });
	await assert.rejects(write({ risk_class: 'IX' }), /risk_class IX is not a RISK_CLASS code/);
	await assert.rejects(write({ region: 'Nowhere' }), /region Nowhere is not a wage region/);
	await assert.rejects(
		transform(companies, [{ settings_code: 'BBB', name: 'Co', risk_class: 'III' }], {
			tables: tables()
		}),
		/BBB declares no RISK_CLASS codes, so risk_class must be empty/
	);
	await transform(companies, [{ settings_code: 'BBB', name: 'Co', risk_class: '', region: null }], {
		tables: tables()
	});
	// a workplace-keyed wage order reads the worksite: the region is only its fallback, never refused
	await write(
		{ region: 'Kabupaten Somewhere' },
		{
			jurisdiction_settings: [
				version('v1', 'AAA', { work_rules: { wages: { ...wages, workplace_keyed: true } } })
			]
		}
	);
	// an unchanged stored value is not re-judged by an unrelated edit
	await transform(companies, [{ name: 'Renamed' }], {
		existing: [{ id: 'c1', settings_code: 'BBB', name: 'Co', risk_class: 'LEGACY', facts: {} }],
		tables: tables()
	});
});

test('a person’s race and religion are codes of a lineage of their contracts', async () => {
	const people = {
		...tables(),
		employments: [{ id: 'e1', employee_id: 'p1', company_id: 'c1' }],
		companies: [
			{ id: 'c1', settings_code: 'AAA' },
			{ id: 'c2', settings_code: 'BBB' }
		]
	};
	const edit = (input) =>
		transform(employees, [input], {
			existing: [{ id: 'p1', name: 'P', children: [] }],
			tables: people
		});
	await edit({ race: 'ALPHA', religion: 'FAITH_A' });
	await assert.rejects(edit({ race: 'OMEGA' }), /race OMEGA is not a RACE code/);
	// a hire is judged by the contract written with the person
	await assert.rejects(
		transform(
			employees,
			[{ name: 'Q', race: 'ALPHA', employments: { create: [{ company_id: 'c2' }] } }],
			{
				tables: people
			}
		),
		/BBB declares no RACE codes, so race must be empty/
	);
	// no contract yet: nothing judges the value
	await transform(employees, [{ name: 'R', race: 'ANY' }], { tables: people });
});

test('terms record a worksite and sector their wage order prices; an empty vocabulary admits the model default', async () => {
	const lineage = {
		...tables(),
		employments: [
			{ id: 'contract', company_id: 'c1', effective_range: { from: '2025-01-01', to: null } }
		],
		companies: [{ id: 'c1', settings_code: 'AAA' }]
	};
	const write = (over) =>
		transform(
			terms,
			[
				{
					employment_id: 'contract',
					job_title: 'Cook',
					employment_type: 'PERMANENT',
					base_salary: '3000.00',
					allowances: [],
					effective_range: { from: '2025-06-01', to: null },
					...over
				}
			],
			{ tables: lineage }
		);
	await write({ worksite: 'Hill/Upper', worksite_sector: 'HOTEL' });
	await assert.rejects(
		write({ worksite: 'Hill/Lower' }),
		/worksite Hill\/Lower is not a wage place/
	);
	await assert.rejects(
		write({ worksite_sector: 'MINING' }),
		/worksite_sector MINING is not a wage sector/
	);
	// `vocabularies` declares no statutory_work_category: the model default passes, nothing else
	await write({ statutory_work_category: 'NON_MANUAL' });
	await assert.rejects(
		write({ statutory_work_category: 'PIECE_RATE' }),
		/AAA does not declare PIECE_RATE as a statutory_work_category/
	);
});

test('a worksite fact may sit under the worksite’s own region', async () => {
	const site = (region, facts) =>
		transform(
			worksites,
			[
				{
					company_id: 'c1',
					code: 'S1',
					name: 'Site',
					region,
					facts,
					effective_range: { from: '2025-01-01', to: null }
				}
			],
			{ tables: { ...tables(), companies: [{ id: 'c1', settings_code: 'AAA' }] } }
		);
	await site('North', { industry: 'IND1' });
	await assert.rejects(
		site('South', { industry: 'IND1' }),
		/IND1 does not belong under region South/
	);
	await assert.rejects(site('North', { industry: 'IND9' }), /IND9 is not a code of table INDUSTRY/);
	await assert.rejects(site('Atlantis', {}), /region Atlantis is not a wage place/);
});

test('a holiday’s worksite and religions are the lineage’s', async () => {
	const holiday = (over) =>
		transform(holidays, [{ company_id: 'c1', date: '2026-01-01', name: 'Day', ...over }], {
			tables: { ...tables(), companies: [{ id: 'c1', settings_code: 'AAA' }] }
		});
	await holiday({ worksite: 'Coast/Port', religion: 'FAITH_A,FAITH_B' });
	await assert.rejects(holiday({ worksite: 'Port' }), /worksite Port is not a wage place/);
	await assert.rejects(holiday({ religion: 'FAITH_C' }), /religion FAITH_C is not a RELIGION code/);
});

test('a stay names a jurisdiction a sealed version states', async () => {
	const stay = (jurisdiction_code) =>
		transform(
			presence,
			[
				{
					employee_id: 'p1',
					jurisdiction_code,
					period: { from: '2026-01-01', to: '2026-01-05' },
					reference: 'stamp'
				}
			],
			{ tables: tables() }
		);
	await stay('AAA');
	await assert.rejects(
		stay('ZZZ'),
		/ZZZ is not the jurisdiction code of any sealed settings version/
	);
});

test('facts owed lists a stored value the governing version does not admit', () => {
	const governing = version('v1', 'AAA', {
		tables: [{ name: 'RACE' }, { name: 'RISK_CLASS' }],
		work_rules: { wages }
	});
	const owed = entityFactsOwed({
		asOf: '2026-01-31',
		window: { start: '2026-01-01', end: '2026-01-31' },
		versionOn: () => governing,
		company: {
			id: 'c1',
			settings_code: 'AAA',
			region: 'North',
			risk_class: 'IX',
			pay_frequency: 'MONTHLY'
		},
		companyFactRevisions: [],
		employments: [
			{
				id: 'e1',
				employee_id: 'p1',
				employee_number: 'E1',
				effective_range: { from: '2025-01-01', to: null }
			}
		],
		employees: [{ id: 'p1', race: 'OMEGA', religion: '' }],
		terms: [
			{
				id: 't1',
				employment_id: 'e1',
				worksite: 'Atlantis',
				worksite_sector: 'HOTEL',
				effective_range: { from: '2025-01-01', to: null }
			}
		],
		personFacts: [],
		evidence: new Set(),
		codesOn: () => (table, code) =>
			rows.some((row) => row.table === table && row.code === code) ? { parent_code: null } : null
	});
	assert.deepEqual(owed.map((fact) => `${fact.collection}.${fact.key}`).toSorted(), [
		'companies.risk_class',
		'employees.race',
		'employment_terms.worksite'
	]);
});

test('every coded field’s context path names its table', () => {
	const paths = {
		employees: { race: 'employee.race', religion: 'employee.religion' },
		companies: { risk_class: 'employment.risk_class' }
	};
	const fields = Object.values(EXPRESSION_CONTEXTS).flatMap((context) => context.fields);
	for (const [collection, columns] of Object.entries(paths))
		for (const [column, path] of Object.entries(columns)) {
			const table = CODED_FIELDS[collection][column];
			assert.ok(
				fields.some(
					(field) => field.path === path && field.description.includes(`\`${table}\` code`)
				),
				`${path} names ${table}`
			);
		}
});
