import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand
} from '@norbital-ai/test-utilities';
import {
	EMPLOYMENT_ID,
	EVENT_LEAVE_TYPE_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const eventValues = (id: string, eventReference: string, allocationUnits: number) => ({
	id,
	employment_id: EMPLOYMENT_ID,
	leave_type_id: EVENT_LEAVE_TYPE_ID,
	account_kind: 'EVENT',
	event_reference: eventReference,
	qualifying_date: '2026-05-01',
	statutory_cohort_date: '2026-05-01',
	starts_on: '2026-05-01',
	ends_on: '2027-04-30',
	allocation_units: allocationUnits,
	weekly_index: 5,
	eligibility_evidence: 'Public fixture birth and household allocation review'
});

test(
	'controller approval lands one event account and its opening ledger entry',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-event-leave-approval');
		try {
			const controllerHeaders = {
				...bearerHeaders(session.credential),
				'x-colony-impersonated-team': 'HQ Payroll HR'
			};
			const managerHeaders = {
				...bearerHeaders(session.credential),
				'x-colony-impersonated-team': 'HR Manager'
			};
			const accountId = crypto.randomUUID();
			const created = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(session.schemaFingerprint, {
					action: 'mutate',
					collection: 'leave_accounts',
					rows: [
						{
							action: 'create',
							values: eventValues(accountId, 'PUBLIC-CHILD-2026', 4)
						}
					]
				}),
				controllerHeaders
			);
			const payload = asRecord(created.value, 'event account create');
			assert.equal(
				payload.resolution,
				'accepted',
				`controller create ${created.status}: ${JSON.stringify(created.value)}`
			);
			const approval = asRecord(payload.pendingApproval, 'event account approval');
			const requestId = String(approval.requestId);
			assert.equal(
				(await session.query('select id from leave_accounts where id = $1', [accountId])).length,
				0,
				'a pending proposal must not be a usable entitlement account'
			);

			const status = await postGuestCommand(
				session.host.baseUrl,
				'approvals.status',
				{ requestId },
				managerHeaders
			);
			const state = asRecord(status.value, 'event account approval state');
			assert.equal(state._tag, 'Pending', JSON.stringify(status.value));
			const decided = await postGuestCommand(
				session.host.baseUrl,
				'approvals.decide',
				{ state: { requestId: state.requestId }, decision: 'approve' },
				managerHeaders
			);
			assert.equal(
				asRecord(decided.value, 'event account decision')._tag,
				'Approved',
				JSON.stringify(decided.value)
			);

			const loadAccount = () =>
				session.query(
					`select id, account_kind, event_reference, allocation_units, weekly_index, entitlement_days
					 from leave_accounts where id = $1`,
					[accountId]
				);
			let accounts = await loadAccount();
			if (accounts.length === 0) {
				const resumed = await postGuestCommand(
					session.host.baseUrl,
					'collections.resume',
					{ requestId },
					managerHeaders
				);
				const alreadyLanded =
					resumed.status === 422 &&
					JSON.stringify(resumed.value).includes('identity is already in use');
				assert.ok(
					(resumed.status >= 200 && resumed.status < 300) || alreadyLanded,
					`collections.resume ${resumed.status}: ${JSON.stringify(resumed.value)}`
				);
				accounts = await loadAccount();
			}
			assert.equal(accounts.length, 1, JSON.stringify(accounts));
			const account = asRecord(accounts[0], 'event account');
			assert.equal(account.account_kind, 'EVENT');
			assert.equal(account.event_reference, 'PUBLIC-CHILD-2026');
			assert.equal(Number(account.allocation_units), 4);
			assert.equal(Number(account.weekly_index), 5);
			assert.equal(Number(account.entitlement_days), 20);

			const deadline = Date.now() + 5_000;
			let entries = await session.query(
				`select kind, effective_on, days, source_key
				 from leave_entries where leave_account_id = $1`,
				[accountId]
			);
			while (entries.length === 0 && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 25));
				entries = await session.query(
					`select kind, effective_on, days, source_key
					 from leave_entries where leave_account_id = $1`,
					[accountId]
				);
			}
			if (entries.length !== 1) {
				const tasks = await session.query(
					`select * from bolt_task order by created_at desc limit 5`
				);
				assert.equal(
					entries.length,
					1,
					`entries ${JSON.stringify(entries)}; tasks ${JSON.stringify(tasks)}`
				);
			}
			const entry = asRecord(entries[0], 'event opening entry');
			assert.equal(entry.kind, 'OPENING_ENTITLEMENT');
			assert.equal(Number(entry.days), 20);
			assert.equal(entry.source_key, 'event-opening');
		} finally {
			await session.stop();
		}
	}
);

test(
	'concurrent proposals cannot over-allocate one household event',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-event-leave-race');
		try {
			const headers = {
				...bearerHeaders(session.credential),
				'x-colony-impersonated-team': 'HQ Payroll HR'
			};
			const create = (id: string) =>
				postGuestCommand(
					session.host.baseUrl,
					'collections.mutate',
					mutationPush(session.schemaFingerprint, {
						action: 'mutate',
						collection: 'leave_accounts',
						rows: [
							{
								action: 'create',
								values: eventValues(id, 'PUBLIC-CHILD-RACE', 6)
							}
						]
					}),
					headers
				);
			const results = await Promise.all([create(crypto.randomUUID()), create(crypto.randomUUID())]);
			const accepted = results.filter(
				(result) => asRecord(result.value, 'event race result').resolution === 'accepted'
			);
			assert.equal(accepted.length, 1, JSON.stringify(results));
			assert.match(
				JSON.stringify(results),
				/household already allocated|maximum would be exceeded/i
			);
		} finally {
			await session.stop();
		}
	}
);
