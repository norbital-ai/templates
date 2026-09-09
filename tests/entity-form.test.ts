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
		'name',
		'pay_cutoff_day',
		'pay_frequency',
		'region',
		'registration_number',
		'risk_class',
		'settings_code'
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
		'cloned_from_id',
		'code',
		'currency',
		'effective_range',
		'holiday_source',
		'jurisdiction_code',
		'minimum_wages',
		'name',
		'research_notes',
		'research_urls',
		'sealed_at',
		'tax_year_start_month',
		'void_reason',
		'voided_at'
	]);
	for (const hidden of [
		'sealed_at',
		'voided_at',
		'void_reason',
		'cloned_from_id',
		'research_notes',
		'holiday_source'
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
	for (const tab of ['contributions', 'catalogueLeaves', 'catalogueWork', 'catalogueTable'])
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
	assert.match(snippet(settings, 'holidays'), /<HolidaySettings version=\{selectedVersion\}/);
	// The Holidays tab is one table over the jurisdiction's holidays; its imports are pipelines.
	const holidays = source('../src/lib/ui/holiday-settings.svelte');
	assert.deepEqual(registrations(holidays), ['CollectionTable']);
	assert.match(holidays, /jurisdiction_code: \{ eq: jurisdictionCode \}/);
	// The source is the version's own column, set under General as a form over the version.
	assert.match(snippet(settings, 'payroll'), /<HolidaySourceForm version=\{selectedVersion\}/);
	const sourceForm = source('../src/lib/ui/holiday-source-form.svelte');
	assert.deepEqual(registrations(sourceForm), []);
	// One-column write, like the seal: a whole-row form would carry sealed_at into approval.
	assert.match(
		sourceForm,
		/client\.db\.jurisdiction_settings\.mutate\(\[\{ id: version\.id, holiday_source: sourceDraft \}\]\)/
	);
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
