/**
 * The scope a page's pickers are narrowed by: the version of the entity's lineage in force (catalogues) and the
 * entity's own people (employments). A form opened outside a scoped page narrows nothing rather than showing nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { employmentPicker, inForceCatalogue } from '../src/lib/ui/create-scope.ts';
import { inForceSettings } from '../src/lib/ui/settings-scope.ts';

test('a catalogue row is narrowed to the version of its lineage in force, through its settings relation', () => {
	assert.deepEqual(inForceCatalogue('PUB', '2026-03-10'), {
		settings_id: { is: inForceSettings('PUB', '2026-03-10') }
	});
	assert.deepEqual(inForceSettings('PUB', '2026-03-10').effective_range, {
		contains: '2026-03-10'
	});
});

test('an unscoped form narrows nothing; a scoped one narrows people to its entity', () => {
	assert.equal(inForceCatalogue(undefined), undefined);
	assert.equal(Object.hasOwn(employmentPicker(undefined), 'where'), false);
	assert.deepEqual(employmentPicker('c1').where, { company_id: { eq: 'c1' } });
});
