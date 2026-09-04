import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	authoredSeedStages,
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import {
	ANNUAL_LEAVE_TYPE_ID,
	COMPANY_ID,
	EMPLOYMENT_ID,
	FEBRUARY_2026,
	JANUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	publicSeedDirectory,
	startPublicSeedHost,
	templateManifestPath
} from './helpers/public-seed-host.ts';

const CREATE_PAYROLL_COMMAND = 'collections.mutate';

const statutoryLines = (value: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> => {
	if (typeof value === 'string') {
		try {
			return statutoryLines(JSON.parse(value));
		} catch {
			return [];
		}
	}
	if (!Array.isArray(value)) return [];
	return value.filter(
		(row): row is Readonly<Record<string, unknown>> =>
			typeof row === 'object' && row !== null && !Array.isArray(row)
	);
};

/**
 * T4: public-seed integration creates a payroll run (N payslips, 0 orphans) on bolt-server.
 * Not the in-memory createPublicPayrollWorld + hooks path.
 */
test(
	'public seed on bolt-server creates a payroll run with N payslips and no orphans',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const stages = authoredSeedStages(templateManifestPath, publicSeedDirectory);
		assert.deepEqual(
			[...stages],
			[
				'team',
				'jurisdictions',
				'companies',
				'statutory_contributions',
				'contribution_rates',
				'employees',
				'leave_types',
				'pay_components',
				'shift_definitions',
				'employments',
				'employment_statutory_facts',
				'employment_terms',
				'leave_requests',
				'component_entries'
			]
		);

		const session = await startPublicSeedHost('hr-payroll-t4');
		try {
			const employments = (await session.query(
				'select id from employments order by employee_number'
			)) as ReadonlyArray<{ readonly id: string }>;
			assert.ok(
				employments.length >= 4,
				`public seed floor is 4 employments, got ${employments.length}`
			);
			const employmentIds = new Set(employments.map((row) => row.id));
			assert.ok(employmentIds.has(EMPLOYMENT_ID));
			const numbered = (await session.query(
				`select employee_number from employments order by employee_number`
			)) as ReadonlyArray<{ readonly employee_number: string }>;
			assert.deepEqual(
				numbered.map((row) => row.employee_number),
				['PUB-EMP-0001', 'PUB-EMP-0002', 'PUB-EMP-0003', 'PUB-EMP-0004']
			);
			const nonCitizen = (await session.query(`select id from employees where id = $1`, [
				'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4'
			])) as ReadonlyArray<{ readonly id: string }>;
			assert.equal(
				nonCitizen.length,
				1,
				`expected public non-citizen employee bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4, got ${JSON.stringify(nonCitizen)}`
			);

			const payrollRunId = crypto.randomUUID();
			const created = await postGuestCommand(
				session.host.baseUrl,
				CREATE_PAYROLL_COMMAND,
				mutationPush(session.schemaFingerprint, {
					action: 'create',
					collection: 'payroll_runs',
					values: {
						id: payrollRunId,
						company_id: COMPANY_ID,
						period: JANUARY_2026
					}
				}),
				{ authorization: `Bearer ${session.credential}` }
			);
			assert.ok(
				created.status >= 200 && created.status < 300,
				`${CREATE_PAYROLL_COMMAND} returned ${created.status}: ${JSON.stringify(created.value)}`
			);
			requireAccepted(created.value, CREATE_PAYROLL_COMMAND);

			const payslips = (await session.query(
				`select id, employment_id, statutory from payslips where payroll_run_id = $1`,
				[payrollRunId]
			)) as ReadonlyArray<{
				readonly id: string;
				readonly employment_id: string | null;
				readonly statutory: unknown;
			}>;

			// PLAIN_CALENDAR includes the 2026-01-20 hire (window end). Terms start 2026-01-01 so
			// every salary-window day the engine measures is covered.
			assert.equal(
				payslips.length,
				employments.length,
				`expected one January payslip per public employment, got ${payslips.length} for ${employments.length}`
			);

			const orphans = payslips.filter(
				(payslip) =>
					payslip.employment_id == null ||
					payslip.employment_id === '' ||
					!employmentIds.has(payslip.employment_id)
			);
			assert.equal(orphans.length, 0, `expected 0 orphan payslips, got ${JSON.stringify(orphans)}`);

			const first =
				payslips.find((payslip) => payslip.employment_id === EMPLOYMENT_ID) ?? payslips[0];
			assert.ok(first, 'expected at least one payslip');
			const lines = statutoryLines(first.statutory);
			const pubEpf = lines.filter((line) => line.scheme_code === 'PUB-EPF');
			assert.ok(
				pubEpf.length >= 1,
				`expected PUB-EPF statutory lines on the first payslip, got ${JSON.stringify(first.statutory)}`
			);
		} finally {
			await session.stop();
		}
	}
);

