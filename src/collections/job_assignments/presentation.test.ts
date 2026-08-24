import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = (relative: string): string =>
	readFileSync(new URL(relative, import.meta.url), 'utf8');

test('assignment suspicion UI is authority-gated and derives only from unresolved logs', () => {
	const assignment = source('./+representation.svelte');
	const controller = source('../../apps/+field_ops_controller.svelte');
	const contractor = source('../../apps/+field_ops_contractor.svelte');

	assert.match(assignment, /resource: 'suspicious_activity_logs'/);
	assert.match(assignment, /record != null && mayReadSuspicion/);
	assert.match(assignment, /where: \{ job_assignment_id: \{ eq: record\.id \} \}/);
	assert.match(assignment, /openSuspicionRows\[0\]/);
	assert.match(assignment, /icon="lucide:shield-alert"/);
	assert.doesNotMatch(assignment, /site_identity_(?:mismatch|unverified|rationale)/);
	assert.doesNotMatch(assignment, /status\s*===\s*['"]suspect['"]/);
	assert.doesNotMatch(contractor, /['"]suspect['"]/);
	assert.match(contractor, /features=\{\{ create: dispatchAuthority \}\}/);

	assert.match(controller, /suspiciousAssignmentIds\.has\(assignment\.id\)/);
	assert.doesNotMatch(controller, /firstOpenReasonByAssignmentId/);
	assert.doesNotMatch(controller, /assignment\.status\s*===\s*['"]suspect['"]/);
});

test('restricted facts and communication tabs are capability-gated with neutral empty copy', () => {
	const assignment = source('./+representation.svelte');
	const photo = source('../photo_evidence/+representation.svelte');

	assert.match(assignment, /resource: 'communication_logs'/);
	assert.match(assignment, /record != null && mayReadCommunication/);
	assert.match(assignment, /\.\.\.\(mayReadCommunication/);
	assert.match(assignment, /\.\.\.\(mayReadSuspicion/);
	assert.match(assignment, /component\.evidence_facts_empty/);
	assert.match(assignment, /component\.evidence_no_recorded_facts/);
	assert.doesNotMatch(assignment, /component\.integrity_passed/);
	assert.match(photo, /mayReadReviewFacts/);
});

test('standalone suspicion records expose create facts but not generic lifecycle fields', () => {
	const logs = source('../suspicious_activity_logs/+representation.svelte');

	assert.match(logs, /<Field name="reason"/);
	assert.doesNotMatch(logs, /<Field name="resolution"/);
	assert.doesNotMatch(logs, /<Field name="resolved_at"/);
	assert.doesNotMatch(logs, /<Field\s+[\s\S]*?name="resolved_by"/);
});
