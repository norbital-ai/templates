import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	authoredSeedStages,
	bearerHeaders,
	jsonSqlParameter,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import { WRITE_COMMAND, createdIds, writeRows } from './helpers/write.ts';
import { dayInstant } from '../src/lib/iso-day.ts';
import {
	ANNUAL_LEAVE_CATALOGUE_ID,
	COMPANY_ID,
	EMPLOYMENT_ID,
	FEBRUARY_2026,
	JANUARY_2026,
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	publicSeedDirectory,
	publicSeedRows,
	startPublicSeedHost,
	templateManifestPath
} from './helpers/public-seed-host.ts';

const CREATE_PAYROLL_COMMAND = WRITE_COMMAND;

test(
	'saved liability dates select payroll rules and remain in each run trace',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const rows = await publicSeedRows();
		const schemeId = 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaa96';
		rows.statutory_contributions!.push({
			id: schemeId,
			settings_id: JURISDICTION_ID,
			code: 'PUB_LIABILITY',
			name: 'Synthetic liability history',
			authority: 'Synthetic storage and transport case; Malaysia tests verify statutory amounts.',
			assessment_period: 'PAY_PERIOD',
			assessed_on: 'BASE',
			parts: [],
			elections: [],
			rules: [
				{ when: 'scheme.first_contribution_due_on == ""', employee: '0.0', employer: '0.0' },
				{
					when: 'scheme.first_contribution_due_on < "2020-01-01"',
					employee: '25.0',
					employer: '0.0'
				},
				{ when: 'true', employee: '50.0', employer: '0.0' }
			]
		});
		const session = await startPublicSeedHost('hr-liability-history', {
			seed: {
				stages: authoredSeedStages(templateManifestPath, publicSeedDirectory),
				rows,
				mapParameters: jsonSqlParameter
			}
		});
		try {
			const [employment] = await session.query(
				'select employee_id from employments where id = $1',
				[EMPLOYMENT_ID]
			);
			const declaration = await writeRows(
				session,
				'employment_statutory_facts',
				'create',
				[
					{ start: '2026-01-01', end: '2026-01-31', first: '2018-01-01' },
					{ start: '2026-02-01', end: null, first: '2021-01-01' }
				].map(({ start, end, first }) => ({
					employee_id: employment.employee_id,
					statutory_contribution_id: schemeId,
					effective_range: { start: dayInstant(start), end: end == null ? null : dayInstant(end) },
					status: {
						kind: 'REGISTERED',
						reference_number: 'SYNTHETIC',
						rate_override: null,
						since: '2026-01-01',
						first_contribution_due_on: first
					}
				}))
			);
			requireAccepted(declaration.value, 'write dated liability declarations');
			for (const [period, expected, first] of [
				[JANUARY_2026, 25, '2018-01-01'],
				[FEBRUARY_2026, 50, '2021-01-01']
			] as const) {
				const run = await writeRows(session, 'payroll_runs', 'create', [
					{ company_id: COMPANY_ID, period }
				]);
				requireAccepted(run.value, 'create liability payroll');
				const runId = createdIds(run.value)[0];
				const [slip] = await session.query(
					'select statutory from payslips where payroll_run_id = $1 and employment_id = $2',
					[runId, EMPLOYMENT_ID]
				);
				assert.equal(
					statutoryLines(slip.statutory).find((row) => row.scheme_code === 'PUB_LIABILITY')
						?.employee_amount,
					expected
				);
				const [stored] = await session.query(
					'select calculation_trace from payroll_runs where id = $1',
					[runId]
				);
				const trace = statutoryLines(stored.calculation_trace).find(
					(row) => row.employment_id === EMPLOYMENT_ID
				);
				assert.equal(
					statutoryLines(trace?.schemes).find((row) => row.scheme_code === 'PUB_LIABILITY')
						?.first_contribution_due_on,
					first
				);
			}
		} finally {
			await session.stop();
		}
	}
);

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

