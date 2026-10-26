import {
	mappedOf,
	rosterSheet,
	sheetFindings,
	sheetKnown,
	sheetLeave,
	sheetRow
} from '../../../lib/payroll_engine/roster_import.js';
import {
	SHEET_COLUMNS,
	type SheetFinding,
	type SheetKnown,
	type SheetRecord
} from '../../../lib/payroll_engine/roster_sheet.js';
const NOTHING: SheetKnown = {
	failure: null,
	contracts: [],
	shifts: [],
	leave: {},
	classes: {},
	kept: {},
	consented: {}
};
import {
	model,
	type WriteCtx,
	type CreateRow,
	type UpdateSet,
	type StoredRow,
	type Id
} from '@norbital-ai/bolt';
import { Instant } from '@norbital-ai/std/date';
import {
	consumedLeaveCovers,
	movementFromRow,
	refuseCoveredWorkDay
} from '../../../lib/payroll_engine/leave.js';
import { rosterPlanRefusal, type RosterTouch } from '../../../lib/payroll_engine/admit.js';
import { moneyNumber, runEngine } from '../../../lib/payroll_engine/foundation.js';
import {
	refuseApprovedOvertimeIntervals,
	refusePlannedOvertime,
	refuseSettledWindow,
	refuseWorkedIntervals,
	restates,
	type SettledWindow
} from '../../../lib/payroll_engine/roster_entry.js';
import { Effect } from 'effect';

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

type WriteInput = Omit<UpdateSet<'roster_entry'>, 'id'> &
	Partial<Omit<CreateRow<'roster_entry'>, 'id'>> & {
		readonly id?: Id<'roster_entry'>;
		readonly $delete?: true;
	};

const transformRows = Effect.fnUntraced(function* (
	inputs: readonly WriteInput[],
	existing: readonly (StoredRow<'roster_entry'> | undefined)[],
	ctx: WriteCtx<'roster_entry'>
) {
	for (const [i, input] of inputs.entries()) {
		const before = existing[i];
		if (!('$delete' in input) && before === undefined && input.payslip_id != null)
			return yield* ctx.refuse('Payroll attaches a work day to a payslip only after capturing it.');
	}
	const attachments = inputs.flatMap((input, i) => {
		const before = existing[i];
		return '$delete' in input ||
			before === undefined ||
			before.payslip_id != null ||
			input.payslip_id == null
			? []
			: [{ before, payslip_id: input.payslip_id }];
	});

	const pinOnly = (input: object) =>
		Object.keys(input).every((key) => key === 'payslip_id' || key === 'id');
	// A run's pins settle days as recorded: nothing to check, nothing to read.
	if (attachments.length === 0 && inputs.every((input) => !('$delete' in input) && pinOnly(input)))
		return inputs;
	const merged = inputs.map((input, i) => ({ ...existing[i], ...input }));
	const employmentIds = [
		...new Set(
			[...merged, ...existing].flatMap((row) =>
				row?.employment_id == null ? [] : [row.employment_id]
			)
		)
	];
	const shiftIds = [
		...new Set(
			merged.flatMap((row) => (row.shift_definition_id == null ? [] : [row.shift_definition_id]))
		)
	];
	const got = yield* ctx.db.query({
		employments: {
			from: 'employment_contract',
			where: { id: { in: employmentIds } },
			select: { id: true, company_id: true },
			all: true
		},
		shifts: {
			from: 'shift_definition',
			where: { id: { in: shiftIds } },
			select: { company_id: true, effective_range: true },
			all: true
		},
		leaves: {
			from: 'leave_catalog_entry',
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
			from: 'payslip',
			where: { employment_id: { in: { member: 'employments', field: 'id' } } },
			select: { employment_id: true, payroll_run_id: true },
			all: true
		},
		runs: {
			from: 'payroll_run',
			where: { id: { in: { member: 'slips', field: 'payroll_run_id' } } },
			select: { kind: true, attendance_from: true, attendance_to: true },
			all: true
		},
		attachment_slips: {
			from: 'payslip',
			where: { id: { in: [...new Set(attachments.map((row) => row.payslip_id))] } },
			select: { employment_id: true, payroll_run_id: true },
			all: true
		},
		attachment_runs: {
			from: 'payroll_run',
			where: { id: { in: { member: 'attachment_slips', field: 'payroll_run_id' } } },
			select: {
				company_id: true,
				kind: true,
				attendance_from: true,
				attendance_to: true,
				pins: true
			},
			all: true
		}
	});
	if (attachments.length > 0) {
		const slips = new Map(got.attachment_slips.rows.map((row) => [row.id, row]));
		const runs = new Map(got.attachment_runs.rows.map((row) => [row.id, row]));
		const employers = new Map(got.employments.rows.map((row) => [row.id, row.company_id]));
		const captured = new Map<string, Set<string>>();
		for (const run of got.attachment_runs.rows)
			captured.set(
				run.id,
				new Set(
					(run.pins ?? [])
						.filter((pin) => pin.collection === 'roster_entry')
						.map((pin) => `${pin.id}:${pin.employment_id}`)
				)
			);
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
	if (inputs.every((input) => !('$delete' in input) && pinOnly(input))) return inputs;
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
	const out: WriteInput[] = [];
	const touched: RosterTouch[] = [];
	for (const [i, input] of inputs.entries()) {
		const before = existing[i];
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
			if (settled != null) return yield* ctx.refuse(settled);
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
					? {
							...input,
							approved_overtime_intervals: before.approved_overtime_intervals ?? null
						}
					: input
			);
			continue;
		}
		if (settled != null) return yield* ctx.refuse(settled);
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
	const broken = yield* runEngine(
		rosterPlanRefusal(touched, got.employments.rows),
		ctx.db.query,
		ctx.refuse
	);
	if (broken != null) return yield* ctx.refuse(broken);
	return out;
});

