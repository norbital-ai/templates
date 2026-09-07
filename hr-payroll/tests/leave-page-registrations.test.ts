import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * HR20 for the three leave surfaces, at the query-construction level.
 *
 * A Svelte page cannot be mounted under Node, so this counts the live registrations each surface
 * constructs: every `client.db.<collection>.findMany|findFirst(`, every `client.pending.findMany(`
 * and every `<CollectionTable` (which registers its own query) in the source of the surface. The
 * headed count of `sync.connect` frames is the commit-4 gate; this test pins the construction so a
 * second query cannot creep back in unnoticed.
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

/** The text of one `{#snippet name()} … {/snippet}` block. */
const snippet = (text: string, name: string): string => {
	const start = text.indexOf(`{#snippet ${name}()}`);
	assert.ok(start >= 0, `snippet ${name} exists`);
	const end = text.indexOf('{/snippet}', start);
	return text.slice(start, end);
};

test('the controller Leave app opens exactly one live query: the requests table', () => {
	const page = source('../src/apps/hr_controller/+leave.svelte');
	assert.deepEqual(registrations(page), ['CollectionTable']);
	assert.match(page, /request_leave_entitlement:/, 'the balance rides the request row');
	assert.match(page, /entry_leave_entitlement:/, 'and so does its ledger');
	assert.match(page, /payslip_leave_request_input_leave_request:/, 'and so does the lock');
});

test('the Settings Leave catalogue entries tab opens exactly one live query over the chosen version', () => {
	const page = source('../src/apps/hr_controller/+settings.svelte');
	assert.deepEqual(registrations(snippet(page, 'catalogueLeaves')), ['CollectionTable']);
	assert.match(snippet(page, 'catalogueLeaves'), /settings_id: \{ eq: selectedVersion\.id \}/);
});

test('the employee leave tab reads its balances from one entitlements query carrying the ledger', () => {
	const page = source('../src/apps/+hr_employee.svelte');
	const script = page.slice(0, page.indexOf('</script>'));
	// The schedule tab's own request queries are not the leave tab's; everything else named
	// `leave_*` is. The balance panel is one live query; the requests table registers its own, and
	// held applications are proposals, which no `with` can reach. Three at mount; the headed gate in
	// commit 4 decides whether the table absorbs the panel.
	const leaveQueries = registrations(script).filter(
		(name) =>
			(name.startsWith('db.leave_') && !name.startsWith('db.leave_requests')) ||
			name === 'pending.leave_requests'
	);
	assert.deepEqual(leaveQueries, ['db.leave_entitlements.findMany', 'pending.leave_requests']);
	assert.equal(
		leaveQueries.filter((name) => name === 'db.leave_entitlements.findMany').length,
		1,
		'one entitlements query for the panel'
	);
	assert.ok(
		!registrations(script).includes('db.leave_entries.findMany'),
		'entries ride the entitlement'
	);
	assert.ok(
		!registrations(script).includes('db.leave_catalogue.findMany'),
		'leave codes ride the request rows'
	);
	assert.deepEqual(registrations(snippet(page, 'leave')), ['CollectionTable']);
});
