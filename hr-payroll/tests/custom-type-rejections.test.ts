/**
 * A custom field refuses what its value schema refuses: the literal shape carries the structure, and `validate`
 * runs the refinements (codes, CEL, tagged arms, list items) the shape cannot state.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import codeList from '../src/data/custom_field/code_list/+definition.ts';
import catalogueBand from '../src/data/custom_field/catalogue_band/+definition.ts';
import payslipBase from '../src/data/custom_field/payslip_base/+definition.ts';
import prorationBasis from '../src/data/custom_field/proration_basis/+definition.ts';
import workPattern from '../src/data/custom_field/work_pattern/+definition.ts';

test('custom fields refuse what their value schema refuses', () => {
	assert.equal(codeList.check?.(['CPF.ADDITIONAL', 'EPF']), undefined);
	assert.ok(codeList.check?.(['bad code']));
	assert.equal(catalogueBand.check?.([{ when: '', amount: '10.0', limit: null }]), undefined);
	assert.ok(catalogueBand.check?.([{ when: 'nonsense ((', amount: '10.0', limit: null }]));
	// a list-valued field checks every entry
	assert.equal(payslipBase.check?.([{ component_code: 'BASE', amount: 1 }]), undefined);
	assert.ok(payslipBase.check?.([{ component_code: '', amount: 1 }]));
	assert.ok(prorationBasis.check?.({ by: 'FIXED_DAYS', days: 0 }));
	// an untagged union admits exactly one member
	assert.ok(workPattern.check?.({ days: [], expectation: null }));
});
