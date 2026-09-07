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
	ANNUAL_LEAVE_ENTITLEMENT_ID,
	ANNUAL_LEAVE_CATALOGUE_ID,
	COMPANY_ID,
	EMPLOYMENT_ID,
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { leaveEntitlementIdFor, leaveEntryIdFor } from '../src/lib/leave/identity.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
type Row = Readonly<Record<string, unknown>>;

const teamHeaders = (session: Session, team: string) => ({
	...bearerHeaders(session.credential),
	'x-colony-impersonated-team': team
});

const mutate = (
	session: Session,
	collection: string,
	values: Readonly<Record<string, unknown>>,
	headers: Readonly<Record<string, string>>
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

const entitlementsOf = async (session: Session, employmentId: string) =>
	(await session.query(
		`select id, leave_code, leave_year, left(starts_on::text, 10) as starts_on, status,
		        (select count(*)::int from leave_entries e where e.leave_entitlement_id = t.id) as lines
		 from leave_entitlements t where employment_id = $1 order by leave_code, leave_year`,
		[employmentId]
	)) as ReadonlyArray<Row>;

/**
 * Every reconciler run the host has recorded (`automation_run` is the projection a start settles
 * into; `bolt_task` is drained once the run is done). The seed's own run is one of them.
 */
const reconcilerRuns = async (session: Session) =>
	(await session.query(
		`select task_id, status, result::text as result from automation_run where name = 'leave_ledger_refresh' order by created_at`
	)) as ReadonlyArray<{
		readonly task_id: string;
		readonly status: string;
		readonly result: string;
	}>;

const settle = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis));

/**
 * RFC 0003 HR1′ and HA2 on the public seed: a kiosk enrolment, an HR hire and a child fact each
 * commit with the leave ledger in the same write, as the workspace; the reconciler is never
 * started for them; the kiosk holds no read grant on anything the ledger is made of and the hook
 * reads it unmasked.
 */
