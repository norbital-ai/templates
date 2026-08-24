import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import contractorPolicy from '../../access/policies/+field_ops_contractor.js';
import controllerPolicy from '../../access/policies/+field_ops_controller.js';
import suspicionAutomationPolicy from '../../access/policies/+suspicion_review_automation.js';
import whatsappPolicy from '../../access/policies/+field_ops_whatsapp.js';
import whatsappEnvoy from '../../envoys/+field_ops_whatsapp.js';

type Grant = { readonly fields?: readonly string[] };
type PolicyShape = {
	readonly grants: Readonly<Record<string, Readonly<Record<string, Grant>>>>;
};

const contractor = contractorPolicy as unknown as PolicyShape;
const controller = controllerPolicy as unknown as PolicyShape;
const whatsapp = whatsappPolicy as unknown as PolicyShape;
const suspicionAutomation = suspicionAutomationPolicy as unknown as PolicyShape;
const grant = (policy: PolicyShape, collection: string, action: string): Grant | undefined =>
	policy.grants[collection]?.[action];

test('contractor projections expose operational assignment and photo fields only', () => {
	assert.deepEqual(grant(contractor, 'job_assignments', 'read')?.fields, [
		'id',
		'job_id',
		'dispatched_at',
		'status',
		'completed_at',
		'amount_charged',
		'location',
		'summary'
	]);
	assert.deepEqual(grant(contractor, 'job_assignments', 'update')?.fields, [
		'status',
		'completed_at',
		'amount_charged',
		'location',
		'summary'
	]);
	assert.deepEqual(grant(contractor, 'photo_evidence', 'read')?.fields, [
		'id',
		'job_assignment_id',
		'variation_request_id',
		'photo',
		'summary'
	]);
	assert.deepEqual(grant(contractor, 'photo_evidence', 'create')?.fields, [
		'job_assignment_id',
		'variation_request_id',
		'photo'
	]);
});

test('private review collections have no contractor or WhatsApp grants', () => {
	for (const policy of [contractor, whatsapp]) {
		assert.equal(policy.grants.suspicious_activity_logs, undefined);
		assert.equal(policy.grants.suspicion_reviews, undefined);
	}
});

test('communication logs are immutable and scoped by surface', () => {
	assert.notEqual(grant(controller, 'communication_logs', 'read'), undefined);
	assert.notEqual(grant(controller, 'communication_logs', 'create'), undefined);
	assert.notEqual(grant(contractor, 'communication_logs', 'read'), undefined);
	assert.notEqual(grant(whatsapp, 'communication_logs', 'create'), undefined);

	for (const policy of [controller, contractor, whatsapp]) {
		assert.equal(grant(policy, 'communication_logs', 'update'), undefined);
		assert.equal(grant(policy, 'communication_logs', 'delete'), undefined);
	}
	assert.equal(grant(whatsapp, 'communication_logs', 'read'), undefined);
});

test('only the static review automation can mark assignments checked', () => {
	assert.deepEqual(grant(suspicionAutomation, 'job_assignments', 'update')?.fields, [
		'suspicion_checked_at'
	]);
	for (const human of [controller, contractor, whatsapp]) {
		assert.equal(
			grant(human, 'job_assignments', 'update')?.fields?.includes('suspicion_checked_at'),
			false
		);
	}
	assert.notEqual(grant(suspicionAutomation, 'suspicious_activity_logs', 'create'), undefined);
	assert.equal(grant(suspicionAutomation, 'suspicious_activity_logs', 'update'), undefined);
	assert.equal(grant(suspicionAutomation, 'suspicious_activity_logs', 'delete'), undefined);
});

test('WhatsApp is a no-app, no-delegation, existing-work surface', () => {
	assert.equal(whatsappEnvoy.delegation, 'disabled');
	assert.deepEqual(whatsappPolicy.capabilities?.apps, []);
	assert.equal(whatsappPolicy.capabilities?.envoyHistory, 'this_envoy');
	assert.deepEqual(grant(whatsapp, 'job_assignments', 'read')?.fields, [
		'id',
		'job_id',
		'dispatched_at',
		'status',
		'completed_at',
		'amount_charged',
		'location',
		'summary'
	]);
	assert.deepEqual(grant(whatsapp, 'job_assignments', 'update')?.fields, [
		'status',
		'completed_at',
		'location',
		'summary',
		'amount_charged'
	]);
	assert.deepEqual(grant(whatsapp, 'photo_evidence', 'create')?.fields, [
		'job_assignment_id',
		'photo',
		'source'
	]);
	assert.equal(grant(whatsapp, 'photo_evidence', 'read'), undefined);
	assert.equal(grant(whatsapp, 'job_assignments', 'create'), undefined);
	assert.equal(grant(whatsapp, 'job_assignments', 'delete'), undefined);
});

test('contractor-facing agent instructions do not disclose private review vocabulary', () => {
	const sharedPrompt = readFileSync(new URL('../../+agents.md', import.meta.url), 'utf8');
	const hiddenVocabulary = /suspici|integrity|site_identity|\bflags?\b/i;
	assert.doesNotMatch(sharedPrompt, hiddenVocabulary);
	assert.doesNotMatch(whatsappEnvoy.task, hiddenVocabulary);
	assert.match(whatsappEnvoy.task, /first mandatory action/i);
	assert.match(whatsappEnvoy.task, /messageId/);
	assert.match(whatsappEnvoy.task, /sentAt/);
});
