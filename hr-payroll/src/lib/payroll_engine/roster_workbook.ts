/**
 * The roster workbook, one month in two sheets. Plan is the scheme: each person-day's shift and planned overtime. Work
 * entries are what happened: a clock in and a clock out. A file may carry either or both and each writes only its own
 * fields, so the plan can go in ahead of the month and the clocks after it. A blank row and a day the file leaves out
 * stay as they are, and a day a payroll run sealed refuses a change. Times are read in the entity's zone.
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
	normalToken,
	sheetTable,
	WorkbookRowsError,
	type SheetTable,
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
	/** A timed shift's clock hours, which place a night shift's overtime on the right morning. */
	readonly start_time?: string | null;
	readonly end_time?: string | null;
	readonly ends_next_day?: boolean;
};
export type RosterStored = {
	readonly id: Id<'roster_entry'>;
	readonly employment_id: Id<'employee_contract'>;
	readonly work_date: string;
	readonly shift_definition_id: Id<'shift_definition'> | null;
	readonly planned_overtime_intervals: readonly RosterStoredInterval[] | null;
	readonly actual_worked_intervals: readonly RosterStoredInterval[] | null;
	readonly consent: Consent | null;
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

/** What a person-day's rows change: the plan's fields, the clocks, or both. */
export type RosterFields = {
	readonly shift_definition_id?: Id<'shift_definition'>;
	readonly planned_overtime_intervals?: readonly RosterInterval[] | null;
	readonly actual_worked_intervals?: readonly RosterInterval[];
	readonly consent?: Consent | null;
};
export type RosterCreateDraft = RosterFields & {
	readonly employment_id: Id<'employee_contract'>;
	readonly work_date: PlainDate;
};
export type RosterUpdateDraft = {
	readonly target: Id<'roster_entry'>;
	readonly employment_id: Id<'employee_contract'>;
	readonly set: RosterFields;
};
export type RosterPlan = {
	readonly creates: readonly RosterCreateDraft[];
	readonly updates: readonly RosterUpdateDraft[];
	readonly count: number;
	readonly overwritten: readonly string[];
	readonly warnings: readonly string[];
};

export const ROSTER_SHEETS = { plan: 'Plan', work: 'Work entries' } as const;
const EMPLOYEE = ['employee_number', 'employee', 'employee_no'];
const WORK_DATE = ['work_date', 'date', 'day'];
const PLAN_COLUMNS = {
	employee_number: EMPLOYEE,
	work_date: WORK_DATE,
	shift_code: ['shift_code', 'shift', 'planned_shift'],
	overtime_start: ['planned_ot_start', 'planned_overtime_start', 'ot_start'],
	overtime_end: ['planned_ot_end', 'planned_overtime_end', 'ot_end'],
	consent_night_work: ['consent_night_work', 'night_work_consent'],
	consent_overtime: ['consent_overtime', 'overtime_consent'],
	consent_reference: ['consent_reference', 'consent_form']
};
const CONSENT_COLUMNS = ['consent_night_work', 'consent_overtime', 'consent_reference'] as const;
const WORK_COLUMNS = {
	employee_number: EMPLOYEE,
	work_date: WORK_DATE,
	clock_in: ['clock_in', 'in', 'actual_in', 'start'],
	clock_out: ['clock_out', 'out', 'actual_out', 'end']
};

type RawRow = {
	readonly at: number;
	readonly number: string;
	readonly day: string;
	readonly shift: string;
	readonly first: Cell | null;
	readonly last: Cell | null;
	readonly consentNight: Cell | null;
	readonly consentOvertime: Cell | null;
	readonly consentReference: Cell | null;
};

/** A per-day consent row: all three columns go together, and a blank boolean is false. */
type Consent = {
	readonly night_work: boolean;
	readonly overtime: boolean;
	readonly reference: string;
};
const consentOf = (row: RawRow, problems: string[]): Consent | undefined => {
	const night = cellText(row.consentNight);
	const overtime = cellText(row.consentOvertime);
	const reference = cellText(row.consentReference);
	if (night === '' && overtime === '' && reference === '') return undefined;
	if (reference === '') {
		problems.push(`Row ${row.at}: enter the signed consent reference.`);
		return undefined;
	}
	const flag = (value: string) => ['true', 'yes', 'y', '1'].includes(value.trim().toLowerCase());
	return { night_work: flag(night), overtime: flag(overtime), reference };
};

/** One sheet's person-days. A row with nothing in it past the person and date changes nothing, so it is dropped. */
const sheetRows = (
	table: SheetTable,
	shiftCell: string,
	firstCell: string,
	lastCell: string,
	consent = false
) => {
	const problems: string[] = [];
	const rows: RawRow[] = [];
	for (const row of table.rows) {
		const number = cellText(row.cells.employee_number);
		const dateText = cellText(row.cells.work_date);
		const day = cellDay(row.cells.work_date);
		const shift = cellText(row.cells[shiftCell]);
		const first = row.cells[firstCell] ?? null;
		const last = row.cells[lastCell] ?? null;
		const consentNight = consent ? (row.cells.consent_night_work ?? null) : null;
		const consentOvertime = consent ? (row.cells.consent_overtime ?? null) : null;
		const consentReference = consent ? (row.cells.consent_reference ?? null) : null;
		if (number === '') problems.push(`Row ${row.at}: enter the employee number.`);
		if (day == null) problems.push(`Row ${row.at}: "${dateText}" is not a work date (YYYY-MM-DD).`);
		if (number === '' || day == null) continue;
		if (
			shift === '' &&
			cellText(first) === '' &&
			cellText(last) === '' &&
			cellText(consentNight) === '' &&
			cellText(consentOvertime) === '' &&
			cellText(consentReference) === ''
		)
			continue;
		rows.push({
			at: row.at,
			number,
			day,
			shift,
			first,
			last,
			consentNight,
			consentOvertime,
			consentReference
		});
	}
	raiseProblems(problems.map((problem) => `${table.name}: ${problem}`));
	return rows;
};

const rowsOf = (grids: WorkbookSheetGrids) => {
	const holds = (aliases: readonly string[]) =>
		[...grids.values()].some((table) =>
			(table[0] ?? []).some((cell) => aliases.includes(normalToken(cell)))
		);
	const planned = holds(PLAN_COLUMNS.shift_code);
	const worked = holds(WORK_COLUMNS.clock_in);
	if (!planned && !worked)
		throw new WorkbookRowsError(
			`The file needs a ${ROSTER_SHEETS.plan} sheet with a shift column, or a ${ROSTER_SHEETS.work} sheet with clock in and clock out columns.`
		);
	const plan = planned
		? sheetRows(
				sheetTable(
					grids,
					PLAN_COLUMNS,
					['overtime_start', 'overtime_end', ...CONSENT_COLUMNS],
					ROSTER_SHEETS.plan
				),
				'shift_code',
				'overtime_start',
				'overtime_end',
				true
			)
		: [];
	const work = worked
		? sheetRows(
				sheetTable(grids, WORK_COLUMNS, [], ROSTER_SHEETS.work),
				'',
				'clock_in',
				'clock_out'
			)
		: [];
	const months = [...new Set([...plan, ...work].map((row) => row.day.slice(0, 7)))].toSorted();
	if (months.length === 0) throw new WorkbookRowsError('The file has no work-day rows.');
	if (months.length > 1)
		throw new WorkbookRowsError(`The file spans ${months.join(', ')}; import one month at a time.`);
	return { plan, work, month: months[0]! };
};

/** Every row's month; one file is one month. */
export const rosterMonth = (grids: WorkbookSheetGrids): string => rowsOf(grids).month;

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
	from: Cell | null,
	to: Cell | null,
	[startName, endName]: readonly [string, string],
	day: string,
	zone: string,
	at: number,
	problems: string[]
): readonly RosterInterval[] | null | undefined => {
	const hasStart = from != null && cellText(from) !== '';
	const hasEnd = to != null && cellText(to) !== '';
	if (hasStart !== hasEnd) {
		problems.push(`Row ${at}: ${startName} and ${endName} go together.`);
		return undefined;
	}
	if (!hasStart) return null;
	const start = clockAt(from, day, zone, at, startName, problems);
	if (start == null) return undefined;
	const end = clockAt(to, day, zone, at, endName, problems);
	if (end == null) return undefined;
	if (Date.parse(end.instant) === Date.parse(start.instant)) {
		problems.push(`Row ${at}: ${endName} must be after ${startName}.`);
		return undefined;
	}
	if (Date.parse(end.instant) < Date.parse(start.instant)) {
		if (end.explicitDate) {
			problems.push(
				`Row ${at}: ${endName} ${end.instant} is before ${startName} ${start.instant}.`
			);
			return undefined;
		}
		const next = parseInstant(`${addDays(day, 1)} ${end.time ?? ''}`, zone);
		if (next == null || Date.parse(next) <= Date.parse(start.instant)) {
			problems.push(`Row ${at}: ${endName} must be after ${startName}.`);
			return undefined;
		}
		return [{ start: start.instant, end: next }];
	}
	return [{ start: start.instant, end: end.instant }];
};

