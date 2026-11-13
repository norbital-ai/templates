// The data-request sheets: flat columns for every jurisdiction, and filled rows back into the models.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { isJsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { WorkbookRowsError } from '../../src/lib/payroll_engine/workbook_rows.ts';
import {
	contractColumns,
	entityColumns,
	human,
	jurisdictionOf,
	planDataRequest,
	profileColumns,
	type AllowanceFacts,
	type DataRequestKnown,
	type SettingsFacts
} from '../../src/lib/ui/workbook/data_request.ts';
import { lawAt } from '../kit.ts';

const TODAY = '2026-11-05';
/** What the workbook reads of the law in force today. */
const seed = (code: string) => {
	const law = lawAt(code, TODAY);
	const text = (value: unknown) => (typeof value === 'string' ? value : null);
	const settings: SettingsFacts = {
		code,
		timezone: String(law.settings.timezone),
		lookup: law.settings.lookup,
		employee_extension_schema: law.settings.employee_extension_schema,
		entity_extension_schema: law.settings.entity_extension_schema
	};
	const allowances: readonly AllowanceFacts[] = law.rows.allowance_catalog.map((row) => ({
		code: String(row.code),
		lookup: row.lookup,
		eligibility: text(row.eligibility),
		conversion: text(row.conversion)
	}));
	return {
		settings,
		ruleLookup: law.rows.registered_rule.find((row) => row.code === 'CONTRACT_CATEGORIES')?.lookup,
		allowances
	};
};

const known = (over: Partial<DataRequestKnown> = {}): DataRequestKnown => ({
	...seed('MY'),
	entities: [],
	entityChanges: [],
	profiles: [],
	stints: [],
	patterns: [],
	...over
});
type Row = Readonly<Record<string, string | number | null>>;
const table = (rows: readonly Row[]) => {
	const header = [...new Set(rows.flatMap((row) => Object.keys(row)))];
	return [header, ...rows.map((row) => header.map((key) => row[key] ?? null))];
};
const workbook = (sheets: Readonly<Record<string, readonly Row[]>>) =>
	new Map(Object.entries(sheets).map(([name, rows]) => [name, table(rows)] as const));
const company = {
	'Company Name *': 'Acme',
	'Company Code': 'ACME',
	'Effective From *': '2026-01-01',
	'Pay Frequency *': 'Monthly',
	'Pay Days': '25',
	'Non-Working Weekdays': 'Sat; Sun',
	'Pay Cut-off Day *': 1,
	'EPF Employer Number': '0012345'
};
const person = { 'Employee Number *': 'A1', 'Full Name *': 'Aisha', Email: 'aisha@example.test' };
const contract = {
	'Employee Number *': 'A1',
	'Company *': 'Acme',
	'Employment Type *': 'Part Time',
	'Contract Start *': '2026-03-01',
	'Salary *': 3000,
	'Salary Unit *': 'Monthly',
	'Statutory Work Category': 'Non Manual',
	'Residency Status': 'Citizen',
	'Employer Bears Income Tax': 'Yes',
	'Meal allowance': 150,
	Gender: 'Female',
	'Verified paternity confinement history 1: Event ID': 'E1',
	'Verified paternity confinement history 1: Lifetime Number': 1,
	'Verified paternity confinement history 1: Notification Requirement Met': 'Yes',
	'Verified paternity confinement history 2: Event ID': 'E2',
	'Verified paternity confinement history 2: Lifetime Number': 2
};
const refused = (run: () => unknown, pattern: RegExp) =>
	assert.throws(run, (error: unknown) => {
		assert.ok(error instanceof WorkbookRowsError);
		assert.match([error.message, ...error.detail].join('\n'), pattern);
		return true;
	});

