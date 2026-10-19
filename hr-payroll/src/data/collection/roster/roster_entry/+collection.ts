import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { Instant } from '@norbital-ai/std/date';
import { movementFromRow, refuseCoveredWorkDay } from '../../../../lib/payroll_engine/leave.js';
import { rosterPlanRefusal, type RosterTouch } from '../../../../lib/payroll_engine/admit.js';
import { moneyNumber, runEngine } from '../../../../lib/payroll_engine/foundation.js';
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
	'banked_overtime_hours',
	'banked_overtime_band',
	'overtime_consented_at',
	'worksite',
	'facts',
	'employment_id',
	'payslip_id'
] as const;
const update_columns = [
	'shift_definition_id',
	'work_date',
	'worked_intervals',
	'banked_overtime_hours',
	'banked_overtime_band',
	'overtime_consented_at',
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
 * nothing and passes. Intervals stay ordered and leave keeps its days; payroll holds banked overtime within the day's overtime.
 * The changed days then keep the plan: no refusing working-time law, and each pattern cycle's work, rest and off days.
 */
c.transform(function* (inputs, ctx: TransformCtx<'roster_entry'>) {
	const pinOnly = (input: object) =>
		Object.keys(input).every((key) => key === 'payslip_id' || key === 'id');
	// A run's pins settle days as recorded: nothing to check, nothing to read.
	if (inputs.every((input) => !('$delete' in input) && pinOnly(input))) return inputs;
	const merged = inputs.map((input, i) => ({ ...ctx.existing[i], ...input }));
	const employmentIds = [
		...new Set(merged.flatMap((row) => (row.employment_id == null ? [] : [row.employment_id])))
	];
	const got = yield* ctx.db.read({
		employments: {
			collection: 'employment_contract',
			where: { id: { in: employmentIds } },
			select: { id: true },
			all: true
		},
		leaves: {
			collection: 'leave_catalog_entry',
			where: {
				employment_id: { in: { member: 'employments', field: 'id' } },
				activity: { eq: 'TIME_OFF' }
			},
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
		},
		slips: {
			collection: 'payslip',
			where: { employment_id: { in: { member: 'employments', field: 'id' } } },
			select: { employment_id: true, payroll_run_id: true },
			all: true
		},
		runs: {
			collection: 'payroll_run',
			where: { id: { in: { member: 'slips', field: 'payroll_run_id' } } },
			select: { kind: true, attendance_from: true, attendance_to: true },
			all: true
		}
	});
	const windows = new Map<string, SettledWindow[]>();
	const runs = new Map(got.runs.rows.map((run) => [run.id, run]));
	for (const slip of got.slips.rows) {
		const run = runs.get(slip.payroll_run_id);
		if (run?.kind !== 'REGULAR' || run.attendance_from == null || run.attendance_to == null)
			continue;
		windows.set(slip.employment_id, [
			...(windows.get(slip.employment_id) ?? []),
			{ from: String(run.attendance_from), to: String(run.attendance_to) }
		]);
	}
	const movements = got.leaves.rows.map(movementFromRow);
	const out = [];
	const touched: RosterTouch[] = [];
	for (const [i, input] of inputs.entries()) {
		const before = ctx.existing[i];
		const row = { ...before, ...input };
		const settled = refuseSettledWindow(
			windows.get(String(row.employment_id)),
			String(row.work_date).slice(0, 10)
		);
		if ('$delete' in input) {
			const pinned = before === undefined ? null : refusePinnedRoster(before);
			const refusal = pinned ?? settled;
			if (refusal != null) return yield* ctx.refuse(refusal);
			if (before?.employment_id != null)
				touched.push({
					employment_id: before.employment_id,
					work_date: String(before.work_date).slice(0, 10),
					row: null
				});
			out.push(input);
			continue;
		}
		// A run's pin settles the day as recorded; it changes nothing leave could cover.
		if (pinOnly(input) || (before !== undefined && restates(input, before))) {
			out.push(input);
			continue;
		}
		const pinned = before === undefined ? null : refusePinnedRoster(before);
		const refusal = pinned ?? settled;
		if (refusal != null) return yield* ctx.refuse(refusal);
		if ('worked_intervals' in input) {
			const intervals = refuseWorkedIntervals(input.worked_intervals);
			if (intervals != null) return yield* ctx.refuse(intervals);
		}
		const covered = refuseCoveredWorkDay(row.work_date, row.employment_id, movements);
		if (covered != null) return yield* ctx.refuse(covered);
		if (row.employment_id != null && row.work_date != null)
			touched.push({
				employment_id: row.employment_id,
				work_date: String(row.work_date).slice(0, 10),
				row: {
					shift_definition_id: row.shift_definition_id ?? null,
					worked_intervals: row.worked_intervals ?? null,
					banked_overtime_hours: moneyNumber(row.banked_overtime_hours),
					overtime_consented_at:
						row.overtime_consented_at == null ? null : Instant(String(row.overtime_consented_at))
				}
			});
		out.push(input);
	}
	const broken = yield* runEngine(rosterPlanRefusal(touched), ctx.db.read, ctx.refuse);
	if (broken != null) return yield* ctx.refuse(broken);
	return out;
});
