// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A successor version is a clone of every child row (`src/lib/settings_clone.ts` copies each
 * stored column), written through the nested create contract of `jurisdiction_settings`. A
 * column the contract omits is silently dropped from every successor — `counts_toward` added
 * to the class models and left off the contract would have sealed a version whose allowances
 * entered no base. So the contract is enumerated against the models, not listed by hand.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import collection from '../src/collections/jurisdiction_settings/+collection.ts';
import contributions from '../src/collections/statutory_contributions/+model.ts';
import leave from '../src/collections/leave_catalogue/+model.ts';
import loans from '../src/collections/loan_catalogue/+model.ts';
import claims from '../src/collections/claim_catalogue/+model.ts';
import adhoc from '../src/collections/adhoc_catalogue/+model.ts';
import allowances from '../src/collections/allowance_catalogue/+model.ts';

const CHILDREN = {
	contribution_settings: contributions,
	leave_catalogue_settings: leave,
	loan_catalogue_settings: loans,
	claim_catalogue_settings: claims,
	adhoc_catalogue_settings: adhoc,
	allowance_catalogue_settings: allowances
};

test('the version clone contract accepts every authored column of every child model', () => {
	const contract = collection.create.input.with;
	assert.deepEqual(Object.keys(contract).sort(), Object.keys(CHILDREN).sort());
	for (const [relation, model] of Object.entries(CHILDREN)) {
		const authored = Object.keys(model.columns).filter((column) => column !== 'settings_id');
		const accepted = Object.keys(contract[relation].create.columns);
		assert.deepEqual(accepted.sort(), authored.sort(), relation);
	}
});
