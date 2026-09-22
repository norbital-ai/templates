/**
 * The `work_days` import: one workbook, one legal entity, one calendar month — the roster of
 * record, the attendance of that month and the approved overtime, as a set.
 *
 * The file replaces the month. For every employee of the entity, every stored work day of the
 * month is removed and the file's days are written; a person the file names gets a roster of
 * record for the month, a person it does not name loses the month's days and roster and falls
 * back to the shift pattern. A Roster sheet on its own replaces only the plan half of every day;
 * a Time entries sheet on its own replaces only the attendance half; an Overtime sheet on its own
 * replaces only the approved hours, and a person it does not name loses the month's approvals.
 *
 * Two things are refused before anything is written. A named person must have a shift on every
 * day of the month they are employed — a roster is whole or it is not one. And a day a payslip
 * has already taken into account is sealed: the file may restate it unchanged, but a sealed day
 * it changes or omits is a conflict, and the whole file is refused naming those days.
 *
 * Statutory limits — the weekly rest ceiling, hour ceilings, granted breaks, adjacent-shift
 * overlap — are the `work_days` transform's, and refuse the write with person, day and rule.
 * Holidays are never stored on a day; they are overlaid from the entity's calendar, so PH is not
 * a roster code: the cell names the shift the person would have worked.
 */
import { resolveEmployment } from '../../lib/employment-contract.js';
import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate, isClockTime, isUtcIsoInstant } from '@norbital-ai/std/date';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect, Schema } from 'effect';
import { dateKey } from '../../lib/iso-day.js';
import { addDays, formatNamedList, isYearMonth, monthBounds } from '../../lib/period.js';
import { leaveCoverage } from '../../lib/scheduling/leave-coverage.js';
import { leaveActivityOf } from '../../lib/leave/activity-fields.js';
import { rosterCodeVariantSchema } from '../../datatypes/roster_code_variant/+definition.js';
import { coversDate } from '../payroll_runs/lib/effective.js';
import type { Api, Pipelines, WorkspaceRow } from './$types.js';
import { clockMinutes } from '../../lib/scheduling/roster-code.js';

const QUERY_LIMIT = 20_000;
const PH_TOKENS = new Set(['PH', 'PUBLIC_HOLIDAY']);

type CompanyIdentity = Pick<
	WorkspaceRow<'companies'>,
	'id' | 'name' | 'registration_number' | 'settings_code'
>;

function resolveLegalEntity<Company extends CompanyIdentity>(
	companies: readonly Company[],
	legalEntity: string
): Company {
	const wanted = legalEntity.trim().toLowerCase();
	const matches = companies.filter(
		(company) =>
			company.name.trim().toLowerCase() === wanted ||
			(company.registration_number != null &&
				company.registration_number.trim().toLowerCase() === wanted)
	);
	if (matches.length === 1) return matches[0]!;
	if (matches.length === 0) {
		refuse(
			`No legal entity named "${legalEntity}" is on file.\n` +
				`Known entities:\n${formatNamedList(companies.map((company) => company.name))}`
		);
	}
	refuse(
		`"${legalEntity}" matches more than one legal entity:\n${formatNamedList(matches.map((company) => company.name))}`
	);
}

const trimmedNonEmpty = Schema.Trimmed.check(Schema.isMinLength(1));

const rosterRowSchema = Schema.Struct({
	employee_number: trimmedNonEmpty,
	work_date: trimmedNonEmpty,
	shift_code: trimmedNonEmpty
});
type RosterRow = Schema.Schema.Type<typeof rosterRowSchema>;

const attendanceRowSchema = Schema.Struct({
	employee_number: trimmedNonEmpty,
	work_date: trimmedNonEmpty,
	clock_in: trimmedNonEmpty,
	clock_out: Schema.optional(Schema.NullOr(trimmedNonEmpty))
});
type AttendanceRow = Schema.Schema.Type<typeof attendanceRowSchema>;

const overtimeRowSchema = Schema.Struct({
	employee_number: trimmedNonEmpty,
	work_date: trimmedNonEmpty,
	overtime_hours: Schema.Number
});
type OvertimeRow = Schema.Schema.Type<typeof overtimeRowSchema>;

