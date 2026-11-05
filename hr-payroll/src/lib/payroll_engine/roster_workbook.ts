/**
 * The roster workbook: a full month for each person it names. A file row is that day's planned shift
 * and actual worked interval; the roster's pattern stays the projection for a day the file leaves
 * out. Importing one month replaces that person's entries for the month, and a roster sealed by a
 * payroll run refuses the file. One row per person-day; intervals are read in the entity's zone.
 */
import type { Cell } from '@norbital-ai/std/sheet';
import type { Id } from '@norbital-ai/bolt';
import { Instant, PlainDate, Zone, addDays, monthOf, parseInstant } from '@norbital-ai/std/date';
import {
	cellDay,
	cellText,
	employeeOn,
	inRange,
	raiseProblems,
	sheetTable,
	WorkbookRowsError,
	type WorkbookSheetGrids
} from './workbook_rows.js';

export type RosterInterval = {
	readonly start: Instant;
	readonly end: Instant;
};
export type RosterStoredInterval = RosterInterval & {
	readonly break_minutes?: number | null;
	readonly breaks?: readonly RosterInterval[] | null;
};

export type RosterEmployee = {
	readonly id: Id<'employee_contract'>;
	readonly number: string;
	readonly entity_id: Id<'entity'>;
	readonly from: string;
	readonly to: string | null;
};
export type RosterShift = {
	readonly id: Id<'shift_definition'>;
	readonly entity_id: Id<'entity'>;
	readonly code: string;
	readonly from: string | null;
	readonly to: string | null;
};
export type RosterStored = {
	readonly id: Id<'roster_entry'>;
	readonly employment_id: Id<'employee_contract'>;
	readonly work_date: string;
	readonly shift_definition_id: Id<'shift_definition'> | null;
	readonly actual_worked_intervals: readonly RosterStoredInterval[] | null;
	readonly payroll_run_id: Id<'payroll_run'> | null;
	readonly run_label: string | null;
};
export type RosterKnown = {
	readonly entity_name: string;
	readonly zone: string;
	readonly employees: readonly RosterEmployee[];
	readonly shifts: readonly RosterShift[];
	readonly entries: readonly RosterStored[];
};

export type RosterEntryDraft = {
	readonly work_date: PlainDate;
	readonly shift_definition_id: Id<'shift_definition'> | null;
	readonly actual_worked_intervals: readonly RosterInterval[] | null;
};
export type RosterCreateDraft = RosterEntryDraft & {
	readonly employment_id: Id<'employee_contract'>;
};
export type RosterUpdateDraft = {
	readonly target: Id<'roster_entry'>;
	readonly employment_id: Id<'employee_contract'>;
	readonly set: RosterEntryDraft;
};
export type RosterDeleteDraft = {
	readonly target: Id<'roster_entry'>;
	readonly employment_id: Id<'employee_contract'>;
};
export type RosterPlan = {
	readonly creates: readonly RosterCreateDraft[];
	readonly updates: readonly RosterUpdateDraft[];
	readonly deletes: readonly RosterDeleteDraft[];
	readonly count: number;
	readonly overwritten: readonly string[];
	readonly warnings: readonly string[];
};

const EMPLOYEE = ['employee_number', 'employee', 'employee_no'];

const ROSTER_COLUMNS = {
	employee_number: EMPLOYEE,
	work_date: ['work_date', 'date', 'day'],
	shift_code: ['shift_code', 'shift', 'planned_shift'],
	clock_in: ['clock_in', 'in', 'actual_in', 'start'],
	clock_out: ['clock_out', 'out', 'actual_out', 'end']
} as const;
const ROSTER_OPTIONAL = ['shift_code', 'clock_in', 'clock_out'];

type RawRow = {
	readonly at: number;
	readonly number: string;
	readonly day: string;
	readonly shift: string;
	readonly clockIn: Cell | null;
	readonly clockOut: Cell | null;
};

const rowsOf = (grids: WorkbookSheetGrids): readonly RawRow[] => {
	const table = sheetTable(grids, ROSTER_COLUMNS, ROSTER_OPTIONAL, 'Roster');
	const problems: string[] = [];
	const rows: RawRow[] = [];
	for (const row of table.rows) {
		const number = cellText(row.cells.employee_number);
		const dateText = cellText(row.cells.work_date);
		const day = cellDay(row.cells.work_date);
		if (number === '') problems.push(`Row ${row.at}: enter the employee number.`);
		if (day == null) problems.push(`Row ${row.at}: "${dateText}" is not a work date (YYYY-MM-DD).`);
		if (number === '' || day == null) continue;
		rows.push({
			at: row.at,
			number,
			day,
			shift: cellText(row.cells.shift_code),
			clockIn: row.cells.clock_in ?? null,
			clockOut: row.cells.clock_out ?? null
		});
	}
	raiseProblems(problems);
	if (rows.length === 0) throw new WorkbookRowsError('The file has no work-day rows.');
	return rows;
};