test(
	'saved deduction claims feed payroll once and retain prior-employer and month boundaries',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const rows = await publicSeedRows();
		const schemeId = 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaa97';
		rows.statutory_contributions!.push({
			id: schemeId,
			settings_id: JURISDICTION_ID,
			code: 'PUB_DEDUCTION',
			name: 'Synthetic deduction ledger',
			authority: 'Synthetic transport case; jurisdiction tests verify legal amounts.',
			assessment_period: 'PAY_PERIOD',
			assessed_on: 'BASE',
			parts: [],
			elections: [],
			rules: [
				{
					when: 'true',
					deduction: 'annual_exempt(scheme.deductions.EDUCATION, 0.0, 250.0)',
					employee: '500.0 - scheme.deduction',
					employer: '0.0'
				}
			]
		});
		const session = await startPublicSeedHost('hr-deduction-ledger', {
			seed: {
				stages: authoredSeedStages(templateManifestPath, publicSeedDirectory),
				rows,
				mapParameters: jsonSqlParameter
			}
		});
		try {
			const [employment] = await session.query(
				'select employee_id from employments where id = $1',
				[EMPLOYMENT_ID]
			);
			const claims = [
				{ period: '2025-12', amount: 900, source: 'EMPLOYEE', reference: 'Prior tax year' },
				{ period: '2026-01', amount: 50, source: 'PRIOR_EMPLOYER', reference: 'Prior employer' },
				{ period: '2026-01', amount: 100, source: 'EMPLOYEE', reference: 'January TP1' },
				{ period: '2026-02', amount: 999, source: 'EMPLOYEE', reference: 'February TP1' }
			].map((row) => ({ ...row, category: 'EDUCATION' }));
			const declaration = await writeRows(session, 'employment_statutory_facts', 'create', [
				{
					employee_id: employment.employee_id,
					statutory_contribution_id: schemeId,
					effective_range: { start: '2026-01-01T00:00:00.000Z', end: null },
					status: {
						kind: 'REGISTERED',
						reference_number: 'SYNTHETIC',
						rate_override: null,
						deduction_claims: claims
					}
				}
			]);
			requireAccepted(declaration.value, 'write deduction declaration');
			for (const [period, expected] of [
				[JANUARY_2026, 350],
				[FEBRUARY_2026, 250]
			] as const) {
				const run = await writeRows(session, 'payroll_runs', 'create', [
					{ company_id: COMPANY_ID, period }
				]);
				requireAccepted(run.value, 'create deduction payroll');
				const [slip] = await session.query(
					'select statutory from payslips where payroll_run_id = $1 and employment_id = $2',
					[createdIds(run.value)[0], EMPLOYMENT_ID]
				);
				const tax = statutoryLines(slip.statutory).find(
					(row) => row.scheme_code === 'PUB_DEDUCTION'
				);
				assert.equal(tax?.employee_amount, expected);
				assert.equal(
					tax?.deduction_claims,
					undefined,
					'employee expense declarations are not payslip payments'
				);
			}
		} finally {
			await session.stop();
		}
	}
);

test(
	'saved child-claim declarations reach payroll with the tax year and entitlement share intact',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const rows = await publicSeedRows();
		const schemeId = 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaa98';
		rows.statutory_contributions!.push({
			id: schemeId,
			settings_id: JURISDICTION_ID,
			code: 'PUB_CHILD',
			name: 'Synthetic child relief',
			authority:
				'Invented transport case; legal amounts are tested against jurisdiction catalogues.',
			assessment_period: 'PAY_PERIOD',
			assessed_on: 'BASE',
			parts: [],
			elections: [],
			rules: [
				{ when: 'true', employee: '500.0 - 100.0 * scheme.child_claims.UNDER_18', employer: '0.0' }
			]
		});
		const session = await startPublicSeedHost('hr-child-claim', {
			seed: {
				stages: authoredSeedStages(templateManifestPath, publicSeedDirectory),
				rows,
				mapParameters: jsonSqlParameter
			}
		});
		try {
			const [employment] = await session.query(
				'select employee_id from employments where id = $1',
				[EMPLOYMENT_ID]
			);
			const claim = {
				relief_class: 'UNDER_18',
				full_count: 1,
				half_count: 1,
				reference: 'Synthetic declaration'
			};
			const declaration = await writeRows(session, 'employment_statutory_facts', 'create', [
				{
					employee_id: employment.employee_id,
					statutory_contribution_id: schemeId,
					effective_range: { start: '2026-01-01T00:00:00.000Z', end: null },
					status: {
						kind: 'REGISTERED',
						reference_number: 'SYNTHETIC',
						rate_override: null,
						child_claims: [
							{ ...claim, year: '2025', full_count: 9 },
							{ ...claim, year: '2026' }
						]
					}
				}
			]);
			requireAccepted(declaration.value, 'write child declaration');
			const run = await writeRows(session, 'payroll_runs', 'create', [
				{ company_id: COMPANY_ID, period: JANUARY_2026 }
			]);
			requireAccepted(run.value, 'create child-claim payroll');
			const [slip] = await session.query(
				'select statutory from payslips where payroll_run_id = $1 and employment_id = $2',
				[createdIds(run.value)[0], EMPLOYMENT_ID]
			);
			assert.equal(
				statutoryLines(slip.statutory).find((row) => row.scheme_code === 'PUB_CHILD')
					?.employee_amount,
				350
			);
		} finally {
			await session.stop();
		}
	}
);

