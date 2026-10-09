import { pipeline } from '@norbital-ai/bolt';
import { callerReadAsHost } from '../../../../lib/payroll_engine/foundation.js';
import {
	mappedOf,
	rosterSheet,
	runHook,
	sheetFindings,
	sheetKnown,
	sheetLeave,
	sheetRow
} from '../../../../lib/payroll_engine/roster_import.js';
import {
	SHEET_COLUMNS,
	type SheetKnown,
	type SheetRecord
} from '../../../../lib/payroll_engine/roster_sheet.js';

const NOTHING: SheetKnown = {
	failure: null,
	contracts: [],
	shifts: [],
	leave: {},
	classes: {},
	kept: {},
	consented: {}
};

/**
 * The work-day sheet: one row per person-day — shift, clock, overtime, incentive hours, leave. The import is a set:
 * per employment, from its first to its last day in the file, rows are created or updated and unsettled stored days
 * the file leaves out or blanks are deleted; a leave code the records lack is one day of time off. The Work page
 * hands its entity and period as context: the entity resolves employee numbers, the period is the template's days.
 */
export default pipeline('roster_entry', {
	import: {
		description:
			'The work-day sheet: per employee, the days it covers become exactly what it states — rows created or updated, unsettled days left out or blanked removed, a leave code recorded as a day of time off. Settled days restated unchanged pass; changing one refuses the file.',
		input: {
			rows: {
				kind: 'list',
				max: 10_000,
				of: {
					kind: 'object',
					fields: {
						row: { kind: 'number' },
						employee_number: { kind: 'text', label: SHEET_COLUMNS.employee_number },
						work_date: { kind: 'date', label: SHEET_COLUMNS.work_date },
						shift_code: { kind: 'text', label: SHEET_COLUMNS.shift_code, optional: true },
						clock_in: { kind: 'time', label: SHEET_COLUMNS.clock_in, optional: true },
						clock_out: { kind: 'time', label: SHEET_COLUMNS.clock_out, optional: true },
						overtime_hours: {
							kind: 'number',
							min: 0,
							label: SHEET_COLUMNS.overtime_hours,
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
						incentive_hours: {
							kind: 'number',
							min: 0,
							label: SHEET_COLUMNS.incentive_hours,
							optional: true
						},
						leave_code: { kind: 'text', label: SHEET_COLUMNS.leave_code, optional: true },
						name: { kind: 'text', label: SHEET_COLUMNS.name, optional: true },
						holiday: { kind: 'text', label: SHEET_COLUMNS.holiday, optional: true }
					}
				}
			}
		},
		context: {
			company_id: { kind: 'id', of: 'entity', optional: true },
			from: { kind: 'date', optional: true },
			to: { kind: 'date', optional: true }
		},
		records: (input) =>
			input.rows.map((row): SheetRecord => ({
				row: row.row,
				employee_number: row.employee_number.trim(),
				work_date: String(row.work_date),
				...(row.shift_code == null ? {} : { shift_code: row.shift_code.trim() }),
				...(row.clock_in == null ? {} : { clock_in: String(row.clock_in) }),
				...(row.clock_out == null ? {} : { clock_out: String(row.clock_out) }),
				...(row.overtime_hours == null ? {} : { overtime_hours: row.overtime_hours }),
				...(row.overtime_consent == null ? {} : { overtime_consent: row.overtime_consent.trim() }),
				...(row.banked_overtime_hours == null
					? {}
					: { banked_overtime_hours: row.banked_overtime_hours }),
				...(row.incentive_hours == null ? {} : { incentive_hours: row.incentive_hours }),
				...(row.leave_code == null ? {} : { leave_code: row.leave_code.trim() })
			})),
		known: (ctx, records, { context }) =>
			runHook(sheetKnown(records, contextOf(context)), callerReadAsHost(ctx.read), (failure) => ({
				...NOTHING,
				failure
			})),
		map: (record, { known }) => sheetRow(record, known),
		related: { leave_catalog_entry: (record, { known }) => sheetLeave(record, known) },
		onConflict: 'update',
		scope: { by: ['employment_id'], range: 'work_date' },
		check: (ctx, { records, rows, known, context }) =>
			runHook(
				sheetFindings({ records, rows: rows.map(mappedOf), known, context: contextOf(context) }),
				callerReadAsHost(ctx.read),
				(message) => [{ row: null, column: '', message, severity: 'refuse' }]
			),
		// a template that cannot be read fails the download with its reason, never an empty sheet
		template: (ctx, { context }) =>
			runHook(rosterSheet(contextOf(context), String(ctx.today)), callerReadAsHost(ctx.read))
	}
});

/** The page's context as plain text: an id and two ISO days, each optional. */
function contextOf(context: {
	readonly company_id?: unknown;
	readonly from?: unknown;
	readonly to?: unknown;
}) {
	return {
		...(context.company_id == null ? {} : { company_id: String(context.company_id) }),
		...(context.from == null ? {} : { from: String(context.from) }),
		...(context.to == null ? {} : { to: String(context.to) })
	};
}
