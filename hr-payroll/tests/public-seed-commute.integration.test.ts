import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import {
	ANNUAL_LEAVE_TYPE_ID,
	COMPANY_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	publicSeedDirectory,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { leaveAccountIdFor } from '../src/lib/leave/entitlements.ts';

const patternOf = (): unknown => {
	const terms = JSON.parse(
		readFileSync(new URL('./fixtures/seed/employment_terms.json', import.meta.url), 'utf8')
	) as ReadonlyArray<{ readonly work_pattern: unknown }>;
	const pattern = terms[0]?.work_pattern;
	assert.ok(pattern != null, 'public terms fixture carries a reusable work pattern');
	return pattern;
};

/**
 * HR settlement union, COMMUTE arm, end-to-end on the public seed.
 *
 * A March-2025 joiner on a MYR 2,600 monthly salary whose annual plan commutes
 * (÷26) gets a 2025 account that cashes out at year end: one COMMUTED −8 line
 * receipting 800 owed, the old account closed, and nothing carried into 2026.
 * The payout row the close wrote prints on the January slip as a LEAVE_PAYOUT base line.
 */
test(
	'public seed commuted year posts its cash receipt and carries nothing forward',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-commute');
		try {
			const employeeId = crypto.randomUUID();
			const employmentId = crypto.randomUUID();
			await session.query(
				`insert into employees (id, name, date_of_birth, gender, marital_status, spouse_status, dependents_count)
				 values ($1, $2, $3, $4, $5, $6, $7)`,
				[employeeId, 'Commute Fixture Employee', '1994-02-02', 'FEMALE', 'SINGLE', 'NONE', 0]
			);
			await session.query(
				`insert into employments (id, employee_id, company_id, employee_number, hire_date, effective_range)
				 values ($1, $2, $3, $4, $5, $6)`,
				[
					employmentId,
					employeeId,
					COMPANY_ID,
					'PUB-EMP-COMMUTE',
					'2025-03-01',
					{ start: '2025-03-01', end: null }
				]
			);
			await session.query(
				`insert into employment_terms (id, employment_id, base_salary, pay_frequency, work_classification,
					statutory_work_category, employment_type, job_title, work_pattern, effective_range)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
				[
					crypto.randomUUID(),
					employmentId,
					{ value: 2600, currency: 'MYR' },
					'MONTHLY',
					'EA_COVERED',
					'NON_MANUAL',
					'PERMANENT',
					'Clerk',
					patternOf(),
					{ start: '2025-03-01', end: null }
				]
			);
			await session.query(`update leave_types set accrual = $1 where id = $2`, [
				{
					kind: 'UPFRONT',
					settlement: { settlement: 'COMMUTE', pay_basis: 'ORDINARY_DIV26' }
				},
				ANNUAL_LEAVE_TYPE_ID
			]);
			const started = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{ name: 'leave_ledger_refresh', input: { employment_ids: [employmentId] } },
				bearerHeaders(session.credential)
			);
			assert.ok(
				started.status >= 200 && started.status < 300,
				`automations.start ${started.status}: ${JSON.stringify(started.value)}`
			);

			const account2025 = leaveAccountIdFor({
				employment_id: employmentId,
				leave_code: 'ANNUAL',
				leave_year: 2025
			});
			const accounts = await session.query(
				`select id, status, entitlement_days from leave_accounts where id = $1`,
				[account2025]
			);
			assert.equal(accounts.length, 1, 'the 2025 annual account was generated');
			assert.equal(Number(accounts[0].entitlement_days), 8);
			assert.equal(accounts[0].status, 'CLOSED');

			const entries = (await session.query(
				`select kind, days, source_key, reason from leave_entries
				 where leave_account_id = $1 order by effective_on, kind`,
				[account2025]
			)) as ReadonlyArray<Record<string, unknown>>;
			const commuted = entries.filter((row) => row.kind === 'COMMUTED');
			assert.equal(commuted.length, 1, JSON.stringify(entries));
			assert.equal(Number(commuted[0]?.days), -8);
			assert.equal(commuted[0]?.source_key, `close:${account2025}:commute`);
			assert.match(String(commuted[0]?.reason), /8 unused days/);
			const rerun = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{ name: 'leave_ledger_refresh', input: { employment_ids: [employmentId] } },
				bearerHeaders(session.credential)
			);
			assert.ok(rerun.status < 300, JSON.stringify(rerun.value));
			assert.equal(
				(
					await session.query(
						`select id from leave_entries where leave_account_id = $1 and kind = 'COMMUTED'`,
						[account2025]
					)
				).length,
				1,
				'a rerun restates the close instead of duplicating it'
			);
			// The line is dated 31 December; under the 21st cutoff that is the January period, and the
			// January slip prints it as a LEAVE_PAYOUT base line priced at 8 x 2,600 / 26 = 800.
			const runId = crypto.randomUUID();
			const created = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(session.schemaFingerprint, {
					action: 'mutate',
					collection: 'payroll_runs',
					rows: [
						{ action: 'create', values: { id: runId, company_id: COMPANY_ID, period: '2026-01' } }
					]
				}),
				bearerHeaders(session.credential)
			);
			requireAccepted(created.value, 'january run prints the commute payout');
			const slips = (await session.query(
				`select base from payslips where payroll_run_id = $1 and employment_id = $2`,
				[runId, employmentId]
			)) as ReadonlyArray<{
				readonly base: ReadonlyArray<{ component_code: string; amount: unknown }>;
			}>;
			assert.equal(slips.length, 1, 'the commuted employee is on the January run');
			const line = slips[0]?.base.find((row) => row.component_code === 'LEAVE_PAYOUT');
			assert.ok(line != null, `LEAVE_PAYOUT base line: ${JSON.stringify(slips[0]?.base)}`);
			assert.equal(Number(line.amount), 800);

			const carried = await session.query(
				`select kind from leave_entries where leave_account_id = $1 and kind = 'CARRY_FORWARD'`,
				[
					leaveAccountIdFor({
						employment_id: employmentId,
						leave_code: 'ANNUAL',
						leave_year: 2026
					})
				]
			);
			assert.equal(carried.length, 0, 'a commuted year carries nothing forward');
		} finally {
			await session.stop();
		}
	}
);
