import { collection, type TransformCtx } from '@norbital-ai/bolt';
import {
	joinedSetOf,
	moneyNumber,
	workspaceReadAsHost
} from '../../../../lib/payroll_engine/foundation.js';
import { movementFromRow, refuseCoveredWorkDay } from '../../../../lib/payroll_engine/leave.js';
import {
	refusePinnedRoster,
	refuseSettledWindow,
	refuseWorkedIntervals,
	restates,
	type SettledWindow
} from '../../../../lib/payroll_engine/roster_entry.js';

const create_columns = [
	'shift_definition_id',
	'work_date',
	'worked_intervals',
	'approved_overtime_hours',
	'banked_overtime_hours',
	'banked_overtime_band',
	'overtime_consented_at',
	'incentive_hours',
	'worksite',
	'facts',
	'employment_id',
	'payslip_id'
] as const;
const update_columns = [
	'shift_definition_id',
	'work_date',
	'worked_intervals',
	'approved_overtime_hours',
	'banked_overtime_hours',
	'banked_overtime_band',
	'overtime_consented_at',
	'incentive_hours',
	'worksite',
	'facts',
	'employment_id',
	'payslip_id'
] as const;

const c = collection('roster_entry', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } },
	// a delete faces the settled-day guard too (the work-day sheet's scope deletes through it)
	delete: { transform: true }
});
export default c;

/**
 * A day settled on a payslip, or inside a regular run's attendance window, does not change; restating it changes
 * nothing and passes. Intervals stay ordered, banked overtime within the approved, and leave keeps its days.
 */
c.transform(async (inputs, ctx: TransformCtx<'roster_entry'>) => {
	const pinOnly = (input: object) =>
		Object.keys(input).every((key) => key === 'payslip_id' || key === 'id');
	// A run's pins settle days as recorded: nothing to check, nothing to read.
	if (inputs.every((input) => !('$delete' in input) && pinOnly(input))) return inputs;
	const merged = inputs.map((input, i) => ({ ...ctx.existing[i], ...input }));
	const employmentIds = [
		...new Set(merged.flatMap((row) => (row.employment_id == null ? [] : [row.employment_id])))
	];
	// One read: the employments with, through their relations, their time off and their payslips with each one's run.
	const got = await joinedSetOf(workspaceReadAsHost(ctx.db.read))({
		employments: {
			collection: 'employment_contract',
			where: { id: { in: employmentIds } },
			selection: {
				leave_catalog_entry: {
					many: {
						catalog_id: true,
						employment_id: true,
						activity: true,
						occurred_on: true,
						days: true,
						from: true,
						to: true
					},
					where: { activity: { eq: 'TIME_OFF' } }
				},
				payslip: {
					many: {
						employment_id: true,
						run: {
							one: 'payroll_run_id',
							select: { kind: true, attendance_from: true, attendance_to: true }
						}
					}
				}
			}
		}
	});
	const employments = got<{
		readonly leave_catalog_entry?: readonly Parameters<typeof movementFromRow>[0][];
		readonly payslip?: readonly {
			readonly employment_id: string;
			readonly run?: {
				readonly kind?: string;
				readonly attendance_from?: unknown;
				readonly attendance_to?: unknown;
			} | null;
		}[];
	}>('employments');
	const leaves = { rows: employments.flatMap((held) => held.leave_catalog_entry ?? []) };
	const windows = new Map<string, SettledWindow[]>();
	for (const slip of employments.flatMap((held) => held.payslip ?? [])) {
		const run = slip.run;
		if (run?.kind !== 'REGULAR' || run.attendance_from == null || run.attendance_to == null)
			continue;
		windows.set(slip.employment_id, [
			...(windows.get(slip.employment_id) ?? []),
			{ from: String(run.attendance_from), to: String(run.attendance_to) }
		]);
	}
	const movements = leaves.rows.map(movementFromRow);
	return inputs.map((input, i) => {
		const before = ctx.existing[i];
		const row = merged[i]!;
		const settled = refuseSettledWindow(
			windows.get(String(row.employment_id)),
			String(row.work_date).slice(0, 10)
		);
		if ('$delete' in input) {
			const pinned = before === undefined ? null : refusePinnedRoster(before);
			if (pinned != null || settled != null) ctx.refuse((pinned ?? settled)!);
			return input;
		}
		// A run's pin settles the day as recorded; it changes nothing leave could cover.
		if (pinOnly(input)) return input;
		if (before !== undefined && restates(input, before)) return input;
		const pinned = before === undefined ? null : refusePinnedRoster(before);
		if (pinned != null || settled != null) ctx.refuse((pinned ?? settled)!);
		if ('worked_intervals' in input) {
			const intervals = refuseWorkedIntervals(input.worked_intervals);
			if (intervals != null) ctx.refuse(intervals);
		}
		if (
			(moneyNumber(row.banked_overtime_hours) ?? 0) >
			(moneyNumber(row.approved_overtime_hours) ?? 0)
		)
			ctx.refuse('Banked overtime cannot exceed the approved overtime of the day.');
		const covered = refuseCoveredWorkDay(row.work_date, row.employment_id, movements);
		if (covered != null) ctx.refuse(covered);
		return input;
	});
});