/** The whole workbook. A sheet the file does not carry is `undefined`; an empty sheet is `[]`. */
const importSchema = Schema.Struct({
	legal_entity: trimmedNonEmpty,
	month: trimmedNonEmpty,
	timezone: Schema.optional(trimmedNonEmpty),
	roster: Schema.optional(Schema.Array(rosterRowSchema)),
	attendance: Schema.optional(Schema.Array(attendanceRowSchema)),
	overtime: Schema.optional(Schema.Array(overtimeRowSchema))
});
type WorkbookImport = Schema.Schema.Type<typeof importSchema>;

function personDayKey(employmentId: string, workDate: string): string {
	return `${employmentId}\t${workDate}`;
}

function who(row: { readonly employee_number: string; readonly work_date: string }): string {
	return `${row.employee_number} on ${row.work_date}`;
}

/** Rows validated as dates inside the month, stated once each. */
function assertRowsOfMonth(
	rows: readonly { readonly employee_number: string; readonly work_date: string }[],
	month: string,
	sheet: string
): void {
	const invalid = rows.filter((row) => !isCalendarDate(row.work_date));
	if (invalid.length > 0)
		refuse(
			`These ${sheet} rows do not use valid YYYY-MM-DD dates:\n${formatNamedList(invalid.map(who))}`
		);
	const bounds = monthBounds(month);
	const outside = rows.filter((row) => row.work_date < bounds.start || row.work_date > bounds.end);
	if (outside.length > 0)
		refuse(`These ${sheet} rows do not belong to ${month}:\n${formatNamedList(outside.map(who))}`);
	const seen = new Set<string>();
	const repeated: string[] = [];
	for (const row of rows) {
		const key = `${row.employee_number}\t${row.work_date}`;
		if (seen.has(key)) repeated.push(who(row));
		seen.add(key);
	}
	if (repeated.length > 0)
		refuse(
			`The ${sheet} sheet repeats the same employee and day:\n${formatNamedList(repeated)}\nPut everything about one day in that day's single cell.`
		);
}

/** Resolve each imported person-day against its approved contract's actual service window. */
function readImportContracts(
	api: Api,
	rows: readonly Pick<RosterRow, 'employee_number' | 'work_date'>[],
	companyId?: string
) {
	return Effect.gen(function* () {
		const employments = yield* api.db.employments.findMany({
			where: {
				employee_number: { in: [...new Set(rows.map((row) => row.employee_number))] },
				...(companyId == null ? {} : { company_id: { eq: companyId } }),
				approval_id: { isNull: true }
			},
			columns: {
				id: true,
				employee_id: true,
				company_id: true,
				employee_number: true,
				effective_range: true
			},
			limit: QUERY_LIMIT
		});
		if (employments.length >= QUERY_LIMIT)
			refuse('Employment contract history is incomplete; the import cannot choose safely.');
		const contracts = employments.map(resolveEmployment);
		const byPersonDay = new Map(
			rows.map((row) => {
				const matches = contracts.filter(
					(contract) =>
						contract.employee_number === row.employee_number &&
						coversDate(contract.effective_range, row.work_date)
				);
				if (matches.length === 0)
					refuse(
						`No approved employment contract covers ${row.employee_number} on ${row.work_date}` +
							(companyId == null ? '.' : ' in this legal entity.')
					);
				if (matches.length > 1) {
					const companies = new Set(matches.map((contract) => contract.company_id));
					refuse(
						`More than one employment contract covers ${row.employee_number} on ${row.work_date}. ` +
							(companies.size > 1
								? 'Set legal_entity on the Settings sheet to the employing entity this file is for.'
								: 'Resolve the overlapping contracts or employee-number ambiguity before importing.')
					);
				}
				return [personDayKey(row.employee_number, row.work_date), matches[0]!] as const;
			})
		);
		return (row: Pick<RosterRow, 'employee_number' | 'work_date'>) =>
			byPersonDay.get(personDayKey(row.employee_number, row.work_date))!;
	});
}

function assertValidTimeZone(timeZone: string): Effect.Effect<void, never, never> {
	return Effect.try({
		try: () => {
			Intl.DateTimeFormat(undefined, { timeZone });
		},
		catch: () => null
	}).pipe(
		Effect.catch(() =>
			Effect.sync(() =>
				refuse(
					`"${timeZone}" is not a recognized IANA timezone. Use a place such as Asia/Kuala_Lumpur, not a fixed UTC offset.`
				)
			)
		)
	);
}

