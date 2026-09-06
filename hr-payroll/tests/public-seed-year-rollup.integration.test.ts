import test from 'node:test';
import assert from 'node:assert/strict';
import {
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const MONTHS = Array.from(
	{ length: 12 },
	(_, index) => `2026-${String(index + 1).padStart(2, '0')}`
);

type StatutoryLine = {
	readonly scheme_code: string;
	readonly base_amount: number;
	readonly employee_amount: number;
	readonly employer_amount: number;
};

const statutoryLines = (value: unknown): StatutoryLine[] => {
	const raw = typeof value === 'string' ? JSON.parse(value) : value;
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(row): row is StatutoryLine =>
			typeof row === 'object' && row !== null && typeof row.scheme_code === 'string'
	);
};

/**
 * HR3: twelve-month roll-up on public fixtures.
 *
 * Twelve REGULAR runs, each marked PAID before the next is created (the settlement
 * order the hooks enforce). December's year-to-date is a SUM over the twelve paid
 * payslips — YTD lives nowhere else — and the public schemes carry no annual cap,
 * so every month's 11%/13% PUB-EPF charge must stay linear to the cent across the
 * whole year: any clipped cap would break that line.
 */
test(
	'public seed twelve monthly runs roll up to a linear December year-to-date',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-year-rollup');
		try {
			const headers = bearerHeaders(session.credential);
			for (const period of MONTHS) {
				const runId = crypto.randomUUID();
				const created = await postGuestCommand(
					session.host.baseUrl,
					'collections.mutate',
					mutationPush(session.schemaFingerprint, {
						action: 'mutate',
						collection: 'payroll_runs',
						rows: [{ action: 'create', values: { id: runId, company_id: COMPANY_ID, period } }]
					}),
					headers
				);
				requireAccepted(created.value, `create ${period}`);
				const [run] = (await session.query(`select row_version from payroll_runs where id = $1`, [
					runId
				])) as ReadonlyArray<{ readonly row_version: number }>;
				const paid = await postGuestCommand(
					session.host.baseUrl,
					'collections.mutate',
					mutationPush(
						session.schemaFingerprint,
						{
							action: 'mutate',
							collection: 'payroll_runs',
							rows: [{ action: 'update', values: { id: runId, lifecycle: 'PAID' } }]
						},
						[
							{
								row: { collection: 'payroll_runs', recordId: runId },
								rowVersion: Number(run.row_version)
							}
						]
					),
					headers
				);
				requireAccepted(paid.value, `mark ${period} paid`);
			}

			const runs = (await session.query(
				`select id, period, lifecycle from payroll_runs order by period`
			)) as ReadonlyArray<{
				readonly id: string;
				readonly period: string;
				readonly lifecycle: string;
			}>;
			assert.deepEqual(
				runs.map((row) => row.period),
				MONTHS
			);
			assert.ok(
				runs.every((row) => row.lifecycle === 'PAID'),
				JSON.stringify(runs)
			);

			const slips = (await session.query(
				`select payslips.id, payslips.employment_id, payslips.gross,
					payslips.total_deductions, payslips.net, payslips.statutory, payroll_runs.period
				 from payslips join payroll_runs on payroll_runs.id = payslips.payroll_run_id
				 order by payroll_runs.period, payslips.employment_id`
			)) as ReadonlyArray<{
				readonly id: string;
				readonly employment_id: string | null;
				readonly gross: unknown;
				readonly total_deductions: unknown;
				readonly net: unknown;
				readonly statutory: unknown;
				readonly period: string;
			}>;
			assert.equal(slips.length, 48, 'one slip per employment per month');
			const employments = (await session.query(`select id from employments`)) as ReadonlyArray<{
				readonly id: string;
			}>;
			const employmentIds = new Set(employments.map((row) => row.id));
			assert.equal(
				slips.filter((slip) => slip.employment_id == null || !employmentIds.has(slip.employment_id))
					.length,
				0,
				'no orphan payslips across the year'
			);

			const mine = slips.filter((slip) => slip.employment_id === EMPLOYMENT_ID);
			assert.equal(mine.length, 12, 'twelve slips for the fixture employment');
			let ytdGross = 0;
			let ytdNet = 0;
			let ytdBase = 0;
			let ytdEmployee = 0;
			let ytdEmployer = 0;
			for (const slip of mine) {
				const gross = Number(slip.gross);
				const net = Number(slip.net);
				assert.equal(net, gross - Number(slip.total_deductions), `net ties out in ${slip.period}`);
				const line = statutoryLines(slip.statutory).find(
					(candidate) => candidate.scheme_code === 'PUB-EPF'
				);
				assert.ok(line, `PUB-EPF line on the ${slip.period} slip`);
				assert.ok(
					Math.abs(line.employee_amount - 0.11 * line.base_amount) <= 0.01,
					`${slip.period}: 11% employee charge stays linear (no cap clip)`
				);
				assert.ok(
					Math.abs(line.employer_amount - 0.13 * line.base_amount) <= 0.01,
					`${slip.period}: 13% employer charge stays linear (no cap clip)`
				);
				ytdGross += gross;
				ytdNet += net;
				ytdBase += line.base_amount;
				ytdEmployee += line.employee_amount;
				ytdEmployer += line.employer_amount;
			}
			assert.ok(
				Math.abs(ytdEmployee - 0.11 * ytdBase) <= 0.12,
				`annual employee EPF ${ytdEmployee} is 11% of the ${ytdBase} annual base within a cent a month`
			);
			assert.ok(
				Math.abs(ytdEmployer - 0.13 * ytdBase) <= 0.12,
				`annual employer EPF ${ytdEmployer} is 13% of the ${ytdBase} annual base within a cent a month`
			);
			const december = slips.filter((slip) => slip.period === '2026-12');
			assert.equal(december.length, 4, 'December settles the full headcount');
			assert.equal(
				Number(december.find((slip) => slip.employment_id === EMPLOYMENT_ID)?.gross),
				Number(mine[11]?.gross),
				'December slip closes the year-to-date run'
			);
			assert.ok(ytdGross > 0 && ytdNet > 0, 'a year of paid work rolls up to positive totals');
		} finally {
			await session.stop();
		}
	}
);
