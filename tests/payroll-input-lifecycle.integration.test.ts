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
	COMPANY_ID,
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	MARCH_2026,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const MUTATE_COMMAND = 'collections.mutate';
/** The public seed's TRANSPORT component, the one a claim is filed against. */
const TRANSPORT_COMPONENT_ID = '77777777-7777-4777-8777-777777777777';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;

const teamHeaders = (session: Session, team: string) => ({
	...bearerHeaders(session.credential),
	'x-colony-impersonated-team': team
});

const create = async (
	session: Session,
	collection: string,
	values: Readonly<Record<string, unknown>>,
	headers: Readonly<Record<string, string>>
) => {
	const response = await postGuestCommand(
		session.host.baseUrl,
		MUTATE_COMMAND,
		mutationPush(session.schemaFingerprint, {
			action: 'mutate',
			collection,
			rows: [{ action: 'create', values }]
		}),
		headers
	);
	assert.ok(
		response.status >= 200 && response.status < 300,
		`${collection} create returned ${response.status}: ${JSON.stringify(response.value)}`
	);
	return asRecord(response.value, `${collection} create`);
};

const rowCount = async (session: Session, sql: string, parameters: ReadonlyArray<unknown>) => {
	const rows = (await session.query(sql, parameters)) as ReadonlyArray<{ readonly n: number }>;
	return rows[0]?.n ?? 0;
};

/**
 * The life of a payroll input, end to end on a real host: an HR manager files a claim against
 * a pay component in one write; a controller applies for leave and a manager approves it; the
 * March run captures both as inputs; deleting the draft run unlinks both captures and leaves the
 * claim and the leave request exactly where they were.
 */
test(
	'a claim and an approved leave request are captured by payroll and survive the run being deleted',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS * 2 },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-input-lifecycle');
		try {
			const manager = teamHeaders(session, 'HR Manager');
			const controller = teamHeaders(session, 'HQ Payroll HR');

			// 1. A claim is one write, landed directly — no approval, no second step.
			const claimId = crypto.randomUUID();
			const claim = await create(
				session,
				'component_entries',
				{
					id: claimId,
					employment_id: EMPLOYMENT_ID,
					pay_component_id: TRANSPORT_COMPONENT_ID,
					amount: 42,
					event_date: '2026-03-05',
					event: { kind: 'CLAIM', incurred_on: '2026-03-05', description: 'Client site taxi' }
				},
				manager
			);
			assert.equal(claim.resolution, 'accepted', JSON.stringify(claim));
			assert.equal(
				claim.pendingApproval,
				undefined,
				`a claim must not wait: ${JSON.stringify(claim)}`
			);
			assert.equal(
				await rowCount(session, 'select count(*)::int as n from component_entries where id = $1', [
					claimId
				]),
				1
			);

			// 2. Leave: the controller applies, the request is held, the manager approves, the row lands.
			const leaveId = crypto.randomUUID();
			const applied = await create(
				session,
				'leave_requests',
				{
					id: leaveId,
					employment_id: EMPLOYMENT_ID,
					leave_type_id: ANNUAL_LEAVE_TYPE_ID,
					event: {
						kind: 'TIME_OFF',
						range: {
							start: { date: '2026-03-10', half: 'FIRST' },
							end: { date: '2026-03-10', half: 'SECOND' }
						},
						chargeable_days: null,
						reason: 'Family matter'
					}
				},
				controller
			);
			assert.equal(applied.resolution, 'accepted', JSON.stringify(applied));
			const pending = asRecord(applied.pendingApproval, 'leave pendingApproval');
			const requestId = String(pending.requestId);
			const status = await postGuestCommand(
				session.host.baseUrl,
				'approvals.status',
				{ requestId },
				manager
			);
			const state = asRecord(status.value, 'leave approval status');
			assert.equal(state._tag, 'Pending', JSON.stringify(status.value));
			const decided = await postGuestCommand(
				session.host.baseUrl,
				'approvals.decide',
				{ state, decision: 'approve' },
				manager
			);
			assert.equal(
				asRecord(decided.value, 'leave decide')._tag,
				'Approved',
				JSON.stringify(decided.value)
			);
			if (
				(await rowCount(session, 'select count(*)::int as n from leave_requests where id = $1', [
					leaveId
				])) === 0
			) {
				const resumed = await postGuestCommand(
					session.host.baseUrl,
					'collections.resume',
					{ requestId },
					manager
				);
				assert.ok(
					(resumed.status >= 200 && resumed.status < 300) ||
						(resumed.status === 422 &&
							JSON.stringify(resumed.value).includes('identity is already in use')),
					`collections.resume ${resumed.status}: ${JSON.stringify(resumed.value)}`
				);
			}
			assert.equal(
				await rowCount(session, 'select count(*)::int as n from leave_requests where id = $1', [
					leaveId
				]),
				1,
				'the approved leave request must be stored'
			);

			// 3. The March run captures both as inputs.
			const runId = crypto.randomUUID();
			const run = await create(
				session,
				'payroll_runs',
				{ id: runId, company_id: COMPANY_ID, period: MARCH_2026 },
				manager
			);
			requireAccepted(run, 'payroll run create');
			assert.equal(run.pendingApproval, undefined, `manager runs land: ${JSON.stringify(run)}`);
			const captureSql = (junction: string, column: string) =>
				`select count(*)::int as n from ${junction} i
				 join payslips p on p.id = i.payslip_id
				 where p.payroll_run_id = $1 and i.${column} = $2`;
			assert.equal(
				await rowCount(
					session,
					captureSql('payslip_component_entry_inputs', 'component_entry_id'),
					[runId, claimId]
				),
				1,
				'the claim must be captured as an input of the March run'
			);
			assert.equal(
				await rowCount(session, captureSql('payslip_leave_request_inputs', 'leave_request_id'), [
					runId,
					leaveId
				]),
				1,
				'the approved leave must be captured as an input of the March run'
			);

			// 4. Deleting the draft run releases both captures and deletes neither source.
			const versions = (await session.query('select row_version from payroll_runs where id = $1', [
				runId
			])) as ReadonlyArray<{ readonly row_version: number }>;
			const deleted = await postGuestCommand(
				session.host.baseUrl,
				MUTATE_COMMAND,
				mutationPush(
					session.schemaFingerprint,
					{ action: 'delete', collection: 'payroll_runs', ids: [runId] },
					[
						{
							row: { collection: 'payroll_runs', recordId: runId },
							rowVersion: versions[0]?.row_version
						}
					]
				),
				manager
			);
			requireAccepted(deleted.value, 'payroll run delete');
			assert.equal(
				await rowCount(session, 'select count(*)::int as n from payroll_runs where id = $1', [
					runId
				]),
				0
			);
			assert.equal(
				await rowCount(
					session,
					'select count(*)::int as n from payslip_component_entry_inputs where component_entry_id = $1',
					[claimId]
				),
				0,
				'the claim capture must be unlinked'
			);
			assert.equal(
				await rowCount(
					session,
					'select count(*)::int as n from payslip_leave_request_inputs where leave_request_id = $1',
					[leaveId]
				),
				0,
				'the leave capture must be unlinked'
			);
			assert.equal(
				await rowCount(session, 'select count(*)::int as n from component_entries where id = $1', [
					claimId
				]),
				1,
				'deleting the run must not delete the claim'
			);
			assert.equal(
				await rowCount(session, 'select count(*)::int as n from leave_requests where id = $1', [
					leaveId
				]),
				1,
				'deleting the run must not delete the leave request'
			);
		} finally {
			await session.stop();
		}
	}
);
