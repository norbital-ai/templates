import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { movementFromRow, refuseCoveredWorkDay } from '../../../../lib/payroll_engine/leave.js';
import {
	refusePinnedRoster,
	refuseWorkedIntervals
} from '../../../../lib/payroll_engine/roster_entry.js';

const create_columns = [
	'shift_definition_id',
	'work_date',
	'worked_intervals',
	'approved_overtime_hours',
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
	update: { input: { columns: update_columns } }
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'roster_entry'>) => {
	const merged = inputs.map((input, i) => ({ ...ctx.existing[i], ...input }));
	const employmentIds = [
		...new Set(merged.flatMap((row) => (row.employment_id == null ? [] : [row.employment_id])))
	];
	const leaves =
		employmentIds.length === 0
			? { rows: [] }
			: await ctx.db.read('leave_catalog_entry', {
					where: { employment_id: { in: employmentIds }, activity: { eq: 'TIME_OFF' } },
					select: {
						catalog_id: true,
						employment_id: true,
						activity: true,
						occurred_on: true,
						days: true,
						from: true,
						to: true
					},
					all: true
				});
	const movements = leaves.rows.map(movementFromRow);
	return inputs.map((input, i) => {
		const before = ctx.existing[i];
		if (before !== undefined) {
			const pinned = refusePinnedRoster(before);
			if (pinned != null) ctx.refuse(pinned);
		}
		if ('worked_intervals' in input) {
			const intervals = refuseWorkedIntervals(input.worked_intervals);
			if (intervals != null) ctx.refuse(intervals);
		}
		// A run's pin settles the day as recorded; it changes nothing leave could cover.
		if (Object.keys(input).every((key) => key === 'payslip_id' || key === 'id')) return input;
		const row = merged[i]!;
		const covered = refuseCoveredWorkDay(row.work_date, row.employment_id, movements);
		if (covered != null) ctx.refuse(covered);
		return input;
	});
});
