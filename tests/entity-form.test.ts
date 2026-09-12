import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * HR22 and HR20 for the entity surfaces, at the construction level.
 *
 * The company form is one section of six facts and nothing else; the risk class is registered
 * hidden unless the jurisdiction levies a risk-keyed scheme. The Entities page and each Settings
 * tab open one live query.
 */
const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

const fieldNames = (text: string): ReadonlyArray<string> =>
	[...text.matchAll(/<Field\s[^>]*?name="([a-z_]+)"/gs)].map((match) => match[1]!).toSorted();

const registrations = (text: string): ReadonlyArray<string> => [
	...[...text.matchAll(/client\.db\.([a-z_]+)\.(findMany|findFirst)\(/g)].map(
		(match) => `db.${match[1]}.${match[2]}`
	),
	...[...text.matchAll(/<CollectionTable\b/g)].map(() => 'CollectionTable')
];

const snippet = (text: string, name: string): string => {
	const start = text.indexOf(`{#snippet ${name}(`);
	assert.ok(start >= 0, `snippet ${name} exists`);
	const end = text.indexOf('{/snippet}', start);
	return text.slice(start, end);
};

test('the company form is name, registration, settings lineage, cutoff day, pay frequency, risk class and period', () => {
	const form = source('../src/collections/companies/+representation.svelte');
	assert.deepEqual(fieldNames(form), [
		'effective_range',
		'holiday_source',
		'name',
		'pay_cutoff_day',
		'pay_frequency',
		'region',
		'registration_number',
		'risk_class',
		'settings_code',
		'workbook_layout'
	]);
	for (const gone of [
		'jurisdiction_id',
		'pay_day',
		'pay_calendar',
		'leave_year_start_month',
		'overtime_calculation_method',
		'settlement_policy',
		'absence_component_id'
	])
		assert.doesNotMatch(form, new RegExp(gone), `${gone} is not on the form`);
	assert.match(
		form,
		/name="risk_class"[^>]*hidden=\{!riskKeyed\}/s,
		'risk class only where a scheme is keyed by it'
	);
	assert.match(
		form,
		/band\.selector\?\.by === 'RISK_CLASS'/,
		"keyed by the lineage schemes' bands, not by a country name"
	);
	assert.match(
		form,
		/contribution_settings: \{ some: onLineage\(record\.settings_code\) \}/,
		'the risk-keyed scheme is looked up through the settings lineage'
	);
});

test('the settings form declares lineage and jurisdiction identity while Work owns payroll rules', () => {
	const form = source('../src/collections/jurisdiction_settings/+representation.svelte');
	assert.deepEqual(fieldNames(form), [
		'change_summary',
		'cloned_from_id',
		'code',
		'currency',
		'effective_range',
		'jurisdiction_code',
		'minimum_wages',
		'name',
		'research_notes',
		'research_urls',
		'sealed_at',
		'tax_year_start_month',
		'utc_offset_minutes',
		'void_reason',
		'voided_at'
	]);
	for (const hidden of [
		'sealed_at',
		'voided_at',
		'void_reason',
		'cloned_from_id',
		'research_notes'
	])
		assert.match(form, new RegExp(`<Field name="${hidden}" hidden />`), `${hidden} is hidden`);
	assert.match(form, /disabled=\{sealed\}/, 'a sealed version renders read-only');
	for (const gone of [
		'lifecycle',
		'supersedes_id',
		'successor_profile_id',
		'revision',
		'ordinary_rate_basis'
	])
		assert.doesNotMatch(form, new RegExp(gone), `${gone} is not on the form`);
});

test('the Entities page opens one live query and the Settings page one per surface', () => {
	assert.deepEqual(registrations(source('../src/apps/hr_controller/+entities.svelte')), [
		'CollectionTable'
	]);
	const settings = source('../src/apps/hr_controller/+settings.svelte');
	const script = settings.slice(0, settings.indexOf('</script>'));
	assert.deepEqual(
		registrations(script),
		['db.jurisdiction_settings.findMany'],
		'the page is one query over the lineage'
	);
	assert.match(script, /where: onLineage\(code\)/, "scoped by the entity's settings code");
	for (const tab of ['contributions', 'catalogueLeaves', 'catalogueTable'])
		assert.deepEqual(registrations(snippet(settings, tab)), ['CollectionTable'], tab);
	// Work is one catalogue with three tables behind a tab strip: its rules, the roster codes and
	// the named patterns — the vocabulary is the lineage's, so it lives here rather than on the
	// scheduling board it serves.
	const workTab = snippet(settings, 'catalogueWork');
	assert.match(workTab, /<Tabs\b/);
	assert.deepEqual(registrations(workTab), []);
	for (const tab of ['workRules', 'rosterCodes', 'shiftPatterns'])
		assert.deepEqual(registrations(snippet(settings, tab)), ['CollectionTable'], tab);
	for (const [tab, collection] of [
		['catalogueClaims', 'claim_catalogue'],
		['catalogueAllowances', 'allowance_catalogue'],
		['cataloguePayments', 'payment_catalogue'],
		['catalogueLoans', 'loan_catalogue']
	]) {
		assert.deepEqual(registrations(snippet(settings, tab!)), [], tab);
		assert.match(snippet(settings, tab!), new RegExp(`catalogueTable\\(\\s*'${collection}'`));
	}
	// Holidays are the entity's, so the Settings app — which is scoped by jurisdiction lineage —
	// carries no Holidays tab at all. Both surfaces live on the entity representation.
	assert.equal(settings.includes('HolidaySettings'), false, 'holidays left the Settings app');
	assert.equal(settings.includes('HolidaySourceForm'), false, 'so did the entity’s Google source');
	const entity = source('../src/collections/companies/+representation.svelte');
	assert.match(entity, /<HolidaySettings company=\{record!\}/);
	assert.equal(
		entity.includes('HolidaySourceForm'),
		false,
		'the Google source is the country calendar, not an entity form'
	);
	// The record shell owns the tab strip and its insets; the representation supplies the config.
	assert.match(entity, /<RecordShell[\s\S]*?tabs=/);
	// The Holidays tab is one table over the entity's holidays, a year at a time; imports are pipelines.
	const holidays = source('../src/lib/ui/holiday-settings.svelte');
	assert.deepEqual(registrations(holidays), ['CollectionTable']);
	assert.match(holidays, /company_id: \{ eq: companyId \}/);
	assert.match(holidays, /date: \{ gte: yearRange\.start, lte: yearRange\.end \}/);
	assert.deepEqual(
		registrations(snippet(settings, 'payroll')),
		[],
		'the form is the representation'
	);
	for (const gone of [
		'data-settings-timeline',
		'data-settings-seal',
		'data-settings-void',
		'data-settings-new-version'
	])
		assert.doesNotMatch(settings, new RegExp(gone), `${gone} is no longer on the page`);
	assert.doesNotMatch(settings, /statutory_research_sources|researchSources|jurisdictions\b/);
});

test('the Changes tab compares two snapshots and reads each catalogue by version', () => {
	const page = source('../src/apps/hr_controller/+settings.svelte');
	assert.match(page, /content: changes/, 'the tab is wired');
	assert.match(
		snippet(page, 'changes'),
		/<SnapshotChanges code=\{selectedVersion\.code\}/,
		'the surface owns its own reads'
	);
	const changes = source('../src/apps/hr_controller/SnapshotChanges.svelte');
	assert.deepEqual(registrations(changes), [
		'db.statutory_contributions.findMany',
		'db.work_catalogue.findMany',
		'db.leave_catalogue.findMany',
		'db.claim_catalogue.findMany',
		'db.allowance_catalogue.findMany',
		'db.payment_catalogue.findMany',
		'db.loan_catalogue.findMany'
	]);
	assert.match(changes, /settings_id = \{ in: \[baseVersion\.id, compareVersion\.id\] \}/);
	assert.match(changes, /diffCollection\(collection, previous, proposed\)/);
	assert.match(changes, /diffSettingsRoot\(baseVersion, compareVersion\)/);
	assert.match(changes, /snapshotId\(code, versions, offset\)/, 'snapshots are CODE_INDEX');
});

/**
 * P6 of the HR family simplification: the contract forms are sections, their pickers read the
 * page's scope, and the columns only a hook or a flow may write are never offered.
 */
const sectionTitles = (text: string): ReadonlyArray<string> =>
	[...text.matchAll(/<FormSection[^>]*?title=\{t\('([a-z_.]+)'\)\}/gs)].map((match) => match[1]!);

test('the terms form is Pay, Standing, Organisation and Period, scoped to the entity', () => {
	const form = source('../src/collections/employment_terms/+representation.svelte');
	assert.deepEqual(fieldNames(form), [
		'base_salary',
		'department',
		'effective_range',
		'employment_id',
		'employment_id',
		'employment_type',
		'grade',
		'job_title',
		'pay_frequency',
		'payroll_group',
		'residency_since',
		'residency_status',
		'shift_pattern_id',
		'statutory_work_category',
		'work_classification'
	]);
	assert.deepEqual(sectionTitles(form), [
		'component.terms_section_pay',
		'component.standing',
		'component.terms_section_organisation',
		'component.section_period'
	]);
	assert.match(form, /hrCreateScope\(\)/, 'the form reads the create scope');
	assert.match(form, /employmentRelationOptions\(scopedCompanyId\)/, "people are the entity's own");
	assert.match(
		form,
		/\{#if scopedEmploymentId != null\}\s*<Field name="employment_id" hidden \/>/,
		'a scope naming the employment prefills and hides it'
	);
	assert.match(
		form,
		/where: \{ company_id: \{ eq: scopedCompanyId \} \}/,
		"patterns are the entity's own"
	);
	assert.match(form, /name="department" label=\{t\('component\.department'\)\}/);
	assert.doesNotMatch(form, /<Field name="[a-z_]+" \/>/, 'every label is set');
});

test('the statutory fact form is Scheme, Registration and Period; the successor pointer is hook-owned', () => {
	const form = source('../src/collections/employment_statutory_facts/+representation.svelte');
	assert.deepEqual(fieldNames(form), [
		'effective_range',
		'employment_id',
		'employment_id',
		'status',
		'statutory_contribution_id',
		'supersedes_fact_id'
	]);
	assert.deepEqual(sectionTitles(form), [
		'component.fact_section_scheme',
		'component.registration',
		'component.section_period'
	]);
	assert.match(form, /<Field name="supersedes_fact_id" hidden \/>/);
	assert.match(form, /hrCreateScope\(\)/);
	assert.match(form, /employmentRelationOptions\(scopedCompanyId\)/);
	// The scheme picker reaches the version through its relation, under a quantifier, and only
	// when the page names a lineage; unscoped it offers every scheme rather than none.
	assert.match(
		form,
		/scopedSettingsCode == null\s*\?\s*undefined\s*:\s*\{ contribution_settings: \{ some: inForceSettings\(scopedSettingsCode, todayKey\(\)\) \} \}/s
	);
	assert.match(form, /\.\.\.\(inForceSchemes == null \? \{\} : \{ where: inForceSchemes \}\)/);
});

test('the person form is Person, Standing and Family; the face lifecycle is written by the enrolment flow only', () => {
	const profile = source('../src/collections/employees/+representation.svelte');
	const form = snippet(profile, 'person');
	for (const hidden of [
		'user_id',
		'face_embedding',
		'face_photo',
		'face_enrollment_status',
		'face_consent_at',
		'face_enrolled_at',
		'face_last_match_at',
		'face_match_count'
	])
		assert.match(form, new RegExp(`<Field name="${hidden}" hidden />`), `${hidden} is hidden`);
	assert.deepEqual(sectionTitles(form), [
		'component.person',
		'component.standing',
		'component.family_section'
	]);
	assert.match(form, /<Stack gap="lg">\s*<FormSection/, 'no field sits outside a section');
	// The profile scopes the forms its tables open: one contract is prefilled, the entity narrows
	// the pickers, and the lineage narrows the scheme picker.
	assert.match(profile, /setContext<HrCreateScope>\(HR_CREATE_SCOPE, \{/);
	assert.match(profile, /employmentId: \(\) => scopedEmployment\?\.id/);
	assert.match(profile, /client\.db\.companies\.findFirst\(\{/);
	assert.match(profile, /settingsCode: \(\) => scopedCompanyQuery\?\.current\?\.settings_code/);
	// Nothing on the client writes the lifecycle columns but the enrolment flow.
	for (const path of ['../src/collections/employees/+representation.svelte'])
		assert.doesNotMatch(
			source(path).replace(/<Field name="face_[a-z_]+" hidden \/>/g, ''),
			/face_(enrollment_status|consent_at|enrolled_at|last_match_at|match_count)\s*:/,
			`${path} does not write the face lifecycle`
		);
});
