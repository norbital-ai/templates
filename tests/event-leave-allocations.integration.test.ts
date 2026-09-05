import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import {
	ANNUAL_LEAVE_TYPE_ID,
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

test(
	'event allocations bound approved and pending leave, including concurrent requests',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('event-allocations');
		try {
			// Fixture setup: the public annual code now represents an event-based policy.
			await session.query('update leave_types set accrual = $1::jsonb where id = $2', [
				JSON.stringify({ kind: 'PER_EVENT' }),
				ANNUAL_LEAVE_TYPE_ID
			]);
			const manager = {
				...bearerHeaders(session.credential),
				'x-colony-impersonated-team': 'HR Manager'
			};
			const controller = {
				...bearerHeaders(session.credential),
				'x-colony-impersonated-team': 'HQ Payroll HR'
			};
			const second = await session.guestCommand(
				'identity.bootstrapFounder',
				{
					email: 'leave-owner@example.test',
					claimId: crypto.randomUUID()
				},
				'system'
			);
			assert.ok(second.status < 300, JSON.stringify(second.value));
			const secondCredential = String(asRecord(second.value, 'second HR user').credential);
			const secondController = {
				...bearerHeaders(secondCredential),
				'x-colony-impersonated-team': 'HQ Payroll HR'
			};
			await session.query(
				'update employees set email = $1 where id = (select employee_id from employments where id = $2)',
				['leave-owner@example.test', EMPLOYMENT_ID]
			);
			const employee = {
				...bearerHeaders(secondCredential),
				'x-colony-impersonated-team': 'Employee'
			};
			const create = (
				collection: string,
				values: Readonly<Record<string, unknown>>,
				headers = manager
			) =>
				postGuestCommand(
					session.host.baseUrl,
					'collections.mutate',
					mutationPush(session.schemaFingerprint, {
						action: 'mutate',
						collection,
						rows: [{ action: 'create', values }]
					}),
					headers
				);
			const allocationId = crypto.randomUUID();
			const allocation = {
				id: allocationId,
				employment_id: EMPLOYMENT_ID,
				leave_type_id: ANNUAL_LEAVE_TYPE_ID,
				event_reference: 'APPROVED-PARENT-PORTION-1',
				qualifying_date: '2026-04-01',
				starts_on: '2026-04-01',
				expires_on: '2027-03-31',
				allocated_days: 2,
				eligibility_evidence:
					'Fixture: HR verified this employee’s two workdays from the shared household allocation.'
			};
			const leave = (date: string, allocation_id: string | null = allocationId) => ({
				id: crypto.randomUUID(),
				employment_id: EMPLOYMENT_ID,
				leave_type_id: ANNUAL_LEAVE_TYPE_ID,
				allocation_id,
				event: {
					kind: 'TIME_OFF',
					range: { start: { date, half: 'FIRST' }, end: { date, half: 'SECOND' } },
					chargeable_days: null,
					reason: 'Event leave fixture'
				}
			});
			const missing = await create('leave_requests', leave('2026-04-20', null), controller);
			assert.match(JSON.stringify(missing.value), /approved allocation/i);
			const created = await create('leave_allocations', allocation);
			requireAccepted(created.value, 'approved event allocation');
			const bulkLeaves = ['2026-04-20', '2026-04-21', '2026-04-22'].map((date) => leave(date));
			const bulk = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(session.schemaFingerprint, {
					action: 'mutate',
					collection: 'leave_requests',
					rows: bulkLeaves.map((values) => ({ action: 'create', values }))
				}),
				controller
			);
			assert.match(JSON.stringify(bulk.value), /one leave request per employment/i);
			assert.equal(
				(
					await session.query('select id from leave_requests where id = any($1::uuid[])', [
						bulkLeaves.map((row) => row.id)
					])
				).length,
				0
			);
			assert.equal(
				(
					await session.query('select id from approval_request where record_id = any($1::text[])', [
						bulkLeaves.map((row) => row.id)
					])
				).length,
				0
			);
			const duplicate = await create('leave_allocations', {
				...allocation,
				id: crypto.randomUUID(),
				event_reference: allocation.event_reference.toLowerCase()
			});
			assert.notEqual(asRecord(duplicate.value, 'duplicate allocation').resolution, 'accepted');
			const first = await create('leave_requests', leave('2026-04-20'), controller);
			requireAccepted(first.value, 'first request');
			assert.ok(
				asRecord(first.value, 'first request').pendingApproval,
				'The request must be held for approval.'
			);
			const preview = await postGuestCommand(
				session.host.baseUrl,
				'invoke.preview_leave',
				{
					input: {
						employment_id: EMPLOYMENT_ID,
						leave_type_id: ANNUAL_LEAVE_TYPE_ID,
						allocation_id: allocationId,
						calendar_month: '2026-04'
					}
				},
				secondController
			);
			assert.equal(
				asRecord(preview.value, 'remaining after pending request').remaining_days,
				1,
				JSON.stringify(
					await session.query(
						"select record_id, action, status, proposed_values from approval_request where collection_name = 'leave_requests'"
					)
				)
			);
			const ownPreview = await postGuestCommand(
				session.host.baseUrl,
				'invoke.preview_leave',
				{
					input: {
						employment_id: EMPLOYMENT_ID,
						leave_type_id: ANNUAL_LEAVE_TYPE_ID,
						allocation_id: allocationId,
						calendar_month: '2026-04'
					}
				},
				employee
			);
			assert.equal(
				asRecord(ownPreview.value, 'employee pending balance').remaining_days,
				1,
				JSON.stringify(ownPreview)
			);
			const decide = async (requestId: string, decision: 'approve' | 'reject') => {
				const status = await postGuestCommand(
					session.host.baseUrl,
					'approvals.status',
					{ requestId },
					manager
				);
				const decided = await postGuestCommand(
					session.host.baseUrl,
					'approvals.decide',
					{ state: status.value, decision },
					manager
				);
				assert.ok(decided.status < 300, JSON.stringify(decided.value));
			};
			const firstApprovalId = String(
				asRecord(asRecord(first.value, 'first').pendingApproval, 'pending').requestId
			);
			await decide(firstApprovalId, 'approve');
			const deadline = Date.now() + 10_000;
			let applied = false;
			while (Date.now() < deadline) {
				const [state] = await session.query(
					'select applied_at from approval_request where id = $1',
					[firstApprovalId]
				);
				if (state.applied_at != null) {
					applied = true;
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			assert.equal(
				applied,
				true,
				'Approving the request must commit it without counting its own reservation twice.'
			);
			const rivals = await Promise.all(
				['2026-04-21', '2026-04-22'].map((date) =>
					create(
						'leave_requests',
						leave(date),
						date === '2026-04-21' ? controller : secondController
					)
				)
			);
			assert.equal(
				rivals.filter((result) => asRecord(result.value, 'rival request').resolution === 'accepted')
					.length,
				1,
				JSON.stringify(rivals)
			);
			const used = await create('leave_requests', leave('2027-01-04'), controller);
			assert.match(JSON.stringify(used.value), /available after approved and pending/);
			const held = rivals.find(
				(result) => asRecord(result.value, 'rival').resolution === 'accepted'
			);
			assert.ok(held);
			await decide(
				String(asRecord(asRecord(held.value, 'held').pendingApproval, 'pending').requestId),
				'reject'
			);
			const released = await create('leave_requests', leave('2027-01-04'), controller);
			requireAccepted(
				released.value,
				'rejected reservation releases its allowance across leave years'
			);
		} finally {
			await session.stop();
		}
	}
);