export default model('roster_entry', {
	description:
		'One person-day: the planned shift and actual attendance side by side. Either may be absent. Hourly credit uses actual attendance inside the configured shift and its approved overtime windows; extra time cannot replace late arrival. Breaks follow the configured or documented duration and recorded interior gaps. Credited shortfalls and overtime round to the governing version’s attendance step (`payroll.attendance`). The governing catalogue determines fixed salary and premium pay from plan, attendance, calendar and the statutory rules in force.',
	icon: 'lucide:calendar-clock',
	label: 'work_date',
	fields: {
		work_date: {
			kind: 'date'
		},
		planned_overtime_hours: {
			kind: 'decimal',
			scale: 2,
			min: 0,
			optional: true,
			help: 'The overtime duration approved alongside the shift code. Only this duration can be paid as overtime, limited by actual attendance and rounded to the governing version’s attendance step. Blank means no approved overtime.'
		},
		approved_overtime_intervals: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					start: { kind: 'instant' },
					end: { kind: 'instant' },
					break_minutes: { kind: 'int', min: 0, optional: true }
				}
			},
			optional: true,
			help: 'The exact approved overtime windows and their documented unpaid break duration, when separately recorded. Attendance must fall inside these windows, net of their breaks, and remains limited by the approved overtime duration. Blank runs on after the configured shift where the version’s `payroll.attendance.overtime_window` is AFTER_SHIFT, and credits no overtime otherwise.'
		},
		worked_intervals: {
			kind: 'list',
			of: { kind: 'period', of: 'instant' },
			optional: true
		},
		banked_overtime_hours: {
			kind: 'decimal',
			scale: 2,
			min: 0,
			optional: true,
			help: 'Of the day’s overtime, the hours the employee elected to bank as time off instead of pay.'
		},
		banked_overtime_band: {
			kind: 'text',
			optional: true,
			help: 'The overtime band (rate code) the banked hours were earned in.'
		},
		overtime_consented_at: {
			kind: 'instant',
			optional: true
		},
		worksite: {
			kind: 'text',
			optional: true
		},
		facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			default: {}
		},
		employment_id: {
			kind: 'ref',
			to: 'employment_contract',
			inverse: 'roster_entry'
		},
		shift_definition_id: {
			kind: 'ref',
			to: 'shift_definition',
			inverse: 'roster_entry',
			optional: true
		},
		payslip_id: {
			kind: 'ref',
			to: 'payslip',
			inverse: 'roster_entry',
			optional: true,
			onDelete: 'setNull'
		}
	},
	key: ['employment_id', 'work_date'],
	locked: { payslip_id: { isNull: false } },
	read: 'all',
	create: {
		columns: create_columns,
		transform: function* (rows, ctx) {
			const transformed = yield* transformRows(
				rows,
				rows.map(() => undefined),
				ctx
			);
			return rows.map((row, index) => {
				const { id: _id, $delete: _delete, ...set } = transformed[index] ?? {};
				return { ...row, ...set };
			});
		}
	},
	update: {
		columns: update_columns,
		transform: function* (changes, ctx) {
			const transformed = yield* transformRows(
				changes.map(({ set }) => set),
				changes.map(({ before }) => before),
				ctx
			);
			return changes.map(({ set: original }, index) => {
				const { id: _id, $delete: _delete, ...set } = transformed[index] ?? {};
				return { ...original, ...set };
			});
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* transformRows(
				rows.map(({ id }) => ({ id, $delete: true })),
				rows,
				ctx
			);
		}
	},
	syncs: {
		work_sheet: {
			with: 'file',
			parser: ['xlsx', 'csv'],
			schema: {
				employee_number: { kind: 'text', label: SHEET_COLUMNS.employee_number },
				work_date: { kind: 'date', label: SHEET_COLUMNS.work_date },
				shift_code: {
					kind: 'text',
					label: SHEET_COLUMNS.shift_code,
					optional: true
				},
				clock_in: {
					kind: 'text',
					label: SHEET_COLUMNS.clock_in,
					optional: true
				},
				clock_out: {
					kind: 'text',
					label: SHEET_COLUMNS.clock_out,
					optional: true
				},
				overtime_consent: {
					kind: 'text',
					label: SHEET_COLUMNS.overtime_consent,
					optional: true
				},
				banked_overtime_hours: {
					kind: 'number',
					min: 0,
					label: SHEET_COLUMNS.banked_overtime_hours,
					optional: true
				},
				leave_code: {
					kind: 'text',
					label: SHEET_COLUMNS.leave_code,
					optional: true
				},
				name: { kind: 'text', label: SHEET_COLUMNS.name, optional: true },
				holiday: { kind: 'text', label: SHEET_COLUMNS.holiday, optional: true },
				planned_overtime_hours: {
					kind: 'number',
					min: 0,
					label: SHEET_COLUMNS.planned_overtime_hours,
					optional: true
				},
				approved_ot_1_start: {
					kind: 'text',
					label: SHEET_COLUMNS.approved_ot_1_start,
					optional: true
				},
				approved_ot_1_end: {
					kind: 'text',
					label: SHEET_COLUMNS.approved_ot_1_end,
					optional: true
				},
				approved_ot_2_start: {
					kind: 'text',
					label: SHEET_COLUMNS.approved_ot_2_start,
					optional: true
				},
				approved_ot_2_end: {
					kind: 'text',
					label: SHEET_COLUMNS.approved_ot_2_end,
					optional: true
				},
				approved_ot_1_break_minutes: {
					kind: 'number',
					min: 0,
					label: SHEET_COLUMNS.approved_ot_1_break_minutes,
					optional: true
				},
				approved_ot_2_break_minutes: {
					kind: 'number',
					min: 0,
					label: SHEET_COLUMNS.approved_ot_2_break_minutes,
					optional: true
				}
			},
			context: {
				company_id: { kind: 'id', of: 'entity', optional: true },
				from: { kind: 'date', optional: true },
				to: { kind: 'date', optional: true }
			},
			read: function* ({ records, context }, ctx) {
				const mapped = records.map((row): SheetRecord => ({
					row: row.$at,
					employee_number: row.employee_number.trim(),
					work_date: String(row.work_date),
					...(row.shift_code == null ? {} : { shift_code: row.shift_code.trim() }),
					...(row.clock_in == null ? {} : { clock_in: String(row.clock_in) }),
					...(row.clock_out == null ? {} : { clock_out: String(row.clock_out) }),
					...(row.overtime_consent == null
						? {}
						: { overtime_consent: row.overtime_consent.trim() }),
					...(row.banked_overtime_hours == null
						? {}
						: { banked_overtime_hours: row.banked_overtime_hours }),
					...(row.planned_overtime_hours == null
						? {}
						: { planned_overtime_hours: row.planned_overtime_hours }),
					...(row.approved_ot_1_start == null
						? {}
						: { approved_ot_1_start: row.approved_ot_1_start.trim() }),
					...(row.approved_ot_1_end == null
						? {}
						: { approved_ot_1_end: row.approved_ot_1_end.trim() }),
					...(row.approved_ot_2_start == null
						? {}
						: { approved_ot_2_start: row.approved_ot_2_start.trim() }),
					...(row.approved_ot_2_end == null
						? {}
						: { approved_ot_2_end: row.approved_ot_2_end.trim() }),
					...(row.approved_ot_1_break_minutes == null
						? {}
						: { approved_ot_1_break_minutes: row.approved_ot_1_break_minutes }),
					...(row.approved_ot_2_break_minutes == null
						? {}
						: { approved_ot_2_break_minutes: row.approved_ot_2_break_minutes }),
					...(row.leave_code == null ? {} : { leave_code: row.leave_code.trim() })
				}));
				const known = yield* sheetKnown(mapped, context, ctx.db.query).pipe(
					Effect.catchTag('Refusal', (failure) =>
						Effect.succeed({ ...NOTHING, failure: failure.message })
					)
				);
				const rows = mapped.map((record) => sheetRow(record, known));
				const findings = yield* sheetFindings(
					{ records: mapped, rows: rows.map(mappedOf), known, context },
					ctx.db.query
				).pipe(
					Effect.catchTag('Refusal', (failure) =>
						Effect.succeed<SheetFinding[]>([
							{
								row: null,
								column: '',
								message: failure.message,
								severity: 'refuse'
							}
						])
					)
				);
				return {
					rows: rows.flatMap((row) => (row === null ? [] : [row])),
					related: {
						leave_catalog_entry: mapped.flatMap((record) => sheetLeave(record, known))
					},
					scope: { by: ['employment_id'], range: 'work_date' },
					findings: findings.map(({ row, column, ...finding }) => ({
						...finding,
						at: row ?? 0,
						field: column
					}))
				};
			},
			write: function* ({ context }, ctx) {
				return yield* rosterSheet(context, String(ctx.today), ctx.db.query);
			}
		}
	}
});