test(
	'statutory declaration writes preserve prior-employer rebates and carry paid-period rebates into payroll',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const rows = await publicSeedRows();
		const schemeId = 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaa99';
		rows.statutory_contributions!.push({
			id: schemeId,
			settings_id: JURISDICTION_ID,
			code: 'PUB_REBATE',
			name: 'Synthetic rebate ledger',
			authority: 'Invented integration case; statutory amounts are tested separately.',
			assessment_period: 'PAY_PERIOD',
			assessed_on: 'BASE',
			parts: [],
			elections: [{ key: 'payment', type: 'number' }],
			rules: [
				{
					when: 'true',
					employee: '500.0 - scheme.year_to_date.rebate - scheme.elections.payment',
					employer: '0.0',
					rebate: 'scheme.elections.payment'
				}
			]
		});
		const session = await startPublicSeedHost('hr-rebate-ledger', {
			seed: {
				stages: authoredSeedStages(templateManifestPath, publicSeedDirectory),
				rows,
				mapParameters: jsonSqlParameter
			}
		});
		try {
			const [employment] = await session.query(
				'select employee_id from employments where id = $1',
				[EMPLOYMENT_ID]
			);
			const declaration = await writeRows(session, 'employment_statutory_facts', 'create', [
				{
					employee_id: employment.employee_id,
					statutory_contribution_id: schemeId,
					effective_range: { start: '2026-01-01T00:00:00.000Z', end: null },
					status: {
						kind: 'REGISTERED',
						reference_number: 'SYNTHETIC',
						rate_override: null,
						elections: { payment: 100 },
						opening: [
							{
								year: '2026',
								base: 0,
								employee: 0,
								employer: 0,
								rebate: 200,
								reference: 'Prior-employer declaration'
							}
						]
					}
				}
			]);
			requireAccepted(declaration.value, 'write rebate declaration');
			for (const [period, expected] of [
				[JANUARY_2026, 200],
				[FEBRUARY_2026, 100]
			] as const) {
				const run = await writeRows(session, 'payroll_runs', 'create', [
					{ company_id: COMPANY_ID, period }
				]);
				requireAccepted(run.value, 'create rebate payroll');
				const [slip] = await session.query(
					'select statutory from payslips where payroll_run_id = $1 and employment_id = $2',
					[createdIds(run.value)[0], EMPLOYMENT_ID]
				);
				const tax = statutoryLines(slip.statutory).find((row) => row.scheme_code === 'PUB_REBATE');
				assert.equal(tax?.employee_amount, expected);
				assert.equal(tax?.rebate_amount, 100);
			}
		} finally {
			await session.stop();
		}
	}
);