/** Every row's month; one file is one month. */
export function rosterMonth(grids: WorkbookSheetGrids): string {
	const rows = rowsOf(grids);
	const months = [...new Set(rows.map((row) => row.day.slice(0, 7)))].toSorted();
	if (months.length !== 1)
		throw new WorkbookRowsError(`The file spans ${months.join(', ')}; import one month at a time.`);
	return months[0]!;
}

type Clock = {
	readonly instant: Instant;
	readonly explicitDate: boolean;
	readonly time: string | null;
};

const clockAt = (
	value: Cell | null,
	day: string,
	zone: string,
	at: number,
	column: string,
	problems: string[]
): Clock | null => {
	if (value == null || cellText(value) === '') return null;
	if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
		const minutes = Math.round(value * 1440) % 1440;
		const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
		const instant = parseInstant(`${day} ${time}`, zone);
		if (instant == null) {
			problems.push(`Row ${at}: ${column} cannot be read in ${zone}.`);
			return null;
		}
		return { instant, explicitDate: false, time };
	}
	const text = cellText(value);
	const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
	if (timeOnly != null) {
		const time = `${timeOnly[1]!.padStart(2, '0')}:${timeOnly[2]}`;
		const instant = parseInstant(`${day} ${time}`, zone);
		if (instant == null) {
			problems.push(`Row ${at}: ${column} "${text}" is not a clock time.`);
			return null;
		}
		return { instant, explicitDate: false, time };
	}
	const instant = parseInstant(text, zone);
	if (instant == null) {
		problems.push(`Row ${at}: ${column} "${text}" is not a clock time or dated timestamp.`);
		return null;
	}
	return {
		instant,
		explicitDate: /^\d{4}-\d{2}-\d{2}/.test(text),
		time: text.slice(11, 16)
	};
};

const intervalOf = (
	clockIn: Cell | null,
	clockOut: Cell | null,
	day: string,
	zone: string,
	at: number,
	problems: string[]
): readonly RosterInterval[] | null | undefined => {
	const hasIn = clockIn != null && cellText(clockIn) !== '';
	const hasOut = clockOut != null && cellText(clockOut) !== '';
	if (hasIn !== hasOut) {
		problems.push(`Row ${at}: a clock-in needs its clock-out.`);
		return undefined;
	}
	if (!hasIn) return null;
	const start = clockAt(clockIn, day, zone, at, 'clock in', problems);
	if (start == null) return undefined;
	const end = clockAt(clockOut, day, zone, at, 'clock out', problems);
	if (end == null) return undefined;
	if (Date.parse(end.instant) === Date.parse(start.instant)) {
		problems.push(`Row ${at}: clock out must be after clock in.`);
		return undefined;
	}
	if (Date.parse(end.instant) < Date.parse(start.instant)) {
		if (end.explicitDate) {
			problems.push(`Row ${at}: clock out ${end.instant} is before clock in ${start.instant}.`);
			return undefined;
		}
		const next = parseInstant(`${addDays(day, 1)} ${end.time ?? ''}`, zone);
		if (next == null || Date.parse(next) <= Date.parse(start.instant)) {
			problems.push(`Row ${at}: clock out must be after clock in.`);
			return undefined;
		}
		return [{ start: start.instant, end: next }];
	}
	return [{ start: start.instant, end: end.instant }];
};

const shiftOf = (
	shifts: readonly RosterShift[],
	employee: RosterEmployee,
	code: string,
	day: string,
	at: number,
	problems: string[]
): RosterShift | null | undefined => {
	if (code === '') return null;
	const matches = shifts.filter(
		(shift) =>
			shift.entity_id === employee.entity_id &&
			shift.code.trim().toUpperCase() === code.trim().toUpperCase() &&
			inRange(day, { from: shift.from ?? '0000-01-01', to: shift.to })
	);
	if (matches.length === 1) return matches[0]!;
	problems.push(
		matches.length === 0
			? `Row ${at}: "${code}" is not a shift code in effect for ${employee.number} on ${day}.`
			: `Row ${at}: "${code}" names more than one shift in effect on ${day}.`
	);
	return undefined;
};

const intervals = (value: readonly RosterStoredInterval[] | null): string =>
	JSON.stringify((value ?? []).map((interval) => [interval.start, interval.end]));

const hasBreaks = (value: readonly RosterStoredInterval[] | null): boolean =>
	(value ?? []).some(
		(interval) => (interval.break_minutes ?? 0) > 0 || (interval.breaks?.length ?? 0) > 0
	);

