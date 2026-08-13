// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('employee profile presents terms inline instead of mounting a separate terms table', async () => {
	const representation = await readFile(
		new URL('./+representation.svelte', import.meta.url),
		'utf8'
	);

	assert.match(representation, /employmentScheduleOn\(\s*termsByEmployment\.get\(/);
	assert.match(representation, /contentPadding=\{false\}/);
	assert.doesNotMatch(representation, /collection="employment_terms"/);
	assert.doesNotMatch(representation, /\{@render terms\(\)\}/);
});
