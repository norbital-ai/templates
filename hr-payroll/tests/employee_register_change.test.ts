import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { registerChanged } from '../src/data/model/employee_profile/+model.ts';

describe('the register-change trigger', () => {
	const change = (
		before: { name?: string; address?: string; phone?: string; email?: string },
		after: { name?: string; address?: string; phone?: string; email?: string }
	) => ({ before, after });
	it('ignores contact details and counts a changed name or address', () => {
		assert.equal(
			registerChanged([change({ name: 'A', address: 'X', phone: '1' }, { name: 'A', address: 'X', phone: '2' })]).length,
			0
		);
		assert.equal(
			registerChanged([change({ name: 'A', address: 'X', email: 'a' }, { name: 'B', address: 'X', email: 'a' })]).length,
			1
		);
		assert.equal(
			registerChanged([change({ name: 'A', address: 'X' }, { name: 'A', address: 'Y' })]).length,
			1
		);
	});
	it('keeps one change per person', () => {
		const changes = [
			change({ name: 'A', address: 'X' }, { name: 'B', address: 'X' }),
			change({ name: 'C', address: 'X' }, { name: 'C', address: 'Y' })
		];
		assert.equal(registerChanged(changes).length, 2);
	});
});