/** An equal or earlier wall-clock close is the following calendar day. */
function endCalendarDate(workDate: string, started: string, ended: string): string {
	return clockMinutes(ended) <= clockMinutes(started)
		? new Date(Date.parse(`${workDate}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
		: workDate;
}

function localWallTimeToUtcIso(calendarDate: string, clockTime: string, timeZone: string): string {
	const [year, month, day] = calendarDate.split('-').map(Number) as [number, number, number];
	const [hour, minute] = clockTime.split(':').map(Number) as [number, number];
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});
	const shownMilliseconds = (instant: Date): number => {
		const parts = formatter.formatToParts(instant);
		const part = (type: Intl.DateTimeFormatPartTypes) =>
			parts.find((candidate) => candidate.type === type)?.value ?? '';
		let shownHour = decodeNumber(part('hour'));
		if (shownHour === 24) shownHour = 0;
		return Date.UTC(
			decodeNumber(part('year')),
			decodeNumber(part('month')) - 1,
			decodeNumber(part('day')),
			shownHour,
			decodeNumber(part('minute')),
			decodeNumber(part('second'))
		);
	};

	const desired = Date.UTC(year, month - 1, day, hour, minute);
	let resolved = desired;
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const delta = desired - shownMilliseconds(new Date(resolved));
		if (delta === 0) break;
		resolved += delta;
	}
	if (shownMilliseconds(new Date(resolved)) !== desired) {
		refuse(
			`Could not resolve ${calendarDate} ${clockTime} in ${timeZone}. The local time may fall in a daylight-saving gap.`
		);
	}
	const iso = new Date(resolved).toISOString();
	if (!isUtcIsoInstant(iso)) refuse(`Could not resolve ${calendarDate} ${clockTime}.`);
	return iso;
}

/** The clock half of a person-day: the intervals worked, and nothing else. */
function attendanceValues(row: AttendanceRow, timeZone: string) {
	const start = localWallTimeToUtcIso(row.work_date, row.clock_in, timeZone);
	const end =
		row.clock_out == null
			? null
			: localWallTimeToUtcIso(
					endCalendarDate(row.work_date, row.clock_in, row.clock_out),
					row.clock_out,
					timeZone
				);
	return { worked_intervals: [{ start, end }] };
}

/** Two attendance halves are the same when their closed instants match minute for minute. */
function sameIntervals(left: unknown, right: unknown): boolean {
	const normalize = (value: unknown) =>
		value == null
			? null
			: JSON.stringify(
					(value as readonly { start: string; end: string | null }[]).map((interval) => [
						Date.parse(interval.start),
						interval.end == null ? null : Date.parse(interval.end)
					])
				);
	return normalize(left) === normalize(right);
}

// ── the import ──────────────────────────────────────────────────────────────────────────────────

type PlanHalf = { readonly shift_definition_id: string | null };
type ClockHalf = {
	readonly worked_intervals: readonly { start: string; end: string | null }[] | null;
};
type OvertimeHalf = { readonly approved_overtime_hours: number };

function importWorkbookMonth(payload: WorkbookImport, api: Api) {
	return Effect.gen(function* () {
		const { legal_entity: legalEntity, month, timezone, roster, attendance, overtime } = payload;
		if (!isYearMonth(month))
			refuse(
				`Set month on the Settings sheet to the YYYY-MM month this file is for, not "${month}".`
			);
		if (roster === undefined && attendance === undefined && overtime === undefined)
			refuse('The file has none of the Roster, Time entries or Overtime sheets.');
		if (attendance !== undefined && (timezone == null || timezone === ''))
			refuse(
				'This file does not say which timezone its clock times are in, so they cannot be imported. Add a "timezone" row to the Settings sheet — an IANA name such as Asia/Kuala_Lumpur.'
			);
		if (timezone != null) yield* assertValidTimeZone(timezone);
		const bounds = monthBounds(month);

		const companies = yield* api.db.companies.findMany({
			columns: { id: true, name: true, registration_number: true, settings_code: true },
			limit: QUERY_LIMIT
		});
		const company = resolveLegalEntity(companies, legalEntity);

		// ── the sheets, validated ──────────────────────────────────────────────────────────────────
		if (roster !== undefined) assertRowsOfMonth(roster, month, 'Roster');
		if (attendance !== undefined) assertRowsOfMonth(attendance, month, 'Time entries');
		if (overtime !== undefined) assertRowsOfMonth(overtime, month, 'Overtime');
		const phRows = (roster ?? []).filter((row) => PH_TOKENS.has(row.shift_code.toUpperCase()));
		if (phRows.length > 0)
			refuse(
				`PH is not a roster code. A holiday is overlaid from ${company.name}'s calendar; the cell names the shift the person would have worked, or REST or OFF:\n${formatNamedList(phRows.map(who))}`
			);
		const invalidClocks = (attendance ?? []).flatMap((row) =>
			(
				[
					['clock_in', row.clock_in],
					['clock_out', row.clock_out]
				] as const
			).flatMap(([field, value]) =>
				value == null || isClockTime(value) ? [] : [`${who(row)}: ${field} "${value}"`]
			)
		);
		if (invalidClocks.length > 0)
			refuse(
				`These clock fields are not valid local times (HH:mm):\n${formatNamedList(invalidClocks)}`
			);

		const codes = [...new Set((roster ?? []).map((row) => row.shift_code))];
		const shiftRows = codes.length
			? yield* api.db.shift_definitions.findMany({
					where: { company_id: { eq: company.id }, code: { in: codes } },
					columns: { id: true, code: true, variant: true, effective_range: true },
					limit: QUERY_LIMIT
				})
			: [];
		const shiftByCode = new Map(shiftRows.map((code) => [code.code, code]));
		const unknownCodes = codes.filter((code) => !shiftByCode.has(code));
		if (unknownCodes.length > 0)
			refuse(
				`These roster codes are not defined for ${company.name}:\n${formatNamedList(unknownCodes)}`
			);
		const ineffective = (roster ?? []).filter(
			(row) => !coversDate(shiftByCode.get(row.shift_code)!.effective_range, row.work_date)
		);
		if (ineffective.length > 0)
			refuse(
				`These roster codes are not effective on the assigned date:\n${formatNamedList(ineffective.map(who))}`
			);
		for (const code of shiftRows) Schema.decodeUnknownSync(rosterCodeVariantSchema)(code.variant);

		// ── who the file names, on which contracts ─────────────────────────────────────────────────
		const namedRows = [...(roster ?? []), ...(attendance ?? []), ...(overtime ?? [])];
		const contractFor = yield* readImportContracts(api, namedRows, company.id);

		// ── a roster is whole: every employed day of the month, for every person the sheet names ──
		if (roster !== undefined) {
			const named = [...new Set(roster.map((row) => row.employee_number))];
			const contracts = named.length
				? yield* api.db.employments.findMany({
						where: {
							employee_number: { in: named },
							company_id: { eq: company.id },
							approval_id: { isNull: true }
						},
						columns: { id: true, employee_number: true, effective_range: true },
						limit: QUERY_LIMIT
					})
				: [];
			const stated = new Set(roster.map((row) => `${row.employee_number}\t${row.work_date}`));
			const gaps: string[] = [];
			for (const number of named) {
				const own = contracts
					.filter((row) => row.employee_number === number)
					.map(resolveEmployment);
				const missing: string[] = [];
				for (let date = bounds.start; date <= bounds.end; date = addDays(date, 1))
					if (
						own.some((contract) => coversDate(contract.effective_range, date)) &&
						!stated.has(`${number}\t${date}`)
					)
						missing.push(date);
				if (missing.length > 0)
					gaps.push(
						`${number}: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` and ${missing.length - 8} more` : ''}`
					);
			}
			if (gaps.length > 0)
				refuse(
					`A roster covers every day of the month a person is employed. These people are missing days in ${month} — write REST or OFF where they are not working:\n${formatNamedList(gaps)}`
				);
		}

		// ── attendance and approved overtime cannot land on a day approved leave owns ─────────────
		const recordedRows = [...(attendance ?? []), ...(overtime ?? [])];
		if (recordedRows.length > 0) {
			const employmentIds = [...new Set(recordedRows.map((row) => contractFor(row).id))];
			const leaveRows = yield* api.db.leave_entries.findMany({
				where: {
					employment_id: { in: employmentIds },
					approval_id: { isNull: true },
					from_date: { lte: bounds.end },
					to_date: { gte: bounds.start }
				},
				columns: {
					employment_id: true,
					from_date: true,
					to_date: true,
					half_day_start: true,
					half_day_end: true,
					// The activity is derived from the row — its charges, its days, the reversal tick —
					// rather than stored as a column, so time off is selected here and not in the
					// predicate. The predicate this replaces named `kind`, a column that does not exist.
					charges: true,
					days: true,
					encash_days: true,
					destination_from: true,
					destination_to: true,
					as_adjustment_entry: true
				},
				limit: QUERY_LIMIT
			});
			const timeOff = leaveRows.filter((row) => leaveActivityOf(row) === 'TIME_OFF');
			for (const row of recordedRows) {
				const employmentId = contractFor(row).id;
				const covering = timeOff
					.filter((request) => request.employment_id === employmentId)
					.find((request) => leaveCoverage(request, row.work_date).fullDay);
				if (covering != null)
					refuse(
						`${who(row)} is covered by approved leave ${dateKey(covering.from_date)} → ` +
							`${dateKey(covering.to_date)}. Attendance or approved overtime on a leave day is not recorded; amend or cancel that leave first.`
					);
			}
		}

		// ── the file's days, one row per person-day, on the halves the file carries ────────────────
		const fileDays = new Map<
			string,
			{
				employmentId: string;
				workDate: string;
				label: string;
				plan?: PlanHalf;
				clock?: ClockHalf;
				approved?: OvertimeHalf;
			}
		>();
		const dayOf = (row: { employee_number: string; work_date: string }) => {
			const employmentId = contractFor(row).id;
			const key = personDayKey(employmentId, row.work_date);
			const day = fileDays.get(key) ?? { employmentId, workDate: row.work_date, label: who(row) };
			fileDays.set(key, day);
			return day;
		};
		for (const row of roster ?? [])
			dayOf(row).plan = { shift_definition_id: shiftByCode.get(row.shift_code)!.id };
		for (const row of attendance ?? []) dayOf(row).clock = attendanceValues(row, timezone!);
		for (const row of overtime ?? [])
			dayOf(row).approved = { approved_overtime_hours: row.overtime_hours };
		const blankPlan: PlanHalf = { shift_definition_id: null };
		const blankClock: ClockHalf = { worked_intervals: null };
		const blankOvertime: OvertimeHalf = { approved_overtime_hours: 0 };
		const carriesPlan = roster !== undefined;
		const carriesClock = attendance !== undefined;
		const carriesOvertime = overtime !== undefined;

		// ── the month as stored, for every employee of the entity ──────────────────────────────────
		const employees = yield* api.db.employments.findMany({
			where: { company_id: { eq: company.id }, approval_id: { isNull: true } },
			columns: { id: true, employee_number: true },
			limit: QUERY_LIMIT
		});
		if (employees.length >= QUERY_LIMIT) refuse('Employment history is incomplete.');
		const numberByEmployment = new Map(employees.map((row) => [row.id, row.employee_number]));
		const stored = yield* api.db.work_days.findMany({
			where: {
				employment_id: { in: employees.map((row) => row.id) },
				work_date: { gte: bounds.start, lt: addDays(bounds.end, 1) },
				approval_id: { isNull: true }
			},
			columns: {
				id: true,
				employment_id: true,
				work_date: true,
				shift_definition_id: true,
				worked_intervals: true,
				approved_overtime_hours: true,
				payslip_id: true
			},
			limit: QUERY_LIMIT
		});
		if (stored.length >= QUERY_LIMIT) refuse('Work day history is incomplete.');

		// ── sealed days: restated unchanged passes, changed or omitted is a conflict ───────────────
		const conflicts: string[] = [];
		const untouched = new Set<string>();
		const existingByKey = new Map<string, (typeof stored)[number]>();
		for (const day of stored) {
			const date = dateKey(day.work_date) ?? '';
			const key = personDayKey(day.employment_id, date);
			existingByKey.set(key, day);
			if (day.payslip_id == null) continue;
			const label = `${numberByEmployment.get(day.employment_id) ?? day.employment_id} on ${date}`;
			const file = fileDays.get(key);
			if (file === undefined) {
				conflicts.push(`${label} (the file leaves it out)`);
				continue;
			}
			const planSame =
				!carriesPlan || (file.plan ?? blankPlan).shift_definition_id === day.shift_definition_id;
			const clockSame =
				!carriesClock ||
				sameIntervals((file.clock ?? blankClock).worked_intervals, day.worked_intervals);
			const overtimeSame =
				!carriesOvertime ||
				(file.approved ?? blankOvertime).approved_overtime_hours ===
					(day.approved_overtime_hours ?? 0);
			if (planSame && clockSame && overtimeSame) untouched.add(key);
			else conflicts.push(`${label} (the file changes it)`);
		}
		if (conflicts.length > 0)
			refuse(
				`These days are already taken into account by a payslip, and the file would change them:\n${formatNamedList(conflicts)}\nA sealed day may only be restated as it is. Delete that payroll run to release them, then import the month again.`
			);

		// ── the set: remove what the file does not name, write what it does ────────────────────────
		const deletes: string[] = [];
		const clears: Array<{ id: string } & Partial<PlanHalf & ClockHalf & OvertimeHalf>> = [];
		for (const [key, day] of existingByKey) {
			if (fileDays.has(key)) continue;
			// A half the file does not carry is left alone; a half it carries is cleared, because the
			// file's set does not name this day. A day with nothing left after the clears is deleted.
			const keepsAnyHalf =
				(carriesPlan ? false : day.shift_definition_id != null) ||
				(carriesClock ? false : day.worked_intervals != null) ||
				(carriesOvertime ? false : (day.approved_overtime_hours ?? 0) > 0);
			if (!keepsAnyHalf) {
				deletes.push(day.id);
				continue;
			}
			clears.push({
				id: day.id,
				...(carriesPlan ? blankPlan : {}),
				...(carriesClock ? blankClock : {}),
				...(carriesOvertime ? blankOvertime : {})
			});
		}
		if (deletes.length > 0) yield* api.collection.work_days.deleteMany(deletes);

		// ── rosters of record: one per person the Roster sheet names; gone for those it drops ──────
		if (carriesPlan) {
			const wanted = new Set(
				[...fileDays.values()].filter((day) => day.plan).map((day) => day.employmentId)
			);
			const rosters = yield* api.db.rosters.findMany({
				where: { employment_id: { in: employees.map((row) => row.id) }, period: { eq: month } },
				columns: { id: true, employment_id: true },
				limit: QUERY_LIMIT
			});
			const present = new Set(rosters.map((row) => row.employment_id));
			const creates = [...wanted]
				.filter((employmentId) => !present.has(employmentId))
				.map((employmentId) => ({ employment_id: employmentId, period: month }));
			if (creates.length > 0) yield* api.collection.rosters.createMany(creates);
			const dropped = rosters.filter((row) => !wanted.has(row.employment_id)).map((row) => row.id);
			if (dropped.length > 0) yield* api.collection.rosters.deleteMany(dropped);
		}

		// Days the file restates are updated here; an import returns the days it creates.
		const restated = [...fileDays.entries()]
			.filter(([key]) => !untouched.has(key) && existingByKey.has(key))
			.map(([key, day]) => ({
				id: existingByKey.get(key)!.id,
				...(carriesPlan ? (day.plan ?? blankPlan) : {}),
				...(carriesClock ? (day.clock ?? blankClock) : {}),
				...(carriesOvertime ? (day.approved ?? blankOvertime) : {})
			}));
		const updates = [...restated, ...clears];
		if (updates.length > 0) yield* api.collection.work_days.updateMany(updates);

		return [...fileDays.entries()]
			.filter(([key]) => !existingByKey.has(key))
			.map(([, day]) => ({
				...(carriesPlan ? (day.plan ?? blankPlan) : {}),
				...(carriesClock ? (day.clock ?? blankClock) : {}),
				...(carriesOvertime ? (day.approved ?? blankOvertime) : {}),
				employment_id: day.employmentId,
				work_date: day.workDate
			}));
	});
}

export default {
	import: {
		description:
			'Loads one calendar month of person-days for one legal entity from the scheduling workbook, as a set: the Roster sheet is the roster of record (a shift, REST or OFF on every employed day of the month, or the file is refused), the Time entries sheet is the attendance (local punches in the Settings timezone, stored as worked intervals) and the Overtime sheet is the approved overtime (hours after the shift, in half-hour steps, inclusive of breaks). Every stored day of the month is replaced for every employee of the entity; a person the file names gets a roster of record for the month, a person it omits loses the month and falls back to the shift pattern. A sheet the file does not carry leaves that half of every day alone. A day a payslip has taken into account may be restated unchanged; one the file changes or omits refuses the whole file by name. Statutory rest, hour, break and overlap rules refuse the write with person, day and rule. Holidays are overlaid from the calendar and never imported; overtime is keyed, never derived.',
		input: importSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const payload = Schema.decodeUnknownSync(importSchema)(input);
				return yield* importWorkbookMonth(payload, api);
			})
	}
} satisfies Pipelines;
