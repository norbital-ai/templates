import assert from 'node:assert/strict';
import test from 'node:test';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	FEBRUARY_2026,
	JANUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

/**
 * HR19 (b): an Allowance adjustment against a settled payslip line in the same family and contract.
 *
 * January pays the fixture employment its standing TRANSPORT allowance and is marked paid. The
 * controller (HQ Payroll HR) then posts a reversal naming that settled line; the next regular run
 * pays exactly the negated amount, the frozen January payslip is byte-for-byte what it was, and an
 * Employee cannot post the same entry.
 */
type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
type Row = Readonly<Record<string, unknown>>;

const TRANSPORT_ID = '77777777-7777-4777-8777-777777777777';
const MUTATE = 'collections.mutate';

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
	const runId = crypto.randomUUID();
	const created = await postGuestCommand(
		session.host.baseUrl,
		MUTATE,
		mutationPush(session.schemaFingerprint, {
			action: 'mutate',
			collection: 'payroll_runs',
			rows: [{ action: 'create', values: { id: runId, company_id: COMPANY_ID, period } }]
		}),
		bearerHeaders(session.credential)
	);
	assert.ok(
		created.status >= 200 && created.status < 300,
		`${period} create ${created.status}: ${JSON.stringify(created.value)}`
	);
	requireAccepted(created.value, `${period} create`);
	return runId;
}

async function markPaid(session: Session, runId: string): Promise<void> {
	const [run] = (await session.query('select row_version from payroll_runs where id = $1', [
		runId
	])) as ReadonlyArray<{ readonly row_version: number | string }>;
	assert.ok(run, 'the run exists');
	const paid = await postGuestCommand(
		session.host.baseUrl,
		MUTATE,
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
		bearerHeaders(session.credential)
	);
	requireAccepted(paid.value, 'mark paid');
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
	postGuestCommand(
		session.host.baseUrl,
		MUTATE,
		mutationPush(session.schemaFingerprint, {
			action: 'mutate',
			collection: 'allowance_requests',
			rows: [
				{
					action: 'create',
					values: {
						id: crypto.randomUUID(),
						employment_id: EMPLOYMENT_ID,
						allowance_catalogue_id: TRANSPORT_ID,
						amount: 310,
						recurrence: { kind: 'ONE_OFF', on: `${FEBRUARY_2026}-15` },
						as_adjustment_entry: true
					}
				}
			]
		}),
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
			const settled = january.adjustments.find(
				(row) => row.label === 'TRANSPORT' && row.bucket === 'EARNING'
			);
			assert.ok(settled, `January settled the allowance: ${JSON.stringify(january.adjustments)}`);
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
			// Both entries retain the Allowance catalogue: the standing amount pays and its adjustment reverses it.
			const allowance = february.adjustments.filter((row) => row.label === 'TRANSPORT');
			assert.equal(
				allowance.length,
				2,
				`February still carries the standing allowance: ${JSON.stringify(february.adjustments)}`
			);
			assert.deepEqual(
				allowance.map(signed).sort((a, b) => a - b),
				[-310, 310],
				'the standing Allowance and exactly its negated settled amount'
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