/**
 * T4: public-seed integration creates a payroll run (N payslips, 0 orphans) on bolt-server.
 * Not the in-memory createPublicPayrollWorld + transform path.
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
				'jurisdiction_settings',
				'companies',
				'statutory_contributions',
				'leave_catalogue',
				'claim_catalogue',
				'adhoc_catalogue',
				'allowance_catalogue',
				'employees',
				'shift_definitions',
				'jurisdiction_holidays',
				'shift_patterns',
				'employments',
				'employment_statutory_facts',
				'employment_terms',
				'leave_entries'
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

			const created = await writeRows(session, 'payroll_runs', 'create', [
				{ company_id: COMPANY_ID, period: JANUARY_2026 }
			]);
			assert.ok(
				created.status >= 200 && created.status < 300,
				`${CREATE_PAYROLL_COMMAND} returned ${created.status}: ${JSON.stringify(created.value)}`
			);
			requireAccepted(created.value, CREATE_PAYROLL_COMMAND);
			const [payrollRunId] = createdIds(created.value);

			const payslips = (await session.query(
				`select id, employment_id, statutory from payslips where payroll_run_id = $1`,
				[payrollRunId]
			)) as ReadonlyArray<{
				readonly id: string;
				readonly employment_id: string | null;
				readonly statutory: unknown;
			}>;

			// The monthly window includes the 2026-01-20 hire (window end). Terms start 2026-01-01 so
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
			const pubEpf = lines.filter((line) => line.scheme_code === 'PUB_EPF');
			assert.ok(
				pubEpf.length >= 1,
				`expected PUB_EPF statutory lines on the first payslip, got ${JSON.stringify(first.statutory)}`
			);
		} finally {
			await session.stop();
		}
	}
);

/**
 * H11: HQ Payroll HR may raise `payroll_runs.mutate.new`. The run's transform nests the payslips
 * as the workspace's own work, so the controller needs no grant on them; the run and its slips
 * are committed provisionally and held on the controller's approval route.
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
			const created = await writeRows(
				session,
				'payroll_runs',
				'create',
				[{ company_id: COMPANY_ID, period: FEBRUARY_2026 }],
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
			assert.equal(
				payload.resolution,
				'accepted',
				`H11 resolution: ${JSON.stringify(created.value)}`
			);
			const pending = payload.pendingApproval;
			assert.ok(
				pending !== null && typeof pending === 'object' && !Array.isArray(pending),
				`H11 expected pendingApproval, got ${JSON.stringify(created.value)}`
			);
			const approval = asRecord(pending, 'H11 pendingApproval');
			assert.equal(approval.collection, 'payroll_runs');
			assert.equal(approval.action, 'create');
			// The proposal is committed provisionally under the hold: the run stands, stamped with
			// the request, until the flow seals or restores it.
			const inserted = (await session.query(
				`select id, approval_id from payroll_runs where id = $1`,
				[String(approval.id)]
			)) as ReadonlyArray<{ readonly id: string; readonly approval_id: string | null }>;
			assert.equal(inserted.length, 1, 'a gated create is committed provisionally');
			assert.equal(inserted[0]?.approval_id, String(approval.requestId));
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
			const created = await writeRows(
				session,
				'payroll_runs',
				'create',
				[{ company_id: COMPANY_ID, period: FEBRUARY_2026 }],
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
			const payrollRunId = String(approval.id);

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
				{ state: { requestId: controllerState.requestId }, decision: 'approve' },
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
				{ state: { requestId: state.requestId }, decision: 'approve' },
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
				session.query(`select id, approval_id from payroll_runs where id = $1`, [
					payrollRunId
				]) as Promise<ReadonlyArray<{ readonly id: string; readonly approval_id: string | null }>>;
			let inserted = await loadRun();
			assert.equal(inserted.length, 1, `held run missing: ${JSON.stringify(inserted)}`);
			if (inserted[0]?.approval_id != null) {
				// The seal clears the stamp; the host dispatches it as a task, so drive it here.
				const resumed = await postGuestCommand(
					session.host.baseUrl,
					'collections.resume',
					{ requestId },
					managerHeaders
				);
				assert.ok(
					resumed.status >= 200 && resumed.status < 300,
					`collections.resume ${resumed.status}: ${JSON.stringify(resumed.value)}`
				);
				inserted = await loadRun();
			}
			assert.equal(inserted[0]?.approval_id, null, 'the seal clears the hold');
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
 * A3 command half. HQ Payroll HR `leave_entries.mutate.new` is approval-gated and does not expand.
 * Founder admin auto-commits (T4). Form toast remains headed.
 */
test(
	'public seed HQ Payroll HR leave create stays pending approval',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-a3-approval');
		try {
			const before = (await session.query(
				`select count(*)::int as n from leave_entries where employment_id = $1 and approval_id is null`,
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
				{ action: 'create', resource: 'leave_entries' },
				previewHeaders
			);
			assert.ok(
				explained.status >= 200 && explained.status < 300,
				`access.explain ${explained.status}: ${JSON.stringify(explained.value)}`
			);
			assert.equal(
				asRecord(explained.value, 'access.explain').allowed,
				true,
				`A3 explain create leave_entries: ${JSON.stringify(explained.value)}`
			);
			const created = await writeRows(
				session,
				'leave_entries',
				'create',
				[
					{
						employment_id: EMPLOYMENT_ID,
						catalogue_id: ANNUAL_LEAVE_CATALOGUE_ID,
						reference: 'PUBLIC-PENDING-2026-04-15',
						from_date: '2026-04-15',
						to_date: '2026-04-15',
						half_day_start: false,
						half_day_end: false,
						days: null,
						reason: null
					}
				],
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
			assert.equal(approval.collection, 'leave_entries');
			assert.equal(approval.action, 'create');
			assert.equal(typeof approval.requestId, 'string');
			// Committed provisionally: one more row, stamped with the request, until the flow decides.
			const after = (await session.query(
				`select count(*)::int as n from leave_entries where employment_id = $1 and approval_id is null`,
				[EMPLOYMENT_ID]
			)) as ReadonlyArray<{ readonly n: number }>;
			assert.equal(after[0]?.n, before[0]?.n, 'a gated create is not in force until sealed');
			const held = (await session.query(`select approval_id from leave_entries where id = $1`, [
				String(approval.id)
			])) as ReadonlyArray<{ readonly approval_id: string | null }>;
			assert.equal(held[0]?.approval_id, String(approval.requestId));
		} finally {
			await session.stop();
		}
	}
);
