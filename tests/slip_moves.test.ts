/** "Mark selected paid" pays what it can and skips the slips already paid, never failing the batch. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { movable } from '../src/lib/ui/payroll/slip_moves.ts';

test('a move skips the slips already in its state or past it', () => {
	const status: Record<string, string> = { a: 'DRAFT', b: 'PAID', c: 'ON_HOLD' };
	const of = (id: string) => status[id];
	assert.deepEqual(movable('PAID', ['a', 'b', 'c'], of), ['a', 'c']);
	assert.deepEqual(movable('ON_HOLD', ['a', 'b', 'c'], of), ['a']);
	assert.deepEqual(movable('DRAFT', ['a', 'b', 'c'], of), ['c']);
});