test(
	'public seed: enrolment, hire and a child fact land their leave ledger in the same write',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-hook-ledger');
		try {
			const runsBefore = await reconcilerRuns(session);
			assert.equal(
				runsBefore.length,
				1,
				`the seed ran the reconciler once: ${JSON.stringify(runsBefore)}`
			);

			// HA2: the kiosk creates a person and their employment and holds no grant on
			// leave_catalogue, leave_entitlements, leave_entries or jurisdiction_settings.
			const kiosk = teamHeaders(session, 'Attendance Kiosk');
			const embedding = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));
			const enrolled = await postGuestCommand(
				session.host.baseUrl,
				'invoke.kiosk_enroll',
				{
					input: {
						new_person: {
							name: 'Hook Ledger Person',
							company_id: COMPANY_ID,
							employee_number: 'HOOK-KIOSK'
						},
						face_embedding: embedding,
						consent_at: '2026-01-01T00:00:00Z'
					}
				},
				kiosk
			);
			assert.equal(
				asRecord(enrolled.value, 'enrolment').status,
				'PENDING',
				JSON.stringify(enrolled.value)
			);
			const [kioskEmployment] = (await session.query(
				`select id, hire_date::text as hire_date from employments where employee_number = 'HOOK-KIOSK'`
			)) as ReadonlyArray<{ readonly id: string; readonly hire_date: string }>;
			assert.ok(kioskEmployment, 'the enrolment landed an employment');
			const kioskLedger = await entitlementsOf(session, kioskEmployment.id);
			const hireYear = Number(kioskEmployment.hire_date.slice(0, 4));
			assert.deepEqual(
				kioskLedger.map((row) => [row.leave_code, row.leave_year, row.status]),
				[
					['ANNUAL', hireYear, 'OPEN'],
					['ANNUAL', hireYear + 1, 'OPEN'],
					['HOSPITALIZATION', hireYear, 'OPEN'],
					['HOSPITALIZATION', hireYear + 1, 'OPEN']
				],
				JSON.stringify(kioskLedger)
			);
			assert.equal(kioskLedger[0]?.lines, 1, 'the hire year opened with its entitlement line');
			assert.equal(kioskLedger[1]?.lines, 0, 'next year opens when the schedule gets there');
			const kioskRead = await postGuestCommand(
				session.host.baseUrl,
				'collections.query',
				{
					collection: 'leave_entitlements',
					where: { employment_id: { eq: kioskEmployment.id } },
					limit: 10
				},
				kiosk
			);
			assert.ok(
				kioskRead.status >= 400,
				`the kiosk reads no entitlements: ${JSON.stringify(kioskRead.value)}`
			);

			// HR1′ hire: HQ Payroll HR creates a person with a nested employment through the
			// collection, as the people app does.
			const hr = teamHeaders(session, 'HQ Payroll HR');
			const hiredEmploymentId = crypto.randomUUID();
			const hired = await mutate(
				session,
				'employees',
				{
					id: crypto.randomUUID(),
					name: 'Hook Ledger Hire',
					date_of_birth: '1995-02-02',
					gender: 'FEMALE',
					marital_status: 'SINGLE',
					spouse_status: 'NONE',
					dependents_count: 0,
					employment_employee: [
						{
							id: hiredEmploymentId,
							company_id: COMPANY_ID,
							employee_number: 'HOOK-HIRE',
							// Day-precision instants at the payroll calendar's start of day, as the app mints them.
							hire_date: '2026-08-31T16:00:00Z',
							effective_range: { start: '2026-08-31T16:00:00Z', end: null }
						}
					]
				},
				hr
			);
			assert.ok(hired.status < 300, `hire ${hired.status}: ${JSON.stringify(hired.value)}`);
			requireAccepted(hired.value, 'hire');
			const hiredLedger = await entitlementsOf(session, hiredEmploymentId);
			assert.deepEqual(
				hiredLedger.map((row) => [row.leave_code, row.leave_year, row.starts_on, row.lines]),
				[
					['ANNUAL', 2026, '2026-09-01', 1],
					['ANNUAL', 2027, '2027-01-01', 0],
					['HOSPITALIZATION', 2026, '2026-09-01', 1],
					['HOSPITALIZATION', 2027, '2027-01-01', 0]
				],
				JSON.stringify(hiredLedger)
			);

			// HR1′ child fact: a childcare type nobody has reconciled yet (inserted below the
			// catalogue hook, so no company run starts), then one child fact entered for the
			// fixture employment. The entitlement the child opens lands with the fact.
			await session.query(
				`insert into leave_catalogue (id, settings_id, code, name, is_statutory, authority, eligibility, entitlement, accrual, exit_settlement, payroll_effect)
				 values ($1, $2, 'CHILDCARE', 'Childcare leave', true, 'Public fixture s.87A', 'children.under(7) >= 1', $3, $4, $5, $6)`,
				[
					crypto.randomUUID(),
					JURISDICTION_ID,
					{ layers: [{ level: 'ORGANISATION', band_from: 0, days: 6 }] },
					{ kind: 'UPFRONT', settlement: { settlement: 'FORFEIT' } },
					{ exit: 'FORFEIT' },
					{ kind: 'PAID' }
				]
			);
			const child = await mutate(
				session,
				'employee_children',
				{
					id: crypto.randomUUID(),
					employment_id: EMPLOYMENT_ID,
					child_birthdate: '2026-04-09T16:00:00Z',
					relationship: 'BIRTH'
				},
				hr
			);
			assert.ok(child.status < 300, `child fact ${child.status}: ${JSON.stringify(child.value)}`);
			requireAccepted(child.value, 'child fact');
			const childcare = (await entitlementsOf(session, EMPLOYMENT_ID)).filter(
				(row) => row.leave_code === 'CHILDCARE'
			);
			assert.deepEqual(
				childcare.map((row) => [row.leave_year, row.starts_on, row.lines]),
				[
					[2026, '2026-04-10', 1],
					[2027, '2027-01-01', 0]
				],
				JSON.stringify(childcare)
			);

			// None of the three started the reconciler; the seed's run is still the only one, and it
			// walked the seed's four employments, none of the ones written here.
			const runsAfter = await reconcilerRuns(session);
			assert.deepEqual(runsAfter, runsBefore, "no leave_ledger_refresh run for a person's facts");
			assert.equal(
				(JSON.parse(runsAfter[0]?.result ?? '{}') as { employments?: number }).employments,
				4
			);
		} finally {
			await session.stop();
		}
	}
);

