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
	COMPANY_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { leaveEntitlementIdFor } from '../src/lib/leave/entitlements.ts';
import { leaveBalance } from '../src/lib/leave/ledger.ts';

/** Both leavers go on the same day; the ledger is read as at that day. */
const EXIT_DATE = '2026-04-30';

const patternOf = (): unknown => {
	const terms = JSON.parse(
		readFileSync(new URL('./fixtures/seed/employment_terms.json', import.meta.url), 'utf8')
	) as ReadonlyArray<{ readonly shift_pattern_id: unknown }>;
	return terms[0]?.shift_pattern_id;
};

/**
 * Leaving early, end to end on the public seed.
 *
 * Two January-2026 joiners on MYR 2,600 a month leave on 30 April 2026. The PUB statute pays
 * unused annual leave out at monthly pay ÷ 26 and forfeits it on dismissal for misconduct. The
 * one who resigned gets an ENCASHED line, priced by payroll on the April slip at 2,600 / 26 a
 * day; the one dismissed for misconduct gets an EXPIRED line and no money. Nobody typed anything
 * but the exit.
 */
test(
	'public seed exit encashes unused leave by the statute and forfeits it on misconduct',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-exit-payout');
		try {
			const hire = async (number: string, exitReason: string) => {
				const employeeId = crypto.randomUUID();
				const employmentId = crypto.randomUUID();
				await session.query(
					`insert into employees (id, name, date_of_birth, gender, marital_status, spouse_status, dependents_count)
					 values ($1, $2, $3, $4, $5, $6, $7)`,
					[employeeId, `Exit ${number}`, '1990-05-05', 'MALE', 'SINGLE', 'NONE', 0]
				);
				await session.query(
					`insert into employments (id, employee_id, company_id, employee_number, hire_date, exit_date, exit_reason, effective_range)
					 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
					[
						employmentId,
						employeeId,
						COMPANY_ID,
						number,
						'2026-01-01',
						EXIT_DATE,
						exitReason,
						{ start: '2026-01-01', end: EXIT_DATE }
					]
				);
				await session.query(
					`insert into employment_terms (id, employment_id, base_salary, pay_frequency, work_classification,
						statutory_work_category, employment_type, job_title, shift_pattern_id, effective_range)
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
						{ start: '2026-01-01', end: null }
					]
				);
				return employmentId;
			};
			const resigned = await hire('PUB-EXIT-RESIGNED', 'RESIGNATION');
			const dismissed = await hire('PUB-EXIT-MISCONDUCT', 'MISCONDUCT');
			const started = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{ name: 'leave_ledger_refresh', input: { company_id: COMPANY_ID } },
				bearerHeaders(session.credential)
			);
			assert.ok(started.status < 300, JSON.stringify(started.value));

			const entitlementOf = (employment_id: string) =>
				leaveEntitlementIdFor({ employment_id, leave_code: 'ANNUAL', leave_year: 2026 });
			const closing = async (employmentId: string) =>
				(await session.query(
					`select kind, days, reason, source_key from leave_entries
					 where leave_entitlement_id = $1 and source_key = $2`,
					[entitlementOf(employmentId), `exit:${entitlementOf(employmentId)}`]
				)) as ReadonlyArray<Record<string, unknown>>;
			const paid = await closing(resigned);
			assert.equal(paid.length, 1, JSON.stringify(paid));
			assert.equal(paid[0]?.kind, 'ENCASHED');
			const days = -Number(paid[0]?.days);
			assert.ok(days > 0, `a positive balance was paid out: ${JSON.stringify(paid)}`);
			const forfeited = await closing(dismissed);
			assert.equal(forfeited.length, 1, JSON.stringify(forfeited));
			assert.equal(forfeited[0]?.kind, 'EXPIRED');
			assert.match(String(forfeited[0]?.reason), /misconduct/);
			for (const employmentId of [resigned, dismissed]) {
				const status = await session.query(`select status from leave_entitlements where id = $1`, [
					entitlementOf(employmentId)
				]);
				assert.equal(status[0]?.status, 'CLOSED');
			}

			/**
			 * Closed means nothing is left, whichever way the balance went out.
			 *
			 * Encashment and forfeiture are different lines and different money, and both must land
			 * the ledger on exactly zero: a leaver carries no balance forward and is owed nothing
			 * further. Nothing asserted this — the payout line's own `days` was read back from the
			 * same line the assertion was about, so a close that paid out half a balance and left the
			 * rest standing would have satisfied every check above.
			 */
			for (const [label, employmentId] of [
				['encashed on resignation', resigned],
				['forfeited on misconduct', dismissed]
			] as const) {
				const entries = (await session.query(
					`select kind, days, effective_on, approval_id from leave_entries
					 where leave_entitlement_id = $1`,
					[entitlementOf(employmentId)]
				)) as ReadonlyArray<Record<string, unknown>>;
				assert.ok(entries.length > 0, `${label}: the entitlement has a ledger to close`);
				assert.equal(
					leaveBalance(entries as never, EXIT_DATE),
					0,
					`${label}: the ledger did not close on zero — ${JSON.stringify(entries)}`
				);
			}

			// The final slip is the April run: it covers the exit date, whatever the cutoff names.
			const runId = crypto.randomUUID();
			const created = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(session.schemaFingerprint, {
					action: 'mutate',
					collection: 'payroll_runs',
					rows: [
						{ action: 'create', values: { id: runId, company_id: COMPANY_ID, period: '2026-04' } }
					]
				}),
				bearerHeaders(session.credential)
			);
			requireAccepted(created.value, 'april run prints the exit payout');
			const slips = (await session.query(
				`select employment_id, base from payslips where payroll_run_id = $1 and employment_id in ($2, $3)`,
				[runId, resigned, dismissed]
			)) as ReadonlyArray<{
				readonly employment_id: string;
				readonly base: ReadonlyArray<{ component_code: string; amount: unknown }>;
			}>;
			const resignedSlip = slips.find((slip) => slip.employment_id === resigned);
			assert.ok(
				resignedSlip != null,
				`the resigned employee is on the April run: ${JSON.stringify(slips)}`
			);
			const line = resignedSlip.base.find((row) => row.component_code === 'LEAVE_PAYOUT');
			assert.ok(line != null, `LEAVE_PAYOUT base line: ${JSON.stringify(resignedSlip.base)}`);
			assert.equal(Number(line.amount), Math.round(days * 100 * 100) / 100);
			const dismissedSlip = slips.find((slip) => slip.employment_id === dismissed);
			assert.ok(
				dismissedSlip == null ||
					!dismissedSlip.base.some((row) => row.component_code === 'LEAVE_PAYOUT'),
				'a forfeited balance prints nothing'
			);
		} finally {
			await session.stop();
		}
	}
);
