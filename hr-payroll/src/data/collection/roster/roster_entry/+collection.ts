import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { Instant } from '@norbital-ai/std/date';
import { Result, Schema } from 'effect';
import {
	consumedLeaveCovers,
	movementFromRow,
	refuseCoveredWorkDay
} from '../../../../lib/payroll_engine/leave.js';
import { rosterPlanRefusal, type RosterTouch } from '../../../../lib/payroll_engine/admit.js';
import { moneyNumber, runEngine } from '../../../../lib/payroll_engine/foundation.js';
import {
	refuseApprovedOvertimeIntervals,
	refusePinnedRoster,
	refusePlannedOvertime,
	refuseSettledWindow,
	refuseWorkedIntervals,
	restates,
	type SettledWindow
} from '../../../../lib/payroll_engine/roster_entry.js';
const create_columns = [
	'shift_definition_id',
	'planned_overtime_hours',
	'approved_overtime_intervals',
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
	'planned_overtime_hours',
	'approved_overtime_intervals',
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
	for (const [i, input] of inputs.entries()) {
		const before = ctx.existing[i];
		if (!('$delete' in input) && before === undefined && input.payslip_id != null)
			return yield* ctx.refuse('Payroll attaches a work day to a payslip only after capturing it.');
		if (
			before?.payslip_id != null &&
			'payslip_id' in input &&
			input.payslip_id !== before.payslip_id
		)
			return yield* ctx.refuse(
				'A settled day cannot be released or moved to another payslip. Delete the unpaid payroll run to release it.'
			);
	}
	const attachments = inputs.flatMap((input, i) => {
		const before = ctx.existing[i];
		return '$delete' in input ||
			before === undefined ||
			before.payslip_id != null ||
			input.payslip_id == null
			? []
			: [{ before, payslip_id: input.payslip_id }];
	});
	if (attachments.length > 0) {
		const got = yield* ctx.db.read({
			slips: {
				collection: 'payslip',
				where: { id: { in: [...new Set(attachments.map((row) => row.payslip_id))] } },
				select: { employment_id: true, payroll_run_id: true },
				all: true
			},
			runs: {
				collection: 'payroll_run',
				where: { id: { in: { member: 'slips', field: 'payroll_run_id' } } },
				select: {
					company_id: true,
					kind: true,
					attendance_from: true,
					attendance_to: true,
					pins: true
				},
				all: true
			},
			employments: {
				collection: 'employment_contract',
				where: { id: { in: [...new Set(attachments.map((row) => row.before.employment_id))] } },
				select: { company_id: true },
				all: true
			}
		});
		const slips = new Map(got.slips.rows.map((row) => [row.id, row]));
		const runs = new Map(got.runs.rows.map((row) => [row.id, row]));
		const employers = new Map(got.employments.rows.map((row) => [row.id, row.company_id]));
		const captured = new Map<string, Set<string>>();
		for (const run of got.runs.rows) {
			const decoded = Schema.decodeUnknownResult(
				Schema.Array(
					Schema.Struct({
						collection: Schema.String,
						id: Schema.String,
						employment_id: Schema.String
					})
				)
			)(run.pins ?? []);
			if (Result.isFailure(decoded))
				return yield* ctx.refuse(
					'Review the payroll settlement ledger before attaching work days.'
				);
			captured.set(
				run.id,
				new Set(
					decoded.success
						.filter((pin) => pin.collection === 'roster_entry')
						.map((pin) => `${pin.id}:${pin.employment_id}`)
				)
			);
		}
		for (const { before, payslip_id } of attachments) {
			const slip = slips.get(payslip_id);
			const run = slip === undefined ? undefined : runs.get(slip.payroll_run_id);
			if (
				slip?.employment_id !== before.employment_id ||
				run?.kind !== 'REGULAR' ||
				run.company_id !== employers.get(before.employment_id) ||
				run.attendance_from == null ||
				run.attendance_to == null ||
				before.work_date < run.attendance_from ||
				before.work_date > run.attendance_to ||
				!captured.get(run.id)?.has(`${before.id}:${before.employment_id}`)
			)
				return yield* ctx.refuse(
					'Only the payroll run that captured this work day can attach it to its employee’s payslip.'
				);
		}
	}
	const pinOnly = (input: object) =>
		Object.keys(input).every((key) => key === 'payslip_id' || key === 'id');
	// A run's pins settle days as recorded: nothing to check, nothing to read.
	if (inputs.every((input) => !('$delete' in input) && pinOnly(input))) return inputs;
	const merged = inputs.map((input, i) => ({ ...ctx.existing[i], ...input }));
	const employmentIds = [
		...new Set(
			[...merged, ...ctx.existing].flatMap((row) =>
				row?.employment_id == null ? [] : [row.employment_id]
			)
		)
	];
	const shiftIds = [
		...new Set(
			merged.flatMap((row) => (row.shift_definition_id == null ? [] : [row.shift_definition_id]))
		)
	];
	const got = yield* ctx.db.read({
		employments: {
			collection: 'employment_contract',
			where: { id: { in: employmentIds } },
			select: { id: true, company_id: true },
			all: true
		},
		shifts: {
			collection: 'shift_definition',
			where: { id: { in: shiftIds } },
			select: { company_id: true, effective_range: true },
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
				to: true,
				half_day_start: true,
				half_day_end: true,
				payslip_id: true
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
	const employers = new Map(got.employments.rows.map((row) => [row.id, row.company_id]));
	const shifts = new Map(got.shifts.rows.map((row) => [row.id, row]));
	const out = [];
	const touched: RosterTouch[] = [];
	for (const [i, input] of inputs.entries()) {
		const before = ctx.existing[i];
		const row = { ...before, ...input };
		const settled =
			(before == null
				? null
				: refuseSettledWindow(
						windows.get(String(before.employment_id)),
						String(before.work_date).slice(0, 10)
					)) ??
			refuseSettledWindow(
				windows.get(String(row.employment_id)),
				String(row.work_date).slice(0, 10)
			) ??
			([before, row].some(
				(day) =>
					day?.employment_id != null &&
					consumedLeaveCovers(
						got.leaves.rows,
						day.employment_id,
						String(day.work_date).slice(0, 10)
					)
			)
				? 'A day on leave settled on a payslip cannot be changed. Delete that payroll run to change it.'
				: null);
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
			// Equivalent formatting or an explicit zero break must not rewrite captured approval windows.
			out.push(
				before !== undefined && 'approved_overtime_intervals' in input
					? { ...input, approved_overtime_intervals: before.approved_overtime_intervals ?? null }
					: input
			);
			continue;
		}
		const pinned = before === undefined ? null : refusePinnedRoster(before);
		const refusal = pinned ?? settled;
		if (refusal != null) return yield* ctx.refuse(refusal);
		const plannedOvertime = refusePlannedOvertime(
			row.planned_overtime_hours,
			row.shift_definition_id
		);
		if (plannedOvertime != null) return yield* ctx.refuse(plannedOvertime);
		if (row.shift_definition_id != null) {
			const shift = shifts.get(row.shift_definition_id);
			const day = String(row.work_date).slice(0, 10);
			if (
				row.employment_id == null ||
				shift == null ||
				shift.company_id !== employers.get(row.employment_id)
			)
				return yield* ctx.refuse('Choose a shift code belonging to the employee’s entity.');
			if (
				(shift.effective_range?.from != null && day < String(shift.effective_range.from)) ||
				(shift.effective_range?.to != null && day > String(shift.effective_range.to))
			)
				return yield* ctx.refuse('Choose a shift code in effect on the planned date.');
		}
		if ('approved_overtime_intervals' in input) {
			const approved = refuseApprovedOvertimeIntervals(input.approved_overtime_intervals);
			if (approved != null) return yield* ctx.refuse(approved);
		}
		if ('worked_intervals' in input) {
			const intervals = refuseWorkedIntervals(input.worked_intervals);
			if (intervals != null) return yield* ctx.refuse(intervals);
		}
		const actualWork =
			(row.worked_intervals?.length ?? 0) > 0 ||
			(moneyNumber(row.banked_overtime_hours) ?? 0) > 0 ||
			row.overtime_consented_at != null;
		const covered = actualWork
			? refuseCoveredWorkDay(row.work_date, row.employment_id, movements)
			: null;
		if (covered != null) return yield* ctx.refuse(covered);
		if (row.employment_id != null && row.work_date != null)
			touched.push({
				employment_id: row.employment_id,
				work_date: String(row.work_date).slice(0, 10),
				row: {
					shift_definition_id: row.shift_definition_id ?? null,
					planned_overtime_hours: moneyNumber(row.planned_overtime_hours),
					approved_overtime_intervals: row.approved_overtime_intervals ?? null,
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
