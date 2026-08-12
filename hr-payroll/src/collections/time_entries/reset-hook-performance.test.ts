// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('bulk attendance validates synchronously in one authored batch hook', () => {
	const hooks = readFileSync(new URL('./+hooks.ts', import.meta.url), 'utf8');

	assert.match(hooks, /batchHandler: async \(\{ inputs \}\) =>/);
	assert.match(
		hooks,
		/for \(const input of inputs\) \{[\s\S]*?assertWorkedIntervals\(input\.worked_intervals, input\.break_minutes\);[\s\S]*?return inputs;/
	);
	assert.match(
		hooks,
		/handler: async \(\{ input \}\) => \{[\s\S]*?assertWorkedIntervals\(input\.worked_intervals, input\.break_minutes\);/
	);
});