/**
 * RFC 0003 §3.2 (Approvals): a held leave request replays its hooks on resume and must
 * reproduce the review. The TAKEN line is nested under the request, so it is held with it and
 * lands on approval, once, under the id the reconciler's own restatement uses.
 */
test(
	'public seed: a held leave request resumes with its TAKEN line and no ApprovalConflict',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-hook-ledger-resume');
		try {
			const controller = teamHeaders(session, 'HQ Payroll HR');
			const manager = teamHeaders(session, 'HR Manager');
			const requestId = crypto.randomUUID();
			const date = '2026-10-06';
			const filed = await mutate(
				session,
				'leave_requests',
				{
					id: requestId,
					employment_id: EMPLOYMENT_ID,
					leave_catalogue_id: ANNUAL_LEAVE_CATALOGUE_ID,
					leave_entitlement_id: ANNUAL_LEAVE_ENTITLEMENT_ID,
					event: {
						kind: 'TIME_OFF',
						range: { start: { date, half: 'FIRST' }, end: { date, half: 'SECOND' } },
						chargeable_days: null,
						reason: 'RFC 0003 resume'
					}
				},
				controller
			);
			assert.ok(filed.status < 300, `file ${filed.status}: ${JSON.stringify(filed.value)}`);
			const pending = asRecord(asRecord(filed.value, 'file').pendingApproval, 'pendingApproval');
			const approvalId = String(pending.requestId);
			const lineId = leaveEntryIdFor({
				leave_entitlement_id: ANNUAL_LEAVE_ENTITLEMENT_ID,
				source_key: `request:${requestId}`
			});
			const lines = () =>
				session.query(
					`select kind, days::text as days, left(effective_on::text, 10) as effective_on, source_request_id, approval_id
					 from leave_entries where id = $1`,
					[lineId]
				) as Promise<ReadonlyArray<Row>>;
			assert.deepEqual(await lines(), [], 'the held request charges nothing yet');

			const status = await postGuestCommand(
				session.host.baseUrl,
				'approvals.status',
				{ requestId: approvalId },
				manager
			);
			const state = asRecord(status.value, 'status');
			assert.equal(state._tag, 'Pending', JSON.stringify(status.value));
			const decided = await postGuestCommand(
				session.host.baseUrl,
				'approvals.decide',
				{ state, decision: 'approve' },
				manager
			);
			assert.equal(
				asRecord(decided.value, 'decide')._tag,
				'Approved',
				JSON.stringify(decided.value)
			);
			// Approval enqueues `collections.resume` as its own follow-up, which replays the caller's
			// payload through the hooks and demands the same review. A second resume by hand is
			// refused once the row exists; any other refusal (an ApprovalConflict) is the failure.
			const resumed = await postGuestCommand(
				session.host.baseUrl,
				'collections.resume',
				{ requestId: approvalId },
				manager
			);
			assert.ok(
				resumed.status < 300 ||
					(resumed.status === 422 &&
						JSON.stringify(resumed.value).includes('identity is already in use')),
				`collections.resume ${resumed.status}: ${JSON.stringify(resumed.value)}`
			);
			let landed = await lines();
			for (let attempt = 0; attempt < 20 && landed.length === 0; attempt += 1) {
				await settle(250);
				landed = await lines();
			}
			assert.deepEqual(landed, [
				{
					kind: 'TAKEN',
					days: '-1',
					effective_on: date,
					source_request_id: requestId,
					approval_id: null
				}
			]);
			assert.equal(
				(await session.query('select id from leave_requests where id = $1', [requestId])).length,
				1,
				'the request landed with its line'
			);
			// The reconciler finds the line under the same id and posts nothing twice.
			const rerun = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{ name: 'leave_ledger_refresh', input: { company_id: COMPANY_ID } },
				bearerHeaders(session.credential)
			);
			assert.ok(rerun.status < 300, JSON.stringify(rerun.value));
			const taken = await session.query(
				`select count(*)::int as n from leave_entries where source_request_id = $1`,
				[requestId]
			);
			assert.equal((taken[0] as { n: number }).n, 1);
			assert.equal(
				leaveEntitlementIdFor({
					employment_id: EMPLOYMENT_ID,
					leave_code: 'ANNUAL',
					leave_year: 2026
				}),
				ANNUAL_LEAVE_ENTITLEMENT_ID
			);
		} finally {
			await session.stop();
		}
	}
);
