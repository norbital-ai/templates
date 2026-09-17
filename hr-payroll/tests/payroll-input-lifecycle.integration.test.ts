import test from 'node:test';
import { approveLeave } from './helpers/public-leave.ts';
import assert from 'node:assert/strict';
import { asRecord, bearerHeaders, requireAccepted } from '@norbital-ai/test-utilities';
import { createdIds, observedVersion, writeRows } from './helpers/write.ts';
import {
	ANNUAL_LEAVE_CATALOGUE_ID,
	COMPANY_ID,
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	MARCH_2026,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

/** The public Claim catalogue entry used for the reimbursed taxi. */
const TRANSPORT_COMPONENT_ID = '77777777-7777-4777-8777-777777777701';

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
	const response = await writeRows(session, collection, 'create', [values], headers);
	assert.ok(
		response.status >= 200 && response.status < 300,
		`${collection} create returned ${response.status}: ${JSON.stringify(response.value)}`
	);
	return asRecord(response.value, `${collection} create`);
};
/** The id the runtime gave the one created row, or the held root's id. */
const idOf = (settlement: Readonly<Record<string, unknown>>): string => {
	const [id] = createdIds(settlement);
	if (id != null) return id;
	return String(asRecord(settlement.pendingApproval, 'held root').id);
};

const rowCount = async (session: Session, sql: string, parameters: ReadonlyArray<unknown>) => {
	const rows = (await session.query(sql, parameters)) as ReadonlyArray<{ readonly n: number }>;
	return rows[0]?.n ?? 0;
};

/**
 * The life of a payroll input, end to end on a real host: an HR manager files a claim against
 * a component in one write; a controller applies for leave and a manager approves it; the
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
			const claim = await create(
				session,
				'claim_requests',
				{
					employment_id: EMPLOYMENT_ID,
					catalogue_id: TRANSPORT_COMPONENT_ID,
					amount: 42,
					incurred_on: '2026-03-05',
					description: 'Client site taxi'
				},
				manager
			);
			assert.equal(claim.resolution, 'accepted', JSON.stringify(claim));
			assert.equal(
				claim.pendingApproval,
				undefined,
				`a claim must not wait: ${JSON.stringify(claim)}`
			);
			const claimId = idOf(claim);
			assert.equal(
				await rowCount(session, 'select count(*)::int as n from claim_requests where id = $1', [
					claimId
				]),
				1
			);

			// 2. Leave: the controller applies, the request is held, the manager approves, the row lands.
			const applied = await create(
				session,
				'leave_entries',
				{
					employment_id: EMPLOYMENT_ID,
					catalogue_id: ANNUAL_LEAVE_CATALOGUE_ID,
					reference: 'LEAVE-MARCH-FAMILY',
					from_date: '2026-03-10',
					to_date: '2026-03-10',
					half_day_start: false,
					half_day_end: false,
					days: null,
					reason: 'Family matter'
				},
				controller
			);
			assert.equal(applied.resolution, 'accepted', JSON.stringify(applied));
			const leaveId = idOf(applied);
			await approveLeave(session, applied);
			assert.equal(
				await rowCount(session, 'select count(*)::int as n from leave_entries where id = $1', [
					leaveId
				]),
				1,
				'the approved leave request must be stored'
			);

			// 3. The March run captures both as inputs.
			const run = await create(
				session,
				'payroll_runs',
				{ company_id: COMPANY_ID, period: MARCH_2026 },
				manager
			);
			requireAccepted(run, 'payroll run create');
			const runId = idOf(run);
			assert.equal(run.pendingApproval, undefined, `manager runs land: ${JSON.stringify(run)}`);
			assert.equal(
				await rowCount(
					session,
					`select count(*)::int as n from claim_requests c
					 join payslips p on p.id = c.payslip_id
					 where p.payroll_run_id = $1 and c.id = $2`,
					[runId, claimId]
				),
				1,
				'the claim must be settled by a payslip of the March run'
			);
			assert.equal(
				await rowCount(
					session,
					`select count(*)::int as n from leave_entries l
					 join payslips p on p.id = l.payslip_id
					 where p.payroll_run_id = $1 and l.id = $2`,
					[runId, leaveId]
				),
				1,
				'the approved leave must be captured as an input of the March run'
			);

			// 4. Deleting the draft run releases both captures and deletes neither source.
			const sourceBefore = await session.query(
				'select days, charges, allocations from leave_entries where id = $1',
				[leaveId]
			);
			const versions = (await session.query('select row_version from payroll_runs where id = $1', [
				runId
			])) as ReadonlyArray<{ readonly row_version: number }>;
			const deleted = await writeRows(session, 'payroll_runs', 'delete', [{ id: runId }], manager, [
				observedVersion('payroll_runs', runId, versions[0]!.row_version)
			]);
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
					'select count(*)::int as n from claim_requests where id = $1 and payslip_id is not null',
					[claimId]
				),
				0,
				'the claim must be released'
			);
			assert.equal(
				await rowCount(
					session,
					'select count(*)::int as n from leave_entries where id = $1 and payslip_id is not null',
					[leaveId]
				),
				0,
				'the leave capture must be unlinked'
			);
			assert.equal(
				await rowCount(session, 'select count(*)::int as n from claim_requests where id = $1', [
					claimId
				]),
				1,
				'deleting the run must not delete the claim'
			);
			assert.equal(
				await rowCount(session, 'select count(*)::int as n from leave_entries where id = $1', [
					leaveId
				]),
				1,
				'deleting the run must not delete the leave request'
			);
			assert.deepEqual(
				await session.query('select days, charges, allocations from leave_entries where id = $1', [
					leaveId
				]),
				sourceBefore
			);
		} finally {
			await session.stop();
		}
	}
);