export function planRosterUpload(grids: WorkbookSheetGrids, known: RosterKnown): RosterPlan {
	const rows = rowsOf(grids);
	const months = [...new Set(rows.map((row) => row.day.slice(0, 7)))];
	if (months.length !== 1)
		throw new WorkbookRowsError(
			`The file spans ${months.toSorted().join(', ')}; import one month at a time.`
		);
	try {
		Zone(known.zone);
	} catch {
		throw new WorkbookRowsError(`The entity's time zone "${known.zone}" is not known.`);
	}
	const month = months[0]!;
	const period = monthOf(PlainDate(`${month}-01`));
	const last = period.to ?? period.from;
	const problems: string[] = [];
	const warnings: string[] = [];
	const sealed = new Map<Id<'employee_contract'>, RosterStored>();
	for (const entry of known.entries) {
		const day = String(entry.work_date).slice(0, 10);
		if (entry.payroll_run_id != null && day >= period.from && day <= last)
			sealed.set(entry.employment_id, entry);
	}
	const reportedSealed = new Set<Id<'employee_contract'>>();
	const groups = new Map<
		Id<'employee_contract'>,
		Map<string, { at: number; draft: RosterEntryDraft }>
	>();
	for (const row of rows) {
		if (row.day < period.from || row.day > last) {
			problems.push(`Row ${row.at}: ${row.day} is outside ${month}.`);
			continue;
		}
		const employee = employeeOn(
			known.employees,
			known.entity_name,
			row.number,
			row.day,
			row.at,
			problems
		);
		if (employee == null) continue;
		const locked = sealed.get(employee.id);
		if (locked != null) {
			if (!reportedSealed.has(employee.id)) {
				reportedSealed.add(employee.id);
				problems.push(
					`Row ${row.at}: ${row.number}'s roster is sealed by payroll run ${locked.run_label ?? locked.payroll_run_id}; the month cannot be replaced.`
				);
			}
			continue;
		}
		const shift = shiftOf(known.shifts, employee, row.shift, row.day, row.at, problems);
		if (shift === undefined) continue;
		const worked = intervalOf(row.clockIn, row.clockOut, row.day, known.zone, row.at, problems);
		if (worked === undefined) continue;
		const group = groups.get(employee.id) ?? new Map();
		groups.set(employee.id, group);
		const earlier = group.get(row.day);
		if (earlier != null) {
			problems.push(`Row ${row.at}: repeats ${row.number} ${row.day} from row ${earlier.at}.`);
			continue;
		}
		group.set(row.day, {
			at: row.at,
			draft: {
				work_date: PlainDate(row.day),
				shift_definition_id: shift?.id ?? null,
				actual_worked_intervals: worked
			}
		});
	}
	for (const [employmentId, days] of groups) {
		const number = known.employees.find((employee) => employee.id === employmentId)?.number ?? '';
		const list = [...days.values()].toSorted((left, right) =>
			left.draft.work_date.localeCompare(right.draft.work_date)
		);
		for (let index = 1; index < list.length; index++) {
			const previous = list[index - 1]!.draft.actual_worked_intervals?.at(-1);
			const next = list[index]!.draft.actual_worked_intervals?.[0];
			if (previous != null && next != null && Date.parse(next.start) < Date.parse(previous.end))
				problems.push(
					`Row ${list[index]!.at}: ${number}'s ${list[index]!.draft.work_date} interval overlaps the interval on ${list[index - 1]!.draft.work_date}.`
				);
		}
	}
	raiseProblems(problems);
	const creates: RosterCreateDraft[] = [];
	const updates: RosterUpdateDraft[] = [];
	const deletes: RosterDeleteDraft[] = [];
	const overwritten: string[] = [];
	for (const [employmentId, days] of groups) {
		const number = known.employees.find((employee) => employee.id === employmentId)?.number ?? '';
		const list = [...days.values()]
			.toSorted((left, right) => left.draft.work_date.localeCompare(right.draft.work_date))
			.map((day) => day.draft);
		const stored = new Map<string, RosterStored>();
		for (const entry of known.entries) {
			if (entry.employment_id !== employmentId) continue;
			const day = String(entry.work_date).slice(0, 10);
			if (day >= period.from && day <= last) stored.set(day, entry);
		}
		for (const draft of list) {
			const existing = stored.get(draft.work_date);
			if (existing == null) {
				creates.push({ employment_id: employmentId, ...draft });
				continue;
			}
			stored.delete(draft.work_date);
			if (
				(existing.shift_definition_id ?? null) === draft.shift_definition_id &&
				intervals(existing.actual_worked_intervals) === intervals(draft.actual_worked_intervals)
			)
				continue;
			if (hasBreaks(existing.actual_worked_intervals))
				warnings.push(
					`${number} ${draft.work_date}: the stored break detail was replaced by the import.`
				);
			overwritten.push(`${number} ${draft.work_date}`);
			updates.push({ target: existing.id, employment_id: employmentId, set: draft });
		}
		for (const entry of stored.values()) {
			overwritten.push(`${number} ${String(entry.work_date).slice(0, 10)}`);
			deletes.push({ target: entry.id, employment_id: employmentId });
		}
	}
	return {
		creates,
		updates,
		deletes,
		count: rows.length,
		overwritten,
		warnings
	};
}