/**
 * H11: HQ Payroll HR may raise `payroll_runs.mutate.new`. create.before nests payslips as the
 * requesting subject, so `payrollRebuildGrants()` on `hr_controller` is what stops
 * "no matching allow policy" before the approval gate. The run itself stays held.
 */
test(
	'public seed HQ Payroll HR payroll create is held, not refused on payslip writes',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-h11-controller-create');
		try {
			const previewHeaders = {
				...bearerHeaders(session.credential),
				'x-colony-impersonated-team': 'HQ Payroll HR'
			};
			const preview = await postGuestCommand(
				session.host.baseUrl,
				'access.impersonation',
				{},
				previewHeaders
			);
			assert.ok(
				preview.status >= 200 && preview.status < 300,
				`access.impersonation ${preview.status}: ${JSON.stringify(preview.value)}`
			);
			assert.equal(
				asRecord(preview.value, 'access.impersonation').isActive,
				true,
				`H11 preview: ${JSON.stringify(preview.value)}`
			);
			const payrollRunId = crypto.randomUUID();
			const created = await postGuestCommand(
				session.host.baseUrl,
				CREATE_PAYROLL_COMMAND,
				mutationPush(session.schemaFingerprint, {
					action: 'create',
					collection: 'payroll_runs',
					values: {
						id: payrollRunId,
						company_id: COMPANY_ID,
						period: FEBRUARY_2026
					}
				}),
				previewHeaders
			);
			assert.ok(
				created.status >= 200 && created.status < 300,
				`H11 create ${created.status}: ${JSON.stringify(created.value)}`
			);
			const payload = asRecord(created.value, 'H11 payroll create');
			assert.doesNotMatch(
				JSON.stringify(created.value),
				/no matching allow policy/i,
				`H11 payslip writes refused: ${JSON.stringify(created.value)}`
			);
			assert.equal(payload.resolution, 'accepted', `H11 resolution: ${JSON.stringify(created.value)}`);
			const pending = payload.pendingApproval;
			assert.ok(
				pending !== null && typeof pending === 'object' && !Array.isArray(pending),
				`H11 expected pendingApproval, got ${JSON.stringify(created.value)}`
			);
			const approval = asRecord(pending, 'H11 pendingApproval');
			assert.equal(approval.collection, 'payroll_runs');
			assert.equal(approval.action, 'create');
			const inserted = (await session.query(`select id from payroll_runs where id = $1`, [
				payrollRunId
			])) as ReadonlyArray<{ readonly id: string }>;
			assert.deepEqual(inserted, [], 'approval-gated payroll create must not insert the run');
		} finally {
			await session.stop();
		}
	}
);

/**
 * Kavriel (HQ Payroll HR) raises a run; Dernesse (HR Manager) is the named approver.
 * Approve + resume must land the run and its payslips — the hold alone is not the product.
 */
test(
	'public seed HR Manager approve lands the HQ Payroll HR payroll create',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-h11-manager-approve');
		try {
			const controllerHeaders = {
				...bearerHeaders(session.credential),
				'x-colony-impersonated-team': 'HQ Payroll HR'
			};
			const managerHeaders = {
				...bearerHeaders(session.credential),
				'x-colony-impersonated-team': 'HR Manager'
			};
			const payrollRunId = crypto.randomUUID();
			const created = await postGuestCommand(
				session.host.baseUrl,
				CREATE_PAYROLL_COMMAND,
				mutationPush(session.schemaFingerprint, {
					action: 'create',
					collection: 'payroll_runs',
					values: {
						id: payrollRunId,
						company_id: COMPANY_ID,
						period: FEBRUARY_2026
					}
				}),
				controllerHeaders
			);
			const payload = asRecord(created.value, 'H11 approve create');
			assert.equal(
				payload.resolution,
				'accepted',
				`HQ create ${created.status}: ${JSON.stringify(created.value)}`
			);
			const approval = asRecord(payload.pendingApproval, 'H11 approve pending');
			assert.equal(typeof approval.requestId, 'string');
			const requestId = String(approval.requestId);

			const controllerDecide = await postGuestCommand(
				session.host.baseUrl,
				'approvals.status',
				{ requestId },
				controllerHeaders
			);
			const controllerState = asRecord(controllerDecide.value, 'H11 controller status');
			const controllerDenied = await postGuestCommand(
				session.host.baseUrl,
				'approvals.decide',
				{ state: controllerState, decision: 'approve' },
				controllerHeaders
			);
			assert.ok(
				controllerDenied.status >= 400,
				`HQ Payroll HR must not approve its own payroll: ${JSON.stringify(controllerDenied)}`
			);

			const status = await postGuestCommand(
				session.host.baseUrl,
				'approvals.status',
				{ requestId },
				managerHeaders
			);
			assert.ok(
				status.status >= 200 && status.status < 300,
				`HR Manager status ${status.status}: ${JSON.stringify(status.value)}`
			);
			const state = asRecord(status.value, 'H11 manager status');
			assert.equal(state._tag, 'Pending', `expected Pending, got ${JSON.stringify(status.value)}`);
			const decided = await postGuestCommand(
				session.host.baseUrl,
				'approvals.decide',
				{ state, decision: 'approve' },
				managerHeaders
			);
			assert.ok(
				decided.status >= 200 && decided.status < 300,
				`HR Manager decide ${decided.status}: ${JSON.stringify(decided.value)}`
			);
			const decidedPayload = asRecord(decided.value, 'H11 decide');
			assert.equal(
				decidedPayload._tag,
				'Approved',
				`expected Approved, got ${JSON.stringify(decided.value)}`
			);

			const loadRun = () =>
				session.query(`select id, lifecycle from payroll_runs where id = $1`, [payrollRunId]) as Promise<
					ReadonlyArray<{ readonly id: string; readonly lifecycle: string }>
				>;
			let inserted = await loadRun();
			if (inserted.length === 0) {
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
				inserted = await loadRun();
			}
			assert.equal(inserted.length, 1, `approved run missing: ${JSON.stringify(inserted)}`);
			const payslips = (await session.query(
				`select count(*)::int as n from payslips where payroll_run_id = $1`,
				[payrollRunId]
			)) as ReadonlyArray<{ readonly n: number }>;
			assert.ok(
				(payslips[0]?.n ?? 0) > 0,
				`approved run must build payslips: ${JSON.stringify(payslips)}`
			);
		} finally {
			await session.stop();
		}
	}
);

