import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	compileEligibility,
	personContext,
	isEligible
} from '../src/collections/payroll_runs/lib/eligibility.ts';
import { capSubject } from '../src/lib/component_entry_cap_subject.ts';
import { leaveRules, readLeaveContext } from '../src/lib/leave/context.ts';
import { annualWindow, id, leaveContext } from './helpers/manual-leave-context.ts';
import { source } from './helpers/page-source.ts';

const restriction =
	'employee.citizenship == "CITIZEN" || employee.citizenship == "PERMANENT_RESIDENT"';

test('one employee can have different eligibility in concurrent contract jurisdictions', () => {
	const context = leaveContext();
	context.catalogues[0]!.eligibility = restriction;
	context.terms[0]!.residency_status = 'CITIZEN';
	context.companies.push({ id: id(30), settings_code: 'OTHER' });
	context.versions.push({
		...context.versions[0]!,
		id: id(31),
		code: 'OTHER',
		jurisdiction_code: 'OTHER-JUR'
	});
	context.catalogues.push({ ...context.catalogues[0]!, id: id(32), settings_id: id(31) });
	context.employments.push({ ...context.employments[0]!, id: id(33), company_id: id(30) });
	context.terms.push({
		...context.terms[0]!,
		id: id(34),
		employment_id: id(33),
		residency_status: 'FOREIGNER'
	});
	assert.equal(context.employments[0]!.employee_id, context.employments[1]!.employee_id);
	assert.equal(
		leaveRules(context, id(1), id(7)).entitlementAt(annualWindow, '2026-06-30').available,
		12
	);
	assert.equal(
		leaveRules(context, id(33), id(32)).entitlementAt(annualWindow, '2026-06-30').available,
		0
	);
});

test('unknown contract standing never falls back to nationality or a legacy personal status', () => {
	const employee = { gender: 'MALE', nationality: 'CITIZEN', residency_status: 'CITIZEN' };
	for (const terms of [null, {}, { residency_status: null }]) {
		const subject = personContext({
			employee,
			employment: { hire_date: '2025-01-01' },
			terms,
			asOf: '2026-06-30'
		});
		assert.equal(subject.employee.citizenship, '');
		assert.equal(isEligible(restriction, subject), false);
	}
});

test('Leave uses residency history from the terms effective on each eligibility date', () => {
	const context = leaveContext();
	context.catalogues[0]!.eligibility = restriction;
	context.terms[0]!.residency_status = 'FOREIGNER';
	context.terms[0]!.effective_range = { start: '2025-01-01', end: '2026-06-30' };
	context.terms.push({
		...context.terms[0]!,
		id: id(20),
		residency_status: 'PERMANENT_RESIDENT',
		effective_range: { start: '2026-07-01', end: null }
	});
	const rules = leaveRules(context, id(1), id(7));
	assert.equal(rules.eligibleOn('2026-06-30'), false);
	assert.equal(rules.eligibleOn('2026-07-01'), true);
	assert.equal(rules.entitlementAt(annualWindow, '2026-06-30').available, 0);
	assert.equal(rules.entitlementAt(annualWindow, '2026-07-01').available, 12);
	assert.equal(
		context.employments[0]!.hire_date,
		'2025-01-01',
		'an amendment does not start a new service period'
	);
});

test('claim caps use the same effective contract standing as Leave and payroll', () => {
	const terms = [
		{ residency_status: 'FOREIGNER', effective_range: { start: '2025-01-01', end: '2026-06-30' } },
		{ residency_status: 'CITIZEN', effective_range: { start: '2026-07-01', end: null } }
	];
	const api = {
		db: {
			employments: {
				findFirst: () =>
					Effect.succeed({ id: id(1), employee_id: id(2), hire_date: '2025-01-01', children: [] })
			},
			employees: { findFirst: () => Effect.succeed({ gender: 'MALE', nationality: 'MY' }) },
			employment_terms: { findMany: () => Effect.succeed(terms) },
			companies: { findFirst: () => Effect.succeed({ region: 'I' }) }
		}
	};
	assert.equal(
		Effect.runSync(capSubject(api, id(1), '2026-06-30'))?.subject.employee.citizenship,
		'FOREIGNER'
	);
	assert.equal(
		Effect.runSync(capSubject(api, id(1), '2026-07-01'))?.subject.employee.citizenship,
		'CITIZEN'
	);
	assert.equal(Effect.runSync(capSubject(api, id(1), '2026-07-01'))?.subject.company.region, 'I');
});

