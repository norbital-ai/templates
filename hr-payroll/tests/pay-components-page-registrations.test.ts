import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * HR20 for the pay component surfaces, at the query-construction level.
 *
 * The Pay components app is the entry stream and opens one live query: the entries table, whose
 * rows carry the employment, the component and the capture that settled them. The Settings Pay
 * components tab is one table over the scoped company's catalogue. The headed `sync.connect`
 * count is the commit-4 gate; this pins the construction.
 */
const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

const registrations = (text: string): ReadonlyArray<string> => [
	...[...text.matchAll(/client\.db\.([a-z_]+)\.(findMany|findFirst)\(/g)].map(
		(match) => `db.${match[1]}.${match[2]}`
	),
	...[...text.matchAll(/client\.pending\.findMany\('([a-z_]+)'/g)].map(
		(match) => `pending.${match[1]}`
	),
	...[...text.matchAll(/<CollectionTable\b/g)].map(() => 'CollectionTable')
];

const snippet = (text: string, name: string): string => {
	const start = text.indexOf(`{#snippet ${name}()}`);
	assert.ok(start >= 0, `snippet ${name} exists`);
	const end = text.indexOf('{/snippet}', start);
	return text.slice(start, end);
};

test('the Pay components app is entries only and opens exactly one live query', () => {
	const page = source('../src/apps/hr_controller/+pay_components.svelte');
	assert.deepEqual(registrations(page), ['CollectionTable']);
	assert.match(
		page,
		/payslip_component_entry_input_component_entry:/,
		'the capture rides the entry row'
	);
	assert.doesNotMatch(page, /collection="pay_components"/, 'the catalogue is not on this page');
	assert.doesNotMatch(page, /ClaimSeasonality/);
});

test('the Settings Pay components tab opens exactly one live query over the chosen version', () => {
	const page = source('../src/apps/hr_controller/+settings.svelte');
	const tab = snippet(page, 'payComponents');
	assert.deepEqual(registrations(tab), ['CollectionTable']);
	assert.match(tab, /collection="pay_components"/);
	assert.match(tab, /settings_id: \{ eq: selectedVersion\.id \}/);
	for (const column of [
		'code',
		'nature',
		'is_statutory',
		'sequence',
		'eligibility',
		'contribution_treatments'
	])
		assert.match(tab, new RegExp(`name="${column}"`), `column ${column}`);
});
