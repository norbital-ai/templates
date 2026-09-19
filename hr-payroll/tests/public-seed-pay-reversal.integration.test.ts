import assert from 'node:assert/strict';
import test from 'node:test';
import { asRecord, bearerHeaders, requireAccepted } from '@norbital-ai/test-utilities';
import { createdIds, writeRows } from './helpers/write.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	FEBRUARY_2026,
	JANUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { markRunPaid } from './helpers/mark-paid.ts';

/**
 * HR19 (b): a claw-back of a settled line, as an ad hoc request on the same contract.
 *
 * January pays the fixture employment the TRANSPORT allowance on its contract and is marked paid.
 * The controller (HQ Payroll HR) then posts an ad hoc claw-back of that amount; the next regular
 * run pays the allowance again and exactly the negated amount beside it, the frozen January
 * payslip is byte-for-byte what it was, and an Employee cannot post the same request.
 */
type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
type Row = Readonly<Record<string, unknown>>;

/** The public seed's one ad hoc class, which a controller may raise by hand with the claw-back tick. */
const ADHOC_CLASS_ID = '77777777-7777-4777-8777-777777777778';

const teamHeaders = (session: Session, team: string) => ({
	...bearerHeaders(session.credential),
	'x-colony-impersonated-team': team
});

/** `+` for money added to the employee, `-` for money taken, by the frozen bucket. */
const signed = (row: Row): number => {
	const amount = Number(row.amount);
	return row.bucket === 'DEDUCTION' || row.bucket === 'ABSENCE' ? -amount : amount;
};

async function createRun(session: Session, period: string): Promise<string> {
	const created = await writeRows(session, 'payroll_runs', 'create', [
		{ company_id: COMPANY_ID, period }
	]);
	assert.ok(
		created.status >= 200 && created.status < 300,
		`${period} create ${created.status}: ${JSON.stringify(created.value)}`
	);
	requireAccepted(created.value, `${period} create`);
	return createdIds(created.value)[0]!;
}

async function markPaid(session: Session, runId: string): Promise<void> {
	await markRunPaid(session, runId);
}

async function payslipOf(session: Session, runId: string) {
	const [payslip] = (await session.query(
		'select id, gross::text as gross, net::text as net, row_version from payslips where payroll_run_id = $1 and employment_id = $2',
		[runId, EMPLOYMENT_ID]
	)) as ReadonlyArray<Row>;
	assert.ok(payslip, `a payslip for ${EMPLOYMENT_ID} on run ${runId}`);
	const [row] = (await session.query('select adjustments from payslips where id = $1', [
		String(payslip.id)
	])) as ReadonlyArray<{ readonly adjustments: ReadonlyArray<Row> }>;
	// The line is found by label and bucket; a claw-back names no payslip, it is a signed entry.
	const adjustments = (row?.adjustments ?? []).map((line) => ({ ...line, id: payslip.id }));
	return { payslip, adjustments };
}

const postReversal = (session: Session, headers: Readonly<Record<string, string>>) =>
	writeRows(
		session,
		'adhoc_requests',
		'create',
		[
			{
				employment_id: EMPLOYMENT_ID,
				catalogue_id: ADHOC_CLASS_ID,
				amount: 310,
				event_date: `${FEBRUARY_2026}-05`,
				reason: 'claw back January transport',
				as_adjustment_entry: true
			}
		],
		headers
	);

test(
	'a controller reversal against a settled line pays the negated amount next run and leaves the paid payslip untouched',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-hr19b-reversal');
		try {
			const januaryRun = await createRun(session, JANUARY_2026);
			await markPaid(session, januaryRun);
			const january = await payslipOf(session, januaryRun);
			const [januaryRow] = (await session.query('select base from payslips where id = $1', [
				String(january.payslip.id)
			])) as ReadonlyArray<{ readonly base: ReadonlyArray<Row> }>;
			const settled = januaryRow.base.find((row) => row.component_code === 'TRANSPORT');
			assert.ok(settled, `January paid the allowance: ${JSON.stringify(januaryRow.base)}`);
			assert.equal(Number(settled.amount), 310);

			const employee = await postReversal(session, teamHeaders(session, 'Employee'));
			assert.ok(
				employee.status >= 400 ||
					JSON.stringify(employee.value).match(/rejected|denied|not allowed|policy/i),
				`an employee cannot post a reversal: ${employee.status} ${JSON.stringify(employee.value)}`
			);

			const posted = await postReversal(session, teamHeaders(session, 'HQ Payroll HR'));
			assert.ok(
				posted.status >= 200 && posted.status < 300,
				`controller reversal ${posted.status}: ${JSON.stringify(posted.value)}`
			);
			const payload = asRecord(posted.value, 'controller reversal');
			assert.equal(payload.resolution, 'accepted', JSON.stringify(posted.value));
			assert.equal(
				payload.pendingApproval,
				undefined,
				`a controller correction is not held: ${JSON.stringify(posted.value)}`
			);

			const februaryRun = await createRun(session, FEBRUARY_2026);
			const february = await payslipOf(session, februaryRun);
			// The allowance on the contract pays again as a base line; the claw-back is the ad hoc
			// line beside it, settled the opposite way.
			const [februaryRow] = (await session.query('select base from payslips where id = $1', [
				String(february.payslip.id)
			])) as ReadonlyArray<{ readonly base: ReadonlyArray<Row> }>;
			assert.equal(
				Number(februaryRow.base.find((row) => row.component_code === 'TRANSPORT')?.amount),
				310,
				`February still carries the allowance: ${JSON.stringify(februaryRow.base)}`
			);
			const clawback = february.adjustments.filter((row) => row.family === 'ADHOC');
			assert.deepEqual(
				clawback.map(signed),
				[-310],
				`exactly the negated settled amount: ${JSON.stringify(february.adjustments)}`
			);
			assert.equal(
				Number(february.payslip.gross),
				Number(january.payslip.gross) - 310,
				'February gross is January gross less the reversed line'
			);

			const januaryAfter = await payslipOf(session, januaryRun);
			assert.deepEqual(januaryAfter, january, 'the paid January payslip is unchanged');
		} finally {
			await session.stop();
		}
	}
);
