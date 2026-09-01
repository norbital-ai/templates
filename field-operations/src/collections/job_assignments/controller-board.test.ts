// @ts-nocheck -- the authored model intentionally exposes builder metadata only to the compiler.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assignmentModel from './+model.js';

const controllerSource = readFileSync(
	new URL('../../apps/+field_ops_controller.svelte', import.meta.url),
	'utf8'
);

test('the dispatch board search contract indexes the hook-owned job-title copy', () => {
	assert.equal(assignmentModel.columns.search_text.config.boltSearch, true);
	assert.equal(assignmentModel.columns.summary.config.boltSearch, true);

	// Search metadata may participate in the query, but it never replaces the related job title on
	// the visible card. Operators search the words they see rather than a hidden UUID or seed code.
	assert.match(controllerSource, /job:\s*job\.title/);
	assert.match(controllerSource, /search_text:\s*true/);
	const markup = controllerSource.slice(controllerSource.indexOf('</script>'));
	assert.doesNotMatch(markup, /search_text/);
});

test('date-dependent reads and the board query are derived from the selected day', () => {
	assert.match(
		controllerSource,
		/const dispatchQueryInstant = \$derived\(`\$\{dispatchDay\}T00:00:00\.000Z`\)/
	);
	assert.match(
		controllerSource,
		/const jobsQuery = \$derived\(\s*client\.db\.jobs\.findMany\(\{[\s\S]*?scheduled_for: \{ eq: dispatchQueryInstant \}/
	);
	assert.match(
		controllerSource,
		/columns: \{ id: true, site_id: true, title: true, nature: true \}/
	);
	assert.match(controllerSource, /columns: \{ id: true, name: true, location: true \}/);
	assert.match(
		controllerSource,
		/const assignmentsQuery = \$derived\(\s*client\.db\.job_assignments\.findMany\(\{[\s\S]*?job_assignment_job: \{ some: \{ scheduled_for: \{ eq: dispatchQueryInstant \} \} \}/
	);
	assert.match(
		controllerSource,
		/const boardQuery = \$derived\(\{\s*where: \{\s*job_assignment_job: \{ some: \{ scheduled_for: \{ eq: dispatchQueryInstant \} \} \}/
	);

	// The app owns no polling or duplicate client cache; generated findMany resources and the generic
	// collection surface remain the only data path.
	assert.doesNotMatch(controllerSource, /setInterval|setTimeout|\bpoll(?:ing)?\b/i);
});

test('the board delegates scrolling and warning accents to the generic collection surface', () => {
	assert.match(controllerSource, /<Bound size="full" pad="sm"/);
	assert.match(controllerSource, /<CollectionKanban[\s\S]*?query=\{boardQuery\}/);
	assert.match(
		controllerSource,
		/recordMetadata=\{\(assignment\) =>[\s\S]*?kind: 'flag'[\s\S]*?tone: 'warning'/
	);
});
