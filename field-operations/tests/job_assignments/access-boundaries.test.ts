import assert from 'node:assert/strict';
import test from 'node:test';
import contractorPolicy from '../../src/access/policies/+field_ops_contractor.js';
import controllerPolicy from '../../src/access/policies/+field_ops_controller.js';
import suspicionAutomationPolicy from '../../src/access/policies/+suspicion_review_automation.js';
import whatsappPolicy from '../../src/access/policies/+field_ops_whatsapp.js';
import whatsappEnvoy from '../../src/envoys/+field_ops_whatsapp.js';

type Grant = {
	readonly fields?: readonly string[];
	readonly where?: Readonly<Record<string, unknown>>;
};
type MutationGrant = {
	readonly new?: Grant;
	readonly existing?: Grant;
};
type CollectionGrants = {
	readonly read?: Grant;
	readonly mutate?: MutationGrant;
	readonly delete?: Grant;
};
type PolicyShape = {
	readonly grants: Readonly<Record<string, CollectionGrants>>;
};

const contractor = contractorPolicy as unknown as PolicyShape;
const controller = controllerPolicy as unknown as PolicyShape;
const whatsapp = whatsappPolicy as unknown as PolicyShape;
const suspicionAutomation = suspicionAutomationPolicy as unknown as PolicyShape;
const grant = (
	policy: PolicyShape,
	collection: string,
	action: 'read' | 'mutate.new' | 'mutate.existing' | 'delete'
): Grant | undefined => {
	const collectionGrants = policy.grants[collection];
	if (action === 'read' || action === 'delete') return collectionGrants?.[action];
	return collectionGrants?.mutate?.[action === 'mutate.new' ? 'new' : 'existing'];
};

test('read scopes are structured relation trees with no opaque SQL or manual dependencies', () => {
	for (const policy of [contractor, whatsapp, suspicionAutomation]) {
		for (const actions of Object.values(policy.grants)) {
			const read = actions.read;
			if (read === undefined) continue;
			assert.equal(Object.hasOwn(read, 'dependencies'), false);
			assert.notEqual(read.where?.kind, 'policy-sql');
		}
	}
	const subject = { $subject: 'id' };
	const ownAssignment = { assignee_user_id: { eq: subject } };
	assert.deepEqual(grant(contractor, 'sites', 'read')?.where, {
		site_jobs: { some: { job_assignment_job: { some: ownAssignment } } }
	});
	assert.deepEqual(grant(contractor, 'photo_evidence', 'read')?.where, {
		OR: [
			{ job_assignment_photo_evidence: { some: ownAssignment } },
			{
				variation_request_photo_evidence: {
					some: { job_assignment_variations: { some: ownAssignment } }
				}
			}
		]
	});
	assert.deepEqual(grant(suspicionAutomation, 'suspicious_activity_logs', 'read')?.where, {
		job_assignment_suspicions: { some: { suspicion_checked_at: { isNull: true } } }
	});
});

test('contractor projections expose operational assignment and photo fields only', () => {
	assert.deepEqual(grant(contractor, 'job_assignments', 'read')?.fields, [
		'id',
		'job_id',
		'dispatched_at',
		'status',
		'completed_at',
		'amount_charged',
		'location',
		'summary',
		'search_text'
	]);
	assert.deepEqual(grant(contractor, 'job_assignments', 'mutate.existing')?.fields, [
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
	assert.deepEqual(grant(contractor, 'photo_evidence', 'mutate.new')?.fields, [
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

test('communication logs are immutable and scoped by web surfaces', () => {
	assert.notEqual(grant(controller, 'communication_logs', 'read'), undefined);
	assert.notEqual(grant(controller, 'communication_logs', 'mutate.new'), undefined);
	assert.notEqual(grant(contractor, 'communication_logs', 'read'), undefined);

	for (const policy of [controller, contractor, whatsapp]) {
		assert.equal(grant(policy, 'communication_logs', 'mutate.existing'), undefined);
		assert.equal(grant(policy, 'communication_logs', 'delete'), undefined);
	}
	assert.equal(grant(whatsapp, 'communication_logs', 'read'), undefined);
});

test('only the static review automation can mark assignments checked', () => {
	assert.deepEqual(grant(suspicionAutomation, 'job_assignments', 'mutate.existing')?.fields, [
		'suspicion_checked_at'
	]);
	for (const human of [controller, contractor, whatsapp]) {
		assert.equal(
			grant(human, 'job_assignments', 'mutate.existing')?.fields?.includes('suspicion_checked_at'),
			false
		);
	}
	assert.notEqual(grant(suspicionAutomation, 'suspicious_activity_logs', 'mutate.new'), undefined);
	assert.equal(
		grant(suspicionAutomation, 'suspicious_activity_logs', 'mutate.existing'),
		undefined
	);
	assert.equal(grant(suspicionAutomation, 'suspicious_activity_logs', 'delete'), undefined);
});

test('controller mutations can carry the hook-owned search label through field authorization', () => {
	for (const action of ['mutate.new', 'mutate.existing'] as const) {
		assert.equal(
			grant(controller, 'job_assignments', action)?.fields?.includes('search_text'),
			true
		);
	}
});

test('WhatsApp can mutate only an existing assignment and has no other authority', () => {
	assert.equal(whatsappEnvoy.delegation, 'disabled');
	assert.deepEqual(whatsappPolicy.capabilities?.apps, []);
	assert.equal(whatsappPolicy.capabilities?.envoyHistory, 'this_envoy');
	assert.deepEqual(grant(whatsapp, 'job_assignments', 'mutate.existing')?.fields, [
		'status',
		'completed_at',
		'location',
		'summary',
		'amount_charged'
	]);
	assert.deepEqual(Object.keys(whatsapp.grants), ['job_assignments']);
	assert.deepEqual(Object.keys(whatsapp.grants.job_assignments ?? {}), ['mutate']);
	assert.deepEqual(Object.keys(whatsapp.grants.job_assignments?.mutate ?? {}), ['existing']);
	assert.equal(grant(whatsapp, 'job_assignments', 'mutate.new'), undefined);
});

test('contractor-facing WhatsApp envoy instructions do not disclose private review vocabulary', () => {
	const hiddenVocabulary = /suspici|integrity|site_identity|\bflags?\b/i;
	assert.doesNotMatch(whatsappEnvoy.task, hiddenVocabulary);
	assert.match(whatsappEnvoy.task, /cannot read, search, list or discover/i);
	assert.match(whatsappEnvoy.task, /cannot mutate new records or delete anything/i);
	assert.match(whatsappEnvoy.task, /only call mutate/i);
});
