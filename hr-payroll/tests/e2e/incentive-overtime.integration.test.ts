import { it } from 'vitest';
import assert from 'node:assert/strict';
import { asRecord, bearerHeaders, requireAccepted } from '@norbital-ai/test-utilities';
import { createdIds, writeRows } from '../helpers/write.ts';
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
	const response = await writeRows(session, collection, 'create', [values], headers);
	assert.ok(
		response.status >= 200 && response.status < 300,
		`${collection} create returned ${response.status}: ${JSON.stringify(response.value)}`
	);
	return asRecord(response.value, `${collection} create`);
};

/**
 * Planned incentive hours, end to end on a real host. The public lineage's 1.5 band names
 * `limits.daily_total` — twelve clock hours, eleven net of a one-hour break — so that daily limit
 * splits planned overtime. The day plans a total of five overtime hours on its 07:30–16:30 base
 * shift (eight net): the write stores three within the limit as `approved_overtime_hours` and two
 * beyond it as `incentive_hours`, and payroll settles them as OVERTIME and INCENTIVE, both at 1.5×.
 * The punch of 07:30 to 21:30 only confirms the day was worked. The row carries no plan code, so it
 * is evidence on a base day, never a roster override.
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
			const day = await create(
				session,
				'work_days',
				{
					employment_id: EMPLOYMENT_ID,
					work_date: '2026-02-03',
					// Instants are UTC: 07:30 to 21:30 in Kuala Lumpur on 3 February.
					worked_intervals: [
						{ start: '2026-02-02T23:30:00.000Z', end: '2026-02-03T13:30:00.000Z' }
					],
					// The day's TOTAL planned overtime: the write splits it at the daily limit.
					approved_overtime_hours: 5
				},
				founder
			);
			requireAccepted(day, 'work day punch');
			assert.equal(
				day.pendingApproval,
				undefined,
				`the founder lands the punch: ${JSON.stringify(day)}`
			);
			const [workDayId] = createdIds(day);
			const stored = (await session.query(
				'select shift_definition_id, approved_overtime_hours::float8 as approved, incentive_hours::float8 as incentive from work_days where id = $1',
				[workDayId]
			)) as ReadonlyArray<{
				shift_definition_id: string | null;
				approved: number | null;
				incentive: number | null;
			}>;
			assert.deepEqual(
				stored,
				[{ shift_definition_id: null, approved: 3, incentive: 2 }],
				'three planned hours within the daily limit, two beyond it; no roster override'
			);

			const run = await create(
				session,
				'payroll_runs',
				{ company_id: COMPANY_ID, period: FEBRUARY_2026 },
				founder
			);
			requireAccepted(run, 'payroll run create');
			const [runId] = createdIds(run);
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
					adjustments: ReadonlyArray<{
						component_code: string;
						label: string;
						quantity: unknown;
						amount: unknown;
					}>;
				}>
			)
				.flatMap((row) => row.adjustments)
				.filter((line) => line.component_code === 'OVERTIME' || line.component_code === 'INCENTIVE')
				.map((line) => ({
					code: line.component_code,
					quantity: Number(line.quantity),
					amount: Number(line.amount)
				}))
				.toSorted((left, right) => left.code.localeCompare(right.code));
			assert.deepEqual(
				lines.map((line) => [line.code, line.quantity, line.amount]),
				[
					['INCENTIVE', 2, 49.77],
					['OVERTIME', 3, 74.66]
				],
				`overtime lines: ${JSON.stringify(lines)}`
			);
			const captured = (await session.query(
				`select count(*)::int as n from work_days w
				 join payslips p on p.id = w.payslip_id
				 where p.payroll_run_id = $1 and w.id = $2`,
				[runId, workDayId]
			)) as ReadonlyArray<{ n: number }>;
			assert.equal(captured[0]?.n, 1, 'the punch is captured as the run input that priced it');
		} finally {
			await session.stop();
		}
	}
);
