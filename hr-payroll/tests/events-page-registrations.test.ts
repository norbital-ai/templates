import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * HR20 for the pay-request surfaces, at the query-construction level.
 *
 * The Events group is five pages, one per request family, and each is one live query: the family's
 * own rows carrying the employment, the component and the capture that settled them. Employee
 * Self-Service is four more — the four families an ordinary rank is granted, and not the fifth.
 * The Settings Pay components tab is one table over the scoped company's catalogue. The headed
 * `sync.connect` count is the commit-4 gate; this pins the construction.
 *
 * The families are listed rather than looped over a directory read on purpose: a page that stops
 * being discovered is exactly the failure this file exists to catch, and a loop over whatever
 * happens to be on disk cannot see it.
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

/** Every family, and the page and capture junction that belong to it. */
const FAMILIES = [
	{ page: 'claims', collection: 'claim_requests', source: 'claim_request' },
	{ page: 'allowances', collection: 'allowance_requests', source: 'allowance_request' },
	{ page: 'bonuses', collection: 'bonus_requests', source: 'bonus_request' },
	{ page: 'arrears', collection: 'arrears_requests', source: 'arrears_request' },
	{ page: 'corrections', collection: 'correction_requests', source: 'correction_request' }
] as const;

for (const family of FAMILIES) {
	test(`the ${family.page} page is one table over ${family.collection}`, () => {
		const page = source(`../src/apps/hr_controller/events/+${family.page}.svelte`);
		assert.deepEqual(registrations(page), ['CollectionTable']);
		assert.match(page, new RegExp(`collection="${family.collection}"`));
		// The capture rides the row rather than opening a second subscription (B12).
		assert.match(
			page,
			new RegExp(
				`payslip_${family.source}_input_${family.source}: \\{ columns: \\{ period: true \\} \\}`
			),
			'the capture rides the request row'
		);
		// The catalogue is configuration and belongs to Settings, as it did before the split.
		assert.doesNotMatch(page, /collection="component_catalogue"/);
		// Nothing survives that names the collection the five families replaced.
		assert.doesNotMatch(page, /component_entr/);
	});
}

test('the Events group declares itself and lands on claims', () => {
	const group = source('../src/apps/hr_controller/events/+group.ts');
	assert.match(group, /label: 'Events'/);
	assert.match(group, /defaultChild: 'claims'/);
});

test('Employee Self-Service shows exactly the four families an employee is granted', () => {
	const page = source('../src/apps/+hr_employee.svelte');
	// The snippet holds nested `columns` snippets, so it is sliced to the next sibling instead.
	const start = page.indexOf('{#snippet claims()}');
	assert.ok(start >= 0, 'the claims tab exists');
	const tab = page.slice(start, page.indexOf('{#snippet loans()}', start));

	assert.deepEqual(registrations(tab), [
		'CollectionTable',
		'CollectionTable',
		'CollectionTable',
		'CollectionTable'
	]);
	for (const family of ['claim', 'allowance', 'bonus', 'arrears']) {
		assert.match(tab, new RegExp(`collection="${family}_requests"`), `${family} table`);
		assert.match(
			tab,
			new RegExp(
				`payslip_${family}_request_input_${family}_request: \\{ columns: \\{ period: true \\} \\}`
			),
			`${family} capture rides the row`
		);
	}
	// A claim is the one pay request an ordinary rank may raise, so it is the one table that creates.
	assert.equal(
		[...tab.matchAll(/features=\{\{ create: false \}\}/g)].length,
		3,
		'only the claims table offers create'
	);
	// No grant at all on corrections: a screen showing a collection the subject cannot read is a
	// bug. Matched on the surfaces that would read it rather than on the bare name, because the
	// tab's own comment says why the family is missing and that sentence must stay sayable.
	assert.doesNotMatch(page, /collection="correction_requests"/);
	assert.doesNotMatch(page, /client\.db\.correction_requests\b/);
	assert.doesNotMatch(page, /collection="component_entries"/);
	assert.doesNotMatch(page, /client\.db\.(component_entries|payslip_component_entry_inputs)\b/);
});

test('the Settings Components tab opens exactly one live query over the chosen version', () => {
	const page = source('../src/apps/hr_controller/+settings.svelte');
	const tab = snippet(page, 'catalogueComponents');
	assert.deepEqual(registrations(tab), ['CollectionTable']);
	assert.match(tab, /collection="component_catalogue"/);
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
