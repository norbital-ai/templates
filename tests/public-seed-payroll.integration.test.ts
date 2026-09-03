import test from 'node:test';
import assert from 'node:assert/strict';
import {
	authoredSeedStages,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
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
			assert.ok(employments.length >= 4, `public seed floor is 4 employments, got ${employments.length}`);
			const employmentIds = new Set(employments.map((row) => row.id));
			assert.ok(employmentIds.has(EMPLOYMENT_ID));
			const numbered = (await session.query(
				`select employee_number from employments order by employee_number`
			)) as ReadonlyArray<{ readonly employee_number: string }>;
			assert.deepEqual(
				numbered.map((row) => row.employee_number),
				['PUB-EMP-0001', 'PUB-EMP-0002', 'PUB-EMP-0003', 'PUB-EMP-0004']
			);
			const nonCitizen = (await session.query(
				`select id from employees where id = $1`,
				['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4']
			)) as ReadonlyArray<{ readonly id: string }>;
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

			const first = payslips.find((payslip) => payslip.employment_id === EMPLOYMENT_ID) ?? payslips[0];
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
