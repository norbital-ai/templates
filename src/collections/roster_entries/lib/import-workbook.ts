/** Browser-side parsing for the monthly roster workbook. */
import {
	identifyRowByColumns,
	readRows,
	readSheetTable,
	type RowReader,
	type WorkbookGrids
} from '../../../lib/workbook-rows.js';

export const ROSTER_SHEET_NAME = 'Roster';
const REQUIRED_COLUMNS = ['employee_number', 'work_date', 'shift_code'] as const;

export interface RosterImportRow {
	readonly employee_number: string;
	readonly work_date: string;
	/** A real company roster code, or the reserved import token PH. */
	readonly shift_code: string;
	readonly assignment_code?: string;
	readonly note?: string;
}

export interface RosterImportPayload {
	readonly roster_id: string;
	readonly rows: readonly RosterImportRow[];
}

function identifyRosterRow(reader: RowReader): string {
	return identifyRowByColumns(reader, ['employee_number', 'work_date']);
}

/**
 * Blank shift cells are absent assignments, not inferred rest days. Legacy sheets with a day_type
 * column remain readable by translating REST, OFF and PUBLIC_HOLIDAY into roster-code tokens.
 */
export function rosterImportPayload(grids: WorkbookGrids, rosterId: string): RosterImportPayload {
	const table = readSheetTable(grids, ROSTER_SHEET_NAME, REQUIRED_COLUMNS);
	const parsed = readRows(table, identifyRosterRow, (reader) => {
		const legacyKind = reader.text('day_type')?.toUpperCase();
		const suppliedCode = reader.text('shift_code');
		const shiftCode =
			suppliedCode ??
			(legacyKind === 'REST'
				? 'REST'
				: legacyKind === 'OFF'
					? 'OFF'
					: legacyKind === 'PUBLIC_HOLIDAY'
						? 'PH'
						: undefined);
		return {
			employee_number: reader.requiredText('employee_number') ?? '',
			work_date: reader.calendarDate('work_date') ?? '',
			shift_code: shiftCode,
			assignment_code: reader.text('assignment_code'),
			note: reader.text('note')
		};
	});
	return {
		roster_id: rosterId,
		rows: parsed.flatMap((row): RosterImportRow[] =>
			row.shift_code == null
				? []
				: [
						{
							employee_number: row.employee_number,
							work_date: row.work_date,
							shift_code: row.shift_code,
							assignment_code: row.assignment_code,
							note: row.note
						}
					]
		)
	};
}
