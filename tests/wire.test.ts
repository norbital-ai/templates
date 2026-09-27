// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from '../src/lib/wire.ts';

test('wire values read plain', () => {
	assert.deepEqual(
		plain({
			n: { $dec: '12.50' },
			d: { $d: '2026-01-31' },
			t: { $t: '2026-01-31T00:00:00Z' },
			j: [{ $dec: '1' }]
		}),
		{ n: 12.5, d: '2026-01-31', t: '2026-01-31T00:00:00Z', j: [1] }
	);
	assert.deepEqual(plain({ from: { $d: '2026-01-01' }, to: null }), {
		from: '2026-01-01',
		to: null
	});
	assert.equal(plain('PAYROLL-2026'), 'PAYROLL-2026');
});
