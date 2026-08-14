// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('pre-charged seed leave skips the roster reload on createMany', () => {
	const hooks = readFileSync(new URL('./+hooks.ts', import.meta.url), 'utf8');

	assert.match(hooks, /function isSeedNormalizedTimeOff\(event: TimeOffEvent\): boolean/);
	assert.match(
		hooks,
		/if \(timeOffInputs\.every\(\(input\) => isSeedNormalizedTimeOff\(input\.event as TimeOffEvent\)\)\) \{\s*return inputs;/
	);
	assert.match(hooks, /handler: async \(\{ input, api \}\) => \{[\s\S]*?normalizedTimeOff\(/);
});
