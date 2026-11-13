/**
 * The roster workbook, one month in two sheets. Plan is the scheme: each person-day's shift and planned overtime. Work
 * entries are what happened: a clock in and a clock out. A file may carry either or both and each writes only its own
 * fields, so the plan can go in ahead of the month and the clocks after it. A blank row and a day the file leaves out
 * stay as they are. Times are read in the entity's zone.
 */
import { DateTime, Option } from 'effect';
import type { Id, Instant, PlainDate } from '@norbital-ai/bolt';
import {
	type Cell,
	cellDay,
	cellText,
	employeeOn,
	inRange,
	raiseProblems,
	type Problem,
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
	readonly id: Id<'employment'>;
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
	readonly employment_id: Id<'employment'>;
	readonly work_date: string;
	readonly shift_definition_id: Id<'shift_definition'> | null;
	readonly planned_overtime_intervals: readonly RosterStoredInterval[] | null;
	readonly overtime_as_time_off: boolean;
	readonly actual_worked_intervals: readonly RosterStoredInterval[] | null;
	readonly consent: Consent | null;
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
	readonly overtime_as_time_off?: boolean;
	readonly actual_worked_intervals?: readonly RosterInterval[];
	readonly consent?: Consent | null;
};
/** One person-day the import writes: its key and what it changes; a stored day takes only those fields. */
export type RosterImportRow = RosterFields & {
	readonly employment_id: Id<'employment'>;
	readonly work_date: PlainDate;
};
export type RosterPlan = {
	readonly rows: readonly RosterImportRow[];
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
	time_off: ['ot_as_time_off', 'overtime_as_time_off', 'time_off'],
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
	readonly timeOff: Cell | null;
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
/** Where a row's problem is: the person, the day and the row, as people find it in the sheet. */
const whereOf = (row: { readonly number: string; readonly day: string; readonly at: number }) =>
	`${row.number} on ${row.day} (row ${row.at})`;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const flag = (value: string) => ['true', 'yes', 'y', '1'].includes(value.trim().toLowerCase());
const consentOf = (row: RawRow, problems: Problem[]): Consent | undefined => {
	const night = cellText(row.consentNight);
	const overtime = cellText(row.consentOvertime);
	const reference = cellText(row.consentReference);
	if (night === '' && overtime === '' && reference === '') return undefined;
	if (reference === '') {
		problems.push({ issue: 'Enter the signed consent reference', where: whereOf(row) });
		return undefined;
	}
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
	const problems: Problem[] = [];
	const rows: RawRow[] = [];
	for (const row of table.rows) {
		const number = cellText(row.cells.employee_number);
		const dateText = cellText(row.cells.work_date);
		const day = cellDay(row.cells.work_date);
		const shift = cellText(row.cells[shiftCell]);
		const first = row.cells[firstCell] ?? null;
		const last = row.cells[lastCell] ?? null;
		const timeOff = consent ? (row.cells.time_off ?? null) : null;
		const consentNight = consent ? (row.cells.consent_night_work ?? null) : null;
		const consentOvertime = consent ? (row.cells.consent_overtime ?? null) : null;
		const consentReference = consent ? (row.cells.consent_reference ?? null) : null;
		if (number === '')
			problems.push({ issue: 'Enter the employee number', where: `${table.name} row ${row.at}` });
		if (day == null)
			problems.push({
				issue: 'Write the date as YYYY-MM-DD',
				where: `${number} "${dateText}" (${table.name} row ${row.at})`
			});
		if (number === '' || day == null) continue;
		if (
			shift === '' &&
			cellText(first) === '' &&
			cellText(last) === '' &&
			cellText(timeOff) === '' &&
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
			timeOff,
			consentNight,
			consentOvertime,
			consentReference
		});
	}
	raiseProblems(problems);
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
					['overtime_start', 'overtime_end', 'time_off', ...CONSENT_COLUMNS],
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
	where: string,
	column: string,
	problems: Problem[]
): Clock | null => {
	if (value == null || cellText(value) === '') return null;
	if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
		const time = DateTime.formatUtc(
			DateTime.add(DateTime.makeUnsafe(0), { minutes: Math.round(value * 1440) % 1440 }),
			{ locale: 'en', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
		);
		const instant = DateTime.makeZoned(`${day}T${time}`, {
			timeZone: zone,
			adjustForTimeZone: true
		}).pipe(Option.map(DateTime.formatIso), Option.getOrNull);
		if (instant == null) {
			problems.push({ issue: `${column} cannot be read in ${zone}`, where });
			return null;
		}
		return { instant, explicitDate: false, time };
	}
	const text = cellText(value);
	const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
	if (timeOnly != null) {
		const hour = Number(timeOnly[1]),
			minute = Number(timeOnly[2]);
		const time = DateTime.formatUtc(DateTime.makeUnsafe({ hour, minute }), {
			locale: 'en',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		});
		const instant =
			hour > 23 || minute > 59
				? null
				: DateTime.makeZoned(`${day}T${time}`, { timeZone: zone, adjustForTimeZone: true }).pipe(
						Option.map(DateTime.formatIso),
						Option.getOrNull
					);
		if (instant == null) {
			problems.push({ issue: `${column} is not a clock time`, where: `${where}: "${text}"` });
			return null;
		}
		return { instant, explicitDate: false, time };
	}
	// an instant with its offset, or a wall time `YYYY-MM-DD HH:MM[:SS]` read in the zone
	const wall = /^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(text);
	const instant = (
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i.test(text)
			? DateTime.make(text)
			: wall !== null &&
				  Option.exists(DateTime.make(wall[1]!), (d) => DateTime.formatIsoDate(d) === wall[1])
				? DateTime.makeZoned(`${wall[1]}T${wall[2]}:${wall[3]}:${wall[4] ?? '00'}`, {
						timeZone: zone,
						adjustForTimeZone: true
					})
				: Option.none()
	).pipe(Option.map(DateTime.formatIso), Option.getOrNull);
	if (instant == null) {
		problems.push({
			issue: `${column} is not a time (HH:MM) or a date and time`,
			where: `${where}: "${text}"`
		});
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
	where: string,
	problems: Problem[]
): readonly RosterInterval[] | null | undefined => {
	const hasStart = from != null && cellText(from) !== '';
	const hasEnd = to != null && cellText(to) !== '';
	if (hasStart !== hasEnd) {
		problems.push({
			issue: hasStart
				? `${capital(startName)} with no ${endName}`
				: `${capital(endName)} with no ${startName}`,
			where
		});
		return undefined;
	}
	if (!hasStart) return null;
	const start = clockAt(from, day, zone, where, capital(startName), problems);
	if (start == null) return undefined;
	const end = clockAt(to, day, zone, where, capital(endName), problems);
	if (end == null) return undefined;
	if (Date.parse(end.instant) === Date.parse(start.instant)) {
		problems.push({ issue: `${capital(endName)} is not after ${startName}`, where });
		return undefined;
	}
	if (Date.parse(end.instant) < Date.parse(start.instant)) {
		if (end.explicitDate) {
			problems.push({
				issue: `${capital(endName)} is before ${startName}`,
				where: `${where}: ${start.instant} to ${end.instant}`
			});
			return undefined;
		}
		const next =
			end.time == null
				? null
				: DateTime.makeZoned(
						`${DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(day), { days: 1 }))}T${end.time}`,
						{ timeZone: zone, adjustForTimeZone: true }
					).pipe(Option.map(DateTime.formatIso), Option.getOrNull);
		if (next == null || Date.parse(next) <= Date.parse(start.instant)) {
			problems.push({ issue: `${capital(endName)} is not after ${startName}`, where });
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
	const start = clockAt(row.first, row.day, zone, '', '', []);
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
		? DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(row.day), { days: 1 }))
		: row.day;
};

const shiftOf = (
	shifts: readonly RosterShift[],
	employee: RosterEmployee,
	code: string,
	day: string,
	where: string,
	problems: Problem[]
): RosterShift | null | undefined => {
	if (code === '') return null;
	const matches = shifts.filter(
		(shift) =>
			shift.entity_id === employee.entity_id &&
			shift.code.trim().toUpperCase() === code.trim().toUpperCase() &&
			inRange(day, { from: shift.from ?? '0000-01-01', to: shift.to })
	);
	if (matches.length === 1) return matches[0]!;
	problems.push({
		issue:
			matches.length === 0
				? 'Not a shift code in effect that day'
				: 'The shift code names more than one shift in effect that day',
		where: `${where}: "${code}"`
	});
	return undefined;
};

/** Compared to the minute: that is all a sheet holds, so an untouched row reads as unchanged. */
const intervals = (value: readonly RosterStoredInterval[] | null | undefined): string =>
	JSON.stringify(
		(value ?? []).map((interval) =>
			[interval.start, interval.end].map((at) =>
				DateTime.toEpochMillis(DateTime.startOf(DateTime.makeUnsafe(at), 'minute'))
			)
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
	...(set.overtime_as_time_off !== undefined &&
	set.overtime_as_time_off !== (entry?.overtime_as_time_off ?? false)
		? { overtime_as_time_off: set.overtime_as_time_off }
		: {}),
	...(set.actual_worked_intervals !== undefined &&
	intervals(set.actual_worked_intervals) !== intervals(entry?.actual_worked_intervals)
		? { actual_worked_intervals: set.actual_worked_intervals }
		: {})
});

export function planRosterUpload(grids: WorkbookSheetGrids, known: RosterKnown): RosterPlan {
	const { plan, work, month } = rowsOf(grids);
	if (Option.isNone(DateTime.zoneMakeNamed(known.zone)))
		throw new WorkbookRowsError(`The entity's time zone "${known.zone}" is not known.`);
	const last = DateTime.formatIsoDate(DateTime.endOf(DateTime.makeUnsafe(`${month}-01`), 'month'));
	const stored = new Map(
		known.entries.map((entry) => [
			`${entry.employment_id}:${String(entry.work_date).slice(0, 10)}`,
			entry
		])
	);
	const problems: Problem[] = [];
	const warnings: string[] = [];
	const days = new Map<
		string,
		{
			readonly employment_id: Id<'employment'>;
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
			if (row.day < `${month}-01` || row.day > last) {
				problems.push({
					issue: `Outside ${month}; import one month at a time`,
					where: whereOf(row)
				});
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
				problems.push({
					issue: 'The same person and day appear twice',
					where: `${whereOf(row)}, first at row ${earlier}`
				});
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
		days.set(key, {
			employment_id: employee.id,
			number: row.number,
			day: row.day,
			entry,
			set: { ...days.get(key)?.set, ...fields }
		});
	};
	for (const { row, employee, key } of located(plan)) {
		const shift = shiftOf(known.shifts, employee, row.shift, row.day, whereOf(row), problems);
		if (shift === undefined) continue;
		const overtime = intervalOf(
			row.first,
			row.last,
			['planned OT start', 'planned OT end'],
			overtimeDay(row, shift, known.zone),
			known.zone,
			whereOf(row),
			problems
		);
		if (overtime === undefined) continue;
		const consent = consentOf(row, problems);
		if (consent === undefined && cellText(row.consentReference) !== '') continue;
		// a blank leaves the mark as it stands
		const timeOff = cellText(row.timeOff);
		put(row, employee, key, {
			...(shift === null ? {} : { shift_definition_id: shift.id }),
			planned_overtime_intervals: overtime,
			...(timeOff === '' ? {} : { overtime_as_time_off: flag(timeOff) }),
			...(consent === undefined ? {} : { consent })
		});
	}
	const worked = new Map<string, { where: string; day: string; interval: RosterInterval }[]>();
	for (const { row, employee, key } of located(work)) {
		const interval = intervalOf(
			row.first,
			row.last,
			['clock in', 'clock out'],
			row.day,
			known.zone,
			whereOf(row),
			problems
		);
		if (interval == null || interval[0] === undefined) continue;
		worked.set(employee.id, [
			...(worked.get(employee.id) ?? []),
			{ where: whereOf(row), day: row.day, interval: interval[0] }
		]);
		put(row, employee, key, { actual_worked_intervals: interval });
	}
	for (const shifts of worked.values()) {
		const list = shifts.toSorted((left, right) => left.day.localeCompare(right.day));
		for (let index = 1; index < list.length; index++) {
			const previous = list[index - 1]!;
			const next = list[index]!;
			if (Date.parse(next.interval.start) < Date.parse(previous.interval.end))
				problems.push({
					issue: 'Clock times overlap the day before',
					where: `${next.where} overlaps ${previous.day}`
				});
		}
	}
	raiseProblems(problems);
	const rows: RosterImportRow[] = [];
	const overwritten: string[] = [];
	for (const { employment_id, number, day, entry, set } of days.values()) {
		rows.push({ employment_id, work_date: day, ...set });
		if (entry === undefined) continue;
		const replaced =
			(set.shift_definition_id !== undefined && entry.shift_definition_id != null) ||
			(set.planned_overtime_intervals !== undefined &&
				(entry.planned_overtime_intervals ?? []).length > 0) ||
			(set.actual_worked_intervals !== undefined &&
				(entry.actual_worked_intervals ?? []).length > 0);
		if (replaced) overwritten.push(`${number} ${day}`);
		if (set.actual_worked_intervals !== undefined && hasBreaks(entry.actual_worked_intervals))
			warnings.push(`${number} ${day}: the stored break detail was replaced by the import.`);
	}
	return { rows, overwritten, warnings };
}

/** A person-day as the workbook writes it out. */
export type RosterDay = {
	readonly number: string;
	readonly name: string;
	readonly date: string;
	readonly shift: string | null;
	readonly planned: { readonly start: string; readonly end: string } | null;
	readonly time_off: boolean;
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
				[
					'Employee number',
					'Name',
					'Date',
					'Shift',
					'Planned OT start',
					'Planned OT end',
					'OT as time off'
				],
				...rows.map((row) => [
					row.number,
					row.name,
					row.date,
					row.shift,
					clock(row.planned?.start, row.date),
					clock(row.planned?.end, row.date),
					// a blank leaves the mark as it stands: `no` takes it off
					row.time_off ? 'yes' : null
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