describe('data request columns', () => {
	for (const code of ['CN', 'ID', 'JP', 'MY', 'PH', 'SG', 'TH', 'TW', 'VN'])
		it(`every pack's headers are flat, unique and human on the model's paths (${code})`, () => {
			const { settings, ruleLookup, allowances } = seed(code);
			for (const columns of [
				entityColumns(settings, ['EPF', 'EPF_PR']),
				contractColumns(settings, ruleLookup, allowances)
			]) {
				const labels = columns.map((column) => column.label.toLowerCase());
				assert.equal(new Set(labels).size, labels.length);
				for (const label of labels) assert.doesNotMatch(label, /_|elections|^facts/);
			}
		});

	it('shows an enum as words that normalise straight back', () => {
		assert.equal(human('NON_MANUAL'), 'Non Manual');
		assert.equal(human('EA_COVERED'), 'EA Covered');
		assert.equal(human('STUDENT_TRAINING_TO'), 'Student Training To');
		assert.equal(profileColumns[0]?.label, 'Employee Number');
	});

	it('turns a multi-select into one Yes/No per choice', () => {
		const { settings, ruleLookup, allowances } = seed('MY');
		// the fixture's own field: a list of choices on the person's statutory data
		const schema = settings.employee_extension_schema;
		assert.ok(isJsonObject(schema) && isJsonObject(schema.properties));
		const choices = contractColumns(
			{
				...settings,
				employee_extension_schema: {
					...schema,
					properties: {
						...schema.properties,
						exempt_schemes: {
							type: 'array',
							title: 'Exempt schemes',
							items: { type: 'string', enum: ['FIRST', 'SECOND', 'THIRD'] }
						}
					}
				}
			},
			ruleLookup,
			allowances
		).filter((column) => column.option !== undefined);
		assert.deepEqual(
			choices.map((column) => column.option),
			['FIRST', 'SECOND', 'THIRD']
		);
		assert.ok(choices.every((column) => column.kind === 'bool'));
	});

	it('reads its country from the Read me', () => {
		assert.equal(jurisdictionOf(new Map([['Read me', [['x'], ['Jurisdiction: MY']]]])), 'MY');
		refused(() => jurisdictionOf(new Map([['Entity', [['x']]]])), /names no jurisdiction/);
	});
});

