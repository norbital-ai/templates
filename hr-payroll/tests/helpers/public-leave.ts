import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import type { LeaveEvent } from '../../src/datatypes/leave_event/+definition.ts';
import type { LeaveBalanceSummaries } from '../../src/lib/leave/summary.ts';
import type { LeavePreview, PreviewLeaveInput } from '../../src/lib/leave/preview.ts';
import {
	EMPLOYMENT_ID,
	ANNUAL_LEAVE_CATALOGUE_ID,
	startPublicSeedHost
} from './public-seed-host.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;

export const leaveTeamHeaders = (session: Session, team: string) => ({
	...bearerHeaders(session.credential),
	'x-colony-impersonated-team': team
});

export async function leaveBalances(session: Session, employmentId: string, asOf: string) {
	const response = await postGuestCommand(
		session.host.baseUrl,
		'invoke.leave_balances',
		{
			input: { employment_id: employmentId, as_of: asOf }
		},
		bearerHeaders(session.credential)
	);
	assert.equal(response.status, 200, JSON.stringify(response.value));
	return response.value as LeaveBalanceSummaries;
}

export async function leavePreview(session: Session, input: PreviewLeaveInput) {
	const response = await postGuestCommand(
		session.host.baseUrl,
		'invoke.preview_leave',
		{ input },
		bearerHeaders(session.credential)
	);
	assert.equal(response.status, 200, JSON.stringify(response.value));
	return response.value as LeavePreview;
}

export function createLeave(
	session: Session,
	options: {
		readonly id: string;
		readonly reference: string;
		readonly event: LeaveEvent;
		readonly employment_id?: string;
		readonly leave_catalogue_id?: string;
	},
	headers = bearerHeaders(session.credential)
) {
	return postGuestCommand(
		session.host.baseUrl,
		'collections.mutate',
		mutationPush(session.schemaFingerprint, {
			action: 'mutate',
			collection: 'leave_entries',
			rows: [
				{
					action: 'create',
					values: {
						employment_id: EMPLOYMENT_ID,
						leave_catalogue_id: ANNUAL_LEAVE_CATALOGUE_ID,
						...options
					}
				}
			]
		}),
		headers
	);
}

export async function approveLeave(session: Session, mutation: unknown) {
	requireAccepted(mutation, 'held Leave submission');
	const pending = asRecord(
		asRecord(mutation, 'Leave submission').pendingApproval,
		'Leave approval'
	);
	const requestId = String(pending.requestId);
	const headers = leaveTeamHeaders(session, 'HR Manager');
	const status = await postGuestCommand(
		session.host.baseUrl,
		'approvals.status',
		{ requestId },
		headers
	);
	const state = asRecord(status.value, 'Leave approval state');
	assert.equal(state._tag, 'Pending', JSON.stringify(state));
	const decided = await postGuestCommand(
		session.host.baseUrl,
		'approvals.decide',
		{ state, decision: 'approve' },
		headers
	);
	assert.equal(
		asRecord(decided.value, 'Leave decision')._tag,
		'Approved',
		JSON.stringify(decided.value)
	);
	const resumed = await postGuestCommand(
		session.host.baseUrl,
		'collections.resume',
		{ requestId },
		headers
	);
	assert.equal(resumed.status, 200, JSON.stringify(resumed.value));
	assert.deepEqual(resumed.value, { resumed: true, requestId });
	assert.equal(pending.collection, 'leave_entries');
	const stored = await session.query('select id, approval_id from leave_entries where id = $1', [
		pending.id
	]);
	assert.equal(stored.length, 1, 'approval commits the submitted Leave entry exactly once');
	assert.equal(stored[0].approval_id, null);
	return requestId;
}
