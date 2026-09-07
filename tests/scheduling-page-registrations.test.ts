/**
 * HR20 for the Scheduling app, at the query-construction level.
 *
 * The named pattern reaches the board through the terms query's `with`, never through a live
 * query of its own, and the Shift patterns tab is one `CollectionTable`. The whole list of the
 * page's registrations is pinned so a second read cannot creep back in unnoticed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const page = readFileSync(
	new URL('../src/apps/hr_controller/+scheduling.svelte', import.meta.url),
	'utf8'
);

const registrations = (text: string): ReadonlyArray<string> => [
	...[...text.matchAll(/client\.db\.([a-z_]+)\.(findMany|findFirst)\(/g)].map(
		(match) => `db.${match[1]}.${match[2]}`
	),
	...[...text.matchAll(/<CollectionTable\b/g)].map(() => 'CollectionTable')
];

/** The text of one `{#snippet name()} … {/snippet}` block, nested snippets included. */
const snippet = (text: string, name: string): string => {
	const start = text.indexOf(`{#snippet ${name}()}`);
	assert.ok(start >= 0, `snippet ${name} exists`);
	let depth = 0;
	const tag = /\{#snippet\b|\{\/snippet\}/g;
	tag.lastIndex = start;
	for (let match = tag.exec(text); match != null; match = tag.exec(text)) {
		depth += match[0] === '{/snippet}' ? -1 : 1;
		if (depth === 0) return text.slice(start, match.index);
	}
	throw new Error(`snippet ${name} never closes`);
};

test('the board opens no live query for shift patterns: the pattern rides the terms read', () => {
	const script = page.slice(0, page.indexOf('</script>'));
	assert.deepEqual(registrations(script), [
		'db.payroll_runs.findMany',
		'db.employments.findMany',
		'db.employees.findMany',
		'db.shift_definitions.findMany',
		'db.employment_terms.findMany',
		'db.leave_types.findMany',
		'db.work_days.findMany',
		'db.work_days.findMany',
		'db.leave_requests.findMany',
		'db.payslip_work_day_inputs.findMany',
		'db.company_holidays.findMany'
	]);
	assert.match(
		script,
		/with: \{ term_shift_pattern: \{ columns: \{ id: true, code: true, pattern: true \} \} \}/
	);
});

test('the Shift patterns tab opens exactly one live query: its table', () => {
	assert.deepEqual(registrations(snippet(page, 'patterns')), ['CollectionTable']);
	assert.match(snippet(page, 'patterns'), /collection="shift_patterns"/);
});
