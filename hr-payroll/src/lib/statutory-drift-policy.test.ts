// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import hrController from '../access/policies/+hr_controller.ts';
import hrManager from '../access/policies/+hr_manager.ts';
import statutoryDriftAutomation from '../access/policies/+statutory_drift_automation.ts';

const actionsOn = (policy, collection) => Object.keys(policy.grants[collection] ?? {}).toSorted();

test('controllers can read but cannot rewrite statutory drift receipts', () => {
	assert.deepEqual(actionsOn(hrController, 'statutory_profile_drift_logs'), ['read']);
	assert.deepEqual(actionsOn(hrManager, 'statutory_profile_drift_logs'), ['read']);
});

test('one drift worker reads law and submits only approved employment successors', () => {
	for (const collection of ['jurisdictions', 'statutory_contributions', 'contribution_rates']) {
		assert.deepEqual(actionsOn(statutoryDriftAutomation, collection), ['read'], collection);
	}
	assert.deepEqual(actionsOn(statutoryDriftAutomation, 'employment_statutory_facts'), [
		'create',
		'read',
		'update'
	]);
	for (const action of ['create', 'update']) {
		const grant = statutoryDriftAutomation.grants.employment_statutory_facts[action];
		assert.equal(typeof grant.approval?.flow, 'function');
		assert.deepEqual(grant.approval?.superceded_by, ['Senior Management']);
	}
	assert.deepEqual(statutoryDriftAutomation.grants.employment_statutory_facts.create.fields, [
		'employment_id',
		'statutory_contribution_id',
		'status',
		'effective_range',
		'supersedes_fact_id'
	]);
	assert.deepEqual(statutoryDriftAutomation.grants.employment_statutory_facts.update.fields, [
		'effective_range'
	]);
	assert.deepEqual(actionsOn(statutoryDriftAutomation, 'statutory_profile_drift_logs'), [
		'create',
		'read',
		'update'
	]);
});