const minutesOf = (time: string): number =>
	Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** The day planned overtime's bare times fall on: past midnight, nearer a night shift's end than its next start. */
const overtimeDay = (row: RawRow, shift: RosterShift | null, zone: string): string => {
	const start = clockAt(row.first, row.day, zone, row.at, '', []);
	if (
		start == null ||
		start.explicitDate ||
		start.time == null ||
		shift?.ends_next_day !== true ||
		shift.start_time == null ||
		shift.end_time == null
	)
		return row.day;
	return minutesOf(start.time) * 2 < minutesOf(shift.start_time) + minutesOf(shift.end_time)
		? addDays(row.day, 1)
		: row.day;
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

/** Compared to the minute: that is all a sheet holds, so an untouched row reads as unchanged. */
const intervals = (value: readonly RosterStoredInterval[] | null | undefined): string =>
	JSON.stringify(
		(value ?? []).map((interval) =>
			[interval.start, interval.end].map((at) => Math.floor(Date.parse(at) / 60_000))
		)
	);

const hasBreaks = (value: readonly RosterStoredInterval[] | null): boolean =>
	(value ?? []).some(
		(interval) => (interval.break_minutes ?? 0) > 0 || (interval.breaks?.length ?? 0) > 0
	);

/** The fields of `set` the day does not hold yet. */
const changed = (entry: RosterStored | undefined, set: RosterFields): RosterFields => ({
	...(set.shift_definition_id !== undefined &&
	set.shift_definition_id !== entry?.shift_definition_id
		? { shift_definition_id: set.shift_definition_id }
		: {}),
	...(set.consent !== undefined &&
	JSON.stringify(set.consent ?? null) !== JSON.stringify(entry?.consent ?? null)
		? { consent: set.consent }
		: {}),
	...(set.planned_overtime_intervals !== undefined &&
	intervals(set.planned_overtime_intervals) !== intervals(entry?.planned_overtime_intervals)
		? { planned_overtime_intervals: set.planned_overtime_intervals }
		: {}),
	...(set.actual_worked_intervals !== undefined &&
	intervals(set.actual_worked_intervals) !== intervals(entry?.actual_worked_intervals)
		? { actual_worked_intervals: set.actual_worked_intervals }
		: {})
});

export function planRosterUpload(grids: WorkbookSheetGrids, known: RosterKnown): RosterPlan {
	const { plan, work, month } = rowsOf(grids);
	try {
		Zone(known.zone);
	} catch {
		throw new WorkbookRowsError(`The entity's time zone "${known.zone}" is not known.`);
	}
	const period = monthOf(PlainDate(`${month}-01`));
	const last = period.to ?? period.from;
	const stored = new Map(
		known.entries.map((entry) => [
			`${entry.employment_id}:${String(entry.work_date).slice(0, 10)}`,
			entry
		])
	);
	const problems: string[] = [];
	const warnings: string[] = [];
	const days = new Map<
		string,
		{
			readonly employment_id: Id<'employee_contract'>;
			readonly number: string;
			readonly day: string;
			readonly entry: RosterStored | undefined;
			set: RosterFields;
		}
	>();
	/** A sheet's rows on the people they name, each person-day once. */
	const located = (rows: readonly RawRow[]) => {
		const seen = new Map<string, number>();
		return rows.flatMap((row) => {
			if (row.day < period.from || row.day > last) {
				problems.push(`Row ${row.at}: ${row.day} is outside ${month}.`);
				return [];
			}
			const employee = employeeOn(
				known.employees,
				known.entity_name,
				row.number,
				row.day,
				row.at,
				problems
			);
			if (employee == null) return [];
			const key = `${employee.id}:${row.day}`;
			const earlier = seen.get(key);
			if (earlier !== undefined) {
				problems.push(`Row ${row.at}: repeats ${row.number} ${row.day} from row ${earlier}.`);
				return [];
			}
			seen.set(key, row.at);
			return [{ row, employee, key }];
		});
	};
	const put = (row: RawRow, employee: RosterEmployee, key: string, set: RosterFields) => {
		const entry = stored.get(key);
		const fields = changed(entry, set);
		if (Object.keys(fields).length === 0 && entry !== undefined) return;
		if (entry?.payroll_run_id != null) {
			problems.push(
				`Row ${row.at}: ${row.number} ${row.day} is sealed by payroll run ${entry.run_label ?? entry.payroll_run_id}; delete that run to change it.`
			);
			return;
		}
		days.set(key, {
			employment_id: employee.id,
			number: row.number,
			day: row.day,
			entry,
			set: { ...days.get(key)?.set, ...fields }
		});
	};
	for (const { row, employee, key } of located(plan)) {
		const shift = shiftOf(known.shifts, employee, row.shift, row.day, row.at, problems);
		if (shift === undefined) continue;
		const overtime = intervalOf(
			row.first,
			row.last,
			['planned OT start', 'planned OT end'],
			overtimeDay(row, shift, known.zone),
			known.zone,
			row.at,
			problems
		);
		if (overtime === undefined) continue;
		const consent = consentOf(row, problems);
		if (consent === undefined && cellText(row.consentReference) !== '') continue;
		put(row, employee, key, {
			...(shift === null ? {} : { shift_definition_id: shift.id }),
			planned_overtime_intervals: overtime,
			...(consent === undefined ? {} : { consent })
		});
	}
	const worked = new Map<string, { at: number; day: string; interval: RosterInterval }[]>();
	for (const { row, employee, key } of located(work)) {
		const interval = intervalOf(
			row.first,
			row.last,
			['clock in', 'clock out'],
			row.day,
			known.zone,
			row.at,
			problems
		);
		if (interval == null || interval[0] === undefined) continue;
		worked.set(employee.id, [
			...(worked.get(employee.id) ?? []),
			{ at: row.at, day: row.day, interval: interval[0] }
		]);
		put(row, employee, key, { actual_worked_intervals: interval });
	}
	for (const shifts of worked.values()) {
		const list = shifts.toSorted((left, right) => left.day.localeCompare(right.day));
		for (let index = 1; index < list.length; index++) {
			const previous = list[index - 1]!;
			const next = list[index]!;
			if (Date.parse(next.interval.start) < Date.parse(previous.interval.end))
				problems.push(`Row ${next.at}: ${next.day} overlaps the interval on ${previous.day}.`);
		}
	}
	raiseProblems(problems);
	const creates: RosterCreateDraft[] = [];
	const updates: RosterUpdateDraft[] = [];
	const overwritten: string[] = [];
	for (const { employment_id, number, day, entry, set } of days.values()) {
		if (entry === undefined) {
			creates.push({ employment_id, work_date: PlainDate(day), ...set });
			continue;
		}
		const replaced =
			(set.shift_definition_id !== undefined && entry.shift_definition_id != null) ||
			(set.planned_overtime_intervals !== undefined &&
				(entry.planned_overtime_intervals ?? []).length > 0) ||
			(set.actual_worked_intervals !== undefined &&
				(entry.actual_worked_intervals ?? []).length > 0);
		if (replaced) overwritten.push(`${number} ${day}`);
		if (set.actual_worked_intervals !== undefined && hasBreaks(entry.actual_worked_intervals))
			warnings.push(`${number} ${day}: the stored break detail was replaced by the import.`);
		updates.push({ target: entry.id, employment_id, set });
	}
	return {
		creates,
		updates,
		count: days.size,
		overwritten,
		warnings
	};
}

/** A person-day as the workbook writes it out. */
export type RosterDay = {
	readonly number: string;
	readonly name: string;
	readonly date: string;
	readonly shift: string | null;
	readonly planned: { readonly start: string; readonly end: string } | null;
	readonly worked: { readonly start: string; readonly end: string } | null;
};

/** The month's two sheets, ready to fill in: a time that falls on another day than the work date carries that date. */
export const rosterSheets = (rows: readonly RosterDay[], zone: string) => {
	// sv-SE writes `YYYY-MM-DD HH:mm`, the form a cell reads back
	const local = new Intl.DateTimeFormat('sv-SE', {
		timeZone: zone,
		dateStyle: 'short',
		timeStyle: 'short'
	});
	const clock = (at: string | undefined, date: string): string | null => {
		if (at === undefined) return null;
		const text = local.format(new Date(at));
		return text.startsWith(date) ? text.slice(11) : text;
	};
	return new Map([
		[
			ROSTER_SHEETS.plan,
			[
				['Employee number', 'Name', 'Date', 'Shift', 'Planned OT start', 'Planned OT end'],
				...rows.map((row) => [
					row.number,
					row.name,
					row.date,
					row.shift,
					clock(row.planned?.start, row.date),
					clock(row.planned?.end, row.date)
				])
			]
		],
		[
			ROSTER_SHEETS.work,
			[
				['Employee number', 'Name', 'Date', 'Clock in', 'Clock out'],
				...rows.map((row) => [
					row.number,
					row.name,
					row.date,
					clock(row.worked?.start, row.date),
					clock(row.worked?.end, row.date)
				])
			]
		]
	]);
};