describe('data request plan', () => {
	const sheets = {
		Entity: [company],
		'Employment Profile': [person],
		'Employment Contract': [contract]
	};

	it('builds a company, a person and an employment in their model shapes', () => {
		const plan = planDataRequest(workbook(sheets), known());
		assert.deepEqual(plan.entities, [
			{ name: 'Acme', code: 'ACME', settings_code: 'MY', time_zone: seed('MY').settings.timezone }
		]);
		const change = plan.changes[0];
		assert.equal(change?.company, 'acme');
		assert.equal(change?.row.effective_from, '2026-01-01');
		assert.deepEqual(plan.entitySchedules, [
			{
				name: 'Acme',
				payment_schedule: {
					frequency: 'MONTHLY',
					business_day: 'NONE',
					non_working_weekdays: [6, 0],
					short_month: 'LAST_DAY',
					pay_days: [25]
				},
				pay_cutoff_day: 1
			}
		]);
		const parameters = change?.row.statutory_parameters;
		assert.deepEqual(isJsonObject(parameters) ? parameters.registrations : undefined, [
			{ scheme_code: 'EPF', number: '0012345' }
		]);
		// the person's fixed particulars are the profile's, whichever sheet states them
		assert.deepEqual(plan.profiles, [
			{ name: 'Aisha', email: 'aisha@example.test', gender: 'FEMALE', source_reference: 'A1' }
		]);
		// a hire is one stint with its first terms and what the law is told nested, each from its first day
		const row = plan.employments[0]?.row;
		assert.deepEqual(row?.effective_range, { from: '2026-03-01', to: null });
		assert.deepEqual(row?.terms, [
			{
				effective_from: '2026-03-01',
				engagement: 'PART_TIME',
				rate: { amount: 3000, unit: 'MONTHLY' },
				statutory_work_category: 'NON_MANUAL',
				employer_bears_income_tax: true,
				allowances: { MEAL_ALLOWANCE: { amount: 150 } }
			}
		]);
		assert.deepEqual(row?.parameters, [
			{
				effective_from: '2026-03-01',
				residency_status: 'CITIZEN',
				parameters: {
					paternity_confinements: [
						{ event_id: 'E1', lifetime_number: 1, notification_requirement_met: true },
						{ event_id: 'E2', lifetime_number: 2 }
					]
				}
			}
		]);
	});

	it('reads a duplicated contract row as the change from its date', () => {
		const plan = planDataRequest(
			workbook({
				...sheets,
				'Employment Contract': [
					{ ...contract, 'Contract Start *': '2026-07-01', 'Salary *': 3500 },
					contract
				]
			}),
			known()
		);
		// one stint, open; the second row is only what changed, from its date
		const [employment, ...others] = plan.employments;
		assert.deepEqual(others, []);
		assert.deepEqual(employment?.row.effective_range, { from: '2026-03-01', to: null });
		const terms = employment?.row.terms;
		assert.ok(Array.isArray(terms));
		assert.equal(terms.length, 2);
		assert.deepEqual(terms[1], {
			effective_from: '2026-07-01',
			rate: { amount: 3500, unit: 'MONTHLY' }
		});
	});

	it('skips what is recorded, adds the change an interrupted import left, updates a profile', () => {
		// what the first import wrote: the stint with its first rows, as stored
		const hired = planDataRequest(workbook(sheets), known()).employments[0]?.row;
		const stored = (rows: unknown, id: string) =>
			(Array.isArray(rows) ? rows : [])
				.filter(isJsonObject)
				.map((row, index) => ({ ...row, id: `${id}${index}` }));
		const plan = planDataRequest(
			workbook({
				'Employment Profile': [{ ...person, 'Full Name *': 'Aisha Binti' }],
				'Employment Contract': [
					contract,
					{ ...contract, 'Contract Start *': '2026-07-01', 'Salary *': 3500 }
				]
			}),
			known({
				entities: [{ id: 'e1', name: 'Acme', code: 'ACME' }],
				profiles: [
					{
						id: 'p1',
						name: 'Aisha',
						email: 'aisha@example.test',
						phone: null,
						address: null,
						source_reference: 'A1',
						date_of_birth: null,
						identity_number: null,
						gender: 'FEMALE',
						bank: null
					}
				],
				stints: [
					{
						id: 's1',
						employee_id: 'p1',
						entity_id: 'e1',
						employee_number: 'A1',
						from: '2026-03-01',
						to: null,
						terms: stored(hired?.terms, 't'),
						parameters: stored(hired?.parameters, 'q')
					}
				]
			})
		);
		assert.deepEqual(plan.employments, []);
		assert.deepEqual(plan.terms, [
			{
				employment: 's1',
				row: { effective_from: '2026-07-01', rate: { amount: 3500, unit: 'MONTHLY' } }
			}
		]);
		assert.deepEqual(plan.parameters, []);
		assert.deepEqual(plan.profileUpdates, [{ target: 'p1', set: { name: 'Aisha Binti' } }]);
		assert.match(plan.warnings[0] ?? '', /already recorded/);
	});

	it('names every problem with its sheet and row', () => {
		const file = workbook({
			Entity: [{ ...company, 'Pay Frequency *': 'Yearly' }],
			'Employment Profile': [person],
			'Employment Contract': [
				{ ...contract, 'Company *': 'Nobody', 'Salary Unit *': '', 'Employment Type *': 'Boss' },
				{ ...contract, 'Employee Number *': 'B2' }
			]
		});
		for (const problem of [
			/Entity row 2, Pay Frequency: "Yearly"/,
			/Employment Contract row 2: enter Salary Unit/,
			/"Boss" is not one of Employee/,
			/no company named "Nobody"/,
			/B2 is not on the Employment Profile/
		])
			refused(() => planDataRequest(file, known()), problem);
	});

	it('refuses an overlap with a stint held at another company', () => {
		refused(
			() =>
				planDataRequest(
					workbook({ 'Employment Contract': [{ ...contract, 'Contract Start *': '2026-04-01' }] }),
					known({
						entities: [{ id: 'e1', name: 'Acme', code: null }],
						stints: [
							{
								id: 's1',
								employee_id: 'p1',
								entity_id: 'e2',
								employee_number: 'A1',
								from: '2026-03-01',
								to: null,
								terms: [],
								parameters: []
							}
						],
						profiles: [
							{
								id: 'p1',
								name: 'Aisha',
								email: null,
								phone: null,
								address: null,
								source_reference: null,
								date_of_birth: null,
								identity_number: null,
								gender: null,
								bank: null
							}
						]
					})
				),
			/overlaps the employment from 2026-03-01/
		);
	});
});
