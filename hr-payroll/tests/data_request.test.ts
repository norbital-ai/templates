// The data-request sheets: flat columns for every jurisdiction, and filled rows back into the models.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { WorkbookRowsError } from '../src/lib/payroll_engine/workbook_rows.ts';
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
} from '../src/lib/ui/workbook/data_request.ts';

const TODAY = '2026-11-05';
const seed = (code: string) => {
	const root = `seed/public/jurisdiction/${code}`;
	const read = (version: string, file: string) =>
		JSON.parse(readFileSync(`${root}/${version}/${file}.json`, 'utf8'));
	const versions = readdirSync(root).map((version) => ({
		version,
		row: [read(version, 'jurisdiction_settings')].flat()[0]
	}));
	const current = versions
		.filter(
			({ row }) =>
				row.effective_range.from <= TODAY &&
				(row.effective_range.to == null || TODAY <= row.effective_range.to)
		)
		.toSorted((left, right) =>
			String(right.row.effective_range.from).localeCompare(left.row.effective_range.from)
		)[0];
	assert.ok(current !== undefined);
	const settings: SettingsFacts = { ...current.row, id: 'settings-now' };
	const rule = read(current.version, 'registered_rule').find(
		(row: { code: string }) => row.code === 'CONTRACT_CATEGORIES'
	);
	const allowances: readonly AllowanceFacts[] = read(current.version, 'allowance_catalog');
	return { settings, ruleLookup: rule?.lookup, allowances };
};

const known = (over: Partial<DataRequestKnown> = {}): DataRequestKnown => ({
	...seed('MY'),
	versions: [
		{ id: 'settings-old', code: 'MY', from: '2025-01-01', to: '2026-09-30' },
		{ id: 'settings-now', code: 'MY', from: '2026-10-01', to: null }
	],
	entities: [],
	entityVersions: [],
	profiles: [],
	contracts: [],
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
	'Legal Name *': 'Acme Sdn Bhd',
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
		it(`${code}: flat, unique, human headers on the model's paths`, () => {
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
		const { settings, ruleLookup, allowances } = seed('CN');
		const choices = contractColumns(settings, ruleLookup, allowances).filter(
			(column) => column.option !== undefined
		);
		assert.deepEqual(
			choices.map((column) => column.option),
			['PENSION', 'MEDICAL', 'UNEMPLOYMENT', 'WORK_INJURY']
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

	it('builds a company, a person and a contract in their model shapes', () => {
		const plan = planDataRequest(workbook(sheets), known());
		assert.deepEqual(plan.entities, [{ name: 'Acme', code: 'ACME' }]);
		const version = plan.versions[0]?.row;
		assert.deepEqual(version?.effective_range, { from: '2026-01-01', to: null });
		assert.equal(version?.input_schema_version_id, 'settings-old');
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
		assert.deepEqual(
			(version?.entity_extension_data as { registrations?: unknown } | undefined)?.registrations,
			[{ scheme_code: 'EPF', number: '0012345' }]
		);
		assert.deepEqual(plan.profiles, [
			{ name: 'Aisha', email: 'aisha@example.test', source_reference: 'A1' }
		]);
		const row = plan.contracts[0]?.row;
		assert.equal(row?.engagement, 'PART_TIME');
		assert.equal(row?.status, 'DRAFT');
		assert.deepEqual(row?.payroll, { gender: 'FEMALE' });
		assert.deepEqual(row?.terms, {
			rate: { amount: 3000, unit: 'MONTHLY' },
			statutory_work_category: 'NON_MANUAL',
			residency_status: 'CITIZEN',
			employer_bears_income_tax: true,
			allowances: { MEAL_ALLOWANCE: { amount: 150 } }
		});
		assert.deepEqual(row?.employee_extension_data, {
			paternity_confinements: [
				{ event_id: 'E1', lifetime_number: 1, notification_requirement_met: true },
				{ event_id: 'E2', lifetime_number: 2 }
			]
		});
	});

	it('closes a duplicated contract row the day before its successor', () => {
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
		assert.deepEqual(
			plan.contracts.map(({ row }) => row.effective_range),
			[
				{ from: '2026-03-01', to: '2026-06-30' },
				{ from: '2026-07-01', to: null }
			]
		);
	});

	it('skips what is recorded, seals what an interrupted import left, updates a profile', () => {
		const plan = planDataRequest(
			workbook({
				'Employment Profile': [{ ...person, 'Full Name *': 'Aisha Binti' }],
				'Employment Contract': [contract, { ...contract, 'Contract Start *': '2026-07-01' }]
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
						first_hired_on: null,
						source_reference: 'A1'
					}
				],
				contracts: [
					{
						id: 'c1',
						employee_id: 'p1',
						employee_number: 'A1',
						from: '2026-03-01',
						to: '2026-06-30',
						status: 'SEALED'
					},
					{
						id: 'c2',
						employee_id: 'p1',
						employee_number: 'A1',
						from: '2026-07-01',
						to: null,
						status: 'DRAFT'
					}
				]
			})
		);
		assert.deepEqual(plan.contracts, []);
		assert.deepEqual(plan.sealContracts, ['c2']);
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

	it('refuses an overlap with a sealed contract', () => {
		refused(
			() =>
				planDataRequest(
					workbook({ 'Employment Contract': [{ ...contract, 'Contract Start *': '2026-04-01' }] }),
					known({
						entities: [{ id: 'e1', name: 'Acme', code: null }],
						contracts: [
							{
								id: 'c1',
								employee_id: 'p1',
								employee_number: 'A1',
								from: '2026-03-01',
								to: null,
								status: 'SEALED'
							}
						],
						profiles: [
							{
								id: 'p1',
								name: 'Aisha',
								email: null,
								phone: null,
								address: null,
								first_hired_on: null,
								source_reference: null
							}
						]
					})
				),
			/overlaps the contract from 2026-03-01/
		);
	});
});
