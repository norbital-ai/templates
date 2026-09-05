// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import hrController from '../src/access/policies/+hr_controller.ts';
import hrManager from '../src/access/policies/+hr_manager.ts';
import statutoryDriftAutomation from '../src/access/policies/+statutory_drift_automation.ts';

const grantsOn = (policy, collection) =>
	Object.entries(policy.grants[collection] ?? {})
		.flatMap(([operation, grant]) =>
			operation === 'mutate' ? Object.keys(grant).map((phase) => `mutate.${phase}`) : [operation]
		)
		.toSorted();

test('controllers can read but cannot rewrite statutory drift receipts', () => {
	assert.deepEqual(grantsOn(hrController, 'statutory_profile_drift_logs'), ['read']);
	assert.deepEqual(grantsOn(hrManager, 'statutory_profile_drift_logs'), ['read']);
});

test('drift worker submits law and employment successors behind HR approval', () => {
	for (const collection of ['statutory_contributions', 'contribution_rates']) {
		assert.deepEqual(grantsOn(statutoryDriftAutomation, collection), ['read'], collection);
	}
	assert.deepEqual(grantsOn(statutoryDriftAutomation, 'jurisdictions'), ['mutate.new', 'read']);
	assert.equal(
		typeof statutoryDriftAutomation.grants.jurisdictions.mutate.new.approval.flow,
		'function'
	);
	assert.deepEqual(grantsOn(statutoryDriftAutomation, 'employment_statutory_facts'), [
		'mutate.existing',
		'mutate.new',
		'read'
	]);
	for (const phase of ['new', 'existing']) {
		const grant = statutoryDriftAutomation.grants.employment_statutory_facts.mutate[phase];
		assert.equal(typeof grant.approval?.flow, 'function');
		assert.deepEqual(grant.approval?.superceded_by, ['Senior Management']);
	}
	assert.deepEqual(statutoryDriftAutomation.grants.employment_statutory_facts.mutate.new.fields, [
		'employment_id',
		'statutory_contribution_id',
		'status',
		'effective_range',
		'supersedes_fact_id'
	]);
	assert.deepEqual(
		statutoryDriftAutomation.grants.employment_statutory_facts.mutate.existing.fields,
		['effective_range']
	);
	assert.deepEqual(grantsOn(statutoryDriftAutomation, 'statutory_profile_drift_logs'), [
		'mutate.existing',
		'mutate.new',
		'read'
	]);
});
