import { it } from 'vitest';
import assert from 'node:assert/strict';
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
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from '../helpers/public-seed-host.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;

const create = async (
	session: Session,
	collection: string,
	values: Readonly<Record<string, unknown>>,
	headers: Readonly<Record<string, string>>
) => {
	const response = await postGuestCommand(
		session.host.baseUrl,
		'collections.mutate',
		mutationPush(session.schemaFingerprint, {
			action: 'mutate',
			collection,
			rows: [{ action: 'create', values }]
		}),
		headers
	);
	assert.ok(
		response.status >= 200 && response.status < 300,
		`${collection} create returned ${response.status}: ${JSON.stringify(response.value)}`
	);
	return asRecord(response.value, `${collection} create`);
};

/**
 * The incentive boundary, end to end on a real host: the public lineage states an
 * `on_exceed: INCENTIVE` daily limit of eleven worked hours beside the statutory twelve-hour and
 * 104-hour ceilings. One weekday punch of 07:30 to 21:30 with a one-hour break is thirteen worked
 * hours on a 07:30–16:30 shift: five overtime hours, of which the two past the boundary settle as
 * incentive OT at the same 1.5× value. The row carries punches only — no plan — so it is evidence
 * on a base day, never a roster override.
 */
it(
	'a weekday worked past the lineage incentive boundary pays the surplus as incentive OT',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS * 2 },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-e2e-incentive');
		try {
			// The founder: the one subject that lands a work day and a run without an approval step
			// (no team mutates work_days except the kiosk).
			const founder = bearerHeaders(session.credential);
			const workDayId = crypto.randomUUID();
			const day = await create(
				session,
				'work_days',
				{
					id: workDayId,
					employment_id: EMPLOYMENT_ID,
					work_date: '2026-02-03',
					// Instants are UTC: 07:30 to 21:30 in Kuala Lumpur on 3 February.
					worked_intervals: [
						{ start: '2026-02-02T23:30:00.000Z', end: '2026-02-03T13:30:00.000Z' }
					],
					break_minutes: 60
				},
				founder
			);
			requireAccepted(day, 'work day punch');
			assert.equal(
				day.pendingApproval,
				undefined,
				`the founder lands the punch: ${JSON.stringify(day)}`
			);
			const stored = (await session.query(
				'select shift_definition_id, planned_origin from work_days where id = $1',
				[workDayId]
			)) as ReadonlyArray<{ shift_definition_id: string | null; planned_origin: string | null }>;
			assert.deepEqual(
				stored,
				[{ shift_definition_id: null, planned_origin: null }],
				'a punch is evidence on the base day, not a roster override'
			);

			const runId = crypto.randomUUID();
			const run = await create(
				session,
				'payroll_runs',
				{ id: runId, company_id: COMPANY_ID, period: FEBRUARY_2026 },
				founder
			);
			requireAccepted(run, 'payroll run create');
			assert.equal(
				run.pendingApproval,
				undefined,
				`the founder lands the run: ${JSON.stringify(run)}`
			);

			const lines = (
				(await session.query(
					`select adjustments from payslips p where p.payroll_run_id = $1 and p.employment_id = $2`,
					[runId, EMPLOYMENT_ID]
				)) as ReadonlyArray<{
					adjustments: ReadonlyArray<{ label: string; quantity: unknown; amount: unknown }>;
				}>
			)
				.flatMap((row) => row.adjustments)
				.filter((line) => line.label.startsWith('OT_'))
				.map((line) => ({
					label: line.label,
					quantity: Number(line.quantity),
					amount: Number(line.amount)
				}))
				.toSorted((left, right) => left.label.localeCompare(right.label));
			assert.deepEqual(
				lines.map((line) => [line.label, line.quantity, line.amount]),
				[
					['OT_EXCESS_ORDINARY_BEYOND_NORMAL_0', 2, 49.77],
					['OT_ORDINARY_BEYOND_NORMAL_0', 3, 74.66]
				],
				`overtime lines: ${JSON.stringify(lines)}`
			);
			const captured = (await session.query(
				`select count(*)::int as n from work_days w
				 join payslips p on p.id = w.settled_payslip_id
				 where p.payroll_run_id = $1 and w.id = $2`,
				[runId, workDayId]
			)) as ReadonlyArray<{ n: number }>;
			assert.equal(captured[0]?.n, 1, 'the punch is captured as the run input that priced it');
		} finally {
			await session.stop();
		}
	}
);