/**
 * A3 command half. HQ Payroll HR `leave_requests.mutate.new` is approval-gated and does not expand.
 * Founder admin auto-commits (T4). Form toast remains headed.
 */
test(
	'public seed HQ Payroll HR leave create stays pending approval',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-a3-approval');
		try {
			const before = (await session.query(
				`select count(*)::int as n from leave_requests where employment_id = $1`,
				[EMPLOYMENT_ID]
			)) as ReadonlyArray<{ readonly n: number }>;
			const previewHeaders = {
				...bearerHeaders(session.credential),
				'x-colony-impersonated-team': 'HQ Payroll HR'
			};
			const preview = await postGuestCommand(
				session.host.baseUrl,
				'access.impersonation',
				{},
				previewHeaders
			);
			assert.ok(
				preview.status >= 200 && preview.status < 300,
				`access.impersonation ${preview.status}: ${JSON.stringify(preview.value)}`
			);
			const capability = asRecord(preview.value, 'access.impersonation');
			assert.equal(capability.isActive, true, `A3 preview: ${JSON.stringify(preview.value)}`);
			const explained = await postGuestCommand(
				session.host.baseUrl,
				'access.explain',
				{ action: 'create', resource: 'leave_requests' },
				previewHeaders
			);
			assert.ok(
				explained.status >= 200 && explained.status < 300,
				`access.explain ${explained.status}: ${JSON.stringify(explained.value)}`
			);
			assert.equal(
				asRecord(explained.value, 'access.explain').allowed,
				true,
				`A3 explain create leave_requests: ${JSON.stringify(explained.value)}`
			);
			const created = await postGuestCommand(
				session.host.baseUrl,
				CREATE_PAYROLL_COMMAND,
				mutationPush(session.schemaFingerprint, {
					action: 'create',
					collection: 'leave_requests',
					values: {
						id: crypto.randomUUID(),
						employment_id: EMPLOYMENT_ID,
						leave_type_id: ANNUAL_LEAVE_TYPE_ID,
						event: {
							kind: 'TIME_OFF',
							range: {
								start: { date: '2026-04-15', half: 'FIRST' },
								end: { date: '2026-04-15', half: 'SECOND' }
							},
							chargeable_days: null,
							reason: null
						}
					}
				}),
				previewHeaders
			);
			assert.ok(
				created.status >= 200 && created.status < 300,
				`${CREATE_PAYROLL_COMMAND} returned ${created.status}: ${JSON.stringify(created.value)}`
			);
			const payload = asRecord(created.value, CREATE_PAYROLL_COMMAND);
			assert.equal(
				payload.resolution,
				'accepted',
				`A3 mutate ${created.status}: ${JSON.stringify(created.value)}`
			);
			const pending = payload.pendingApproval;
			assert.ok(
				pending !== null && typeof pending === 'object' && !Array.isArray(pending),
				`A3 expected pendingApproval, got ${JSON.stringify(created.value)}`
			);
			const approval = asRecord(pending, 'pendingApproval');
			assert.equal(approval.collection, 'leave_requests');
			assert.equal(approval.action, 'create');
			assert.equal(typeof approval.requestId, 'string');
			const after = (await session.query(
				`select count(*)::int as n from leave_requests where employment_id = $1`,
				[EMPLOYMENT_ID]
			)) as ReadonlyArray<{ readonly n: number }>;
			assert.equal(after[0]?.n, before[0]?.n, 'approval-gated create must not insert the row');
		} finally {
			await session.stop();
		}
	}
);
