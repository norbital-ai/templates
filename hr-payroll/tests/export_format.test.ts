import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { employeeReference } from '../src/lib/export_format_configuration/export_format.ts';

describe('employee export reference', () => {
	it('formats the rolling number with the entity name in snake case', () => {
		assert.equal(
			employeeReference('HR-0001', 'Demo Singapore Pte. Ltd.'),
			'HR-0001-demo_singapore_pte_ltd'
		);
		assert.equal(employeeReference('CN0001', 'CN Demo'), 'HR-0001-cn_demo');
		assert.equal(employeeReference('HR-0042', ''), 'HR-0042');
	});
});