test('the grammar reads standing, family facts and the company region; a fact it does not carry is refused', () => {
	const subject = personContext({
		employee: { marital_status: 'MARRIED', solo_parent: true, race: 'MALAY', religion: 'ISLAM' },
		employment: { hire_date: '2024-01-01' },
		terms: { residency_status: 'PERMANENT_RESIDENT', residency_since: '2025-02-15' },
		company: { region: 'I' },
		asOf: '2026-06-30'
	});
	assert.equal(subject.employee.residency_months, 16);
	for (const expression of [
		'employee.marital_status == "MARRIED"',
		'employee.solo_parent',
		'employee.race == "MALAY" || employee.religion == "ISLAM"',
		'employee.residency_months >= 12 && employee.residency_months < 24',
		'company.region == "I"'
	]) {
		assert.equal(compileEligibility(expression), null, expression);
		assert.equal(isEligible(expression, subject), true, expression);
	}
	// Unrecorded facts read as empty, false and zero: nothing is ever claimed by default.
	const blank = personContext({
		employee: null,
		employment: { hire_date: '' },
		terms: null,
		asOf: '2026-06-30'
	});
	assert.equal(isEligible('employee.solo_parent', blank), false);
	assert.equal(isEligible('employee.residency_months < 12', blank), true);
	assert.equal(isEligible('company.region == ""', blank), true);
	assert.match(
		compileEligibility('employee.spouse == "NONE"') ?? '',
		/employee\.spouse, which the person context does not carry/
	);
	assert.match(compileEligibility('company.name == "X"') ?? '', /company\.region/);
});

test('Leave preparation selects residency on terms and never requests the removed employee column', () => {
	const context = leaveContext();
	context.terms[0]!.residency_status = 'CITIZEN';
	const rows: Record<string, readonly unknown[]> = {
		employments: context.employments.map((row) => ({
			...row,
			effective_range: { start: row.hire_date, end: null }
		})),
		employees: context.employees,
		companies: context.companies,
		employment_terms: context.terms,
		jurisdiction_settings: context.versions,
		leave_catalogue: context.catalogues
	};
	const columns = new Map<string, Record<string, boolean>>();
	const db = new Proxy(
		{},
		{
			get: (_target, collection: string) => ({
				findMany: (query: { columns?: Record<string, boolean> }) => {
					columns.set(collection, query.columns ?? {});
					return Effect.succeed(rows[collection] ?? []);
				},
				findPending: () => Effect.succeed([])
			})
		}
	);
	const result = Effect.runSync(readLeaveContext({ db } as never, [id(1)]));
	assert.equal(result.terms[0]?.residency_status, 'CITIZEN');
	assert.equal(columns.get('employment_terms')?.residency_status, true);
	assert.equal(columns.get('employees')?.residency_status, undefined);
});

test('residency is entered on contract terms and is absent from the personal model and form', () => {
	assert.doesNotMatch(source('collections/employees/+model.ts'), /residency_status/);
	assert.doesNotMatch(
		source('collections/employees/+representation.svelte'),
		/name="residency_status"/
	);
	assert.match(
		source('collections/employment_terms/+model.ts'),
		/residency_status: enums\(\['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGNER'\]\)/
	);
	assert.match(
		source('collections/employment_terms/+representation.svelte'),
		/name="residency_status"/
	);
});
