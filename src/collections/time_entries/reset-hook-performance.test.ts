// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('bulk attendance validates synchronously in one authored batch hook', () => {
	const hooks = readFileSync(new URL('./+hooks.ts', import.meta.url), 'utf8');

	// The batch hook stays synchronous: no db access, so a 40-row seed slice costs no round trips.
	// The single create and update handlers may query (leave coverage, settled windows) because
	// interactive edits are one row at a time.
	assert.match(hooks, /batchHandler: \(\{ inputs \}\) =>/);
	assert.match(
		hooks,
		/for \(const input of inputs\) \{[\s\S]*?assertWorkedIntervals\(input\.worked_intervals, input\.break_minutes\);[\s\S]*?return inputs;/
	);
	assert.match(
		hooks,
		/handler: \(\{ input(?:, api)? \}\) =>[\s\S]*?assertWorkedIntervals\(input\.worked_intervals, input\.break_minutes\);/
	);
});
