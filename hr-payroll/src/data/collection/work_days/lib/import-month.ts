import { everyField } from '../../../../lib/every-field.js';
/**
 * The `work_days` action `import_month`: one workbook replaces one entity's calendar month — roster
 * of record, attendance and approved overtime (L-TPL-hr-payroll-055). A person the file omits falls
 * back to the pattern; a sheet on its own replaces only its half of every day. Refused before any
 * write: malformed input only — an unknown code or entity, a day no contract covers, a sealed or
 * payslip-taken day restated differently, work on a leave day. A blank roster day, and every
 * statutory limit the file passes (weekly rest, hours, spread-over, breaks, overtime ceilings), is
 * written and returned in `warnings` (owner's rule, 2026-10-01). Overtime totals split at the
 * statutory limits (`splitPlannedOvertime`). The writes
 * are one act: new days created whole, stored days the file changes updated in one batch, emptied days deleted; each
 * row is written once, and every stored day changed or removed is returned by name (`overwritten`).
 */
import type { ActionCtx, Id } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { isCalendarDate, isClockTime, isUtcIsoInstant } from '../../../../lib/iso-day.js';
import { dateKey } from '../../../../lib/iso-day.js';
import { formatNamedList, isYearMonth } from '../../../../lib/period.js';
import { addDays, monthBounds } from '../../../../lib/payroll/run/dates.js';
import { coversDate } from '../../../../lib/payroll/run/effective.js';
import { isEligible, personContext } from '../../../../lib/payroll/run/eligibility.js';
import { leaveCoverage } from '../../../../lib/scheduling/leave-coverage.js';
import {
	clockMinutes,
	rosterCodeKind,
	workWindow
} from '../../../../lib/scheduling/roster-code.js';
import { selectBreakRule } from '../../../../lib/scheduling/rest-break.js';
import { restRunBreaches } from './schedule-rules.js';
import { isRestLimit } from '../../../../lib/datatypes/work_rules.js';
import { settingsInForce } from '../../../../lib/jurisdiction_settings.js';
import { ABSENCE_DECISION_FACTS } from '../../../../lib/leave/entitlement.js';
import type { FactKey } from '../../../../lib/datatypes/fact_keys.js';
import {
	patternAnchor,
	patternRosterCodeId,
	termPatternRow
} from '../../../../lib/scheduling/work-pattern.js';
import {
	applicableLimits,
	assessmentWindow,
	observedDays,
	observedPlan,
	plannedDay,
	projectedLimitBreaches,
	projectionBounds,
	rosterCodeFacts,
	splitPlannedOvertime,
	type OvertimeSplit,
	type RosterCodeFacts,
	type SchedulePlanDay
} from '../../../../lib/scheduling/work-limits.js';
import type { WorkRules } from '../../../../lib/datatypes/work_rules.js';
import type { RosterCodeVariant } from '../../../../lib/datatypes/roster_code_variant.js';
import type { WorkPattern } from '../../../../lib/datatypes/work_pattern.js';
import { offsetMinutesAt } from '../../../../lib/timezone.js';
import * as Predicate from 'effect/Predicate';
import { decodeNumber } from '../../../../lib/wire.js';
import messages from '../../../../i18n/+messages.js';

type Ctx = Pick<ActionCtx<'work_days'>, 'read' | 'act' | 'refuse'>;
type Keyed = { readonly employee_number: string; readonly work_date: string };
type RosterRow = Keyed & { readonly shift_code: string };
type AttendanceRow = Keyed & {
	readonly clock_in: string;
	readonly clock_out?: string | null | undefined;
};
type OvertimeRow = Keyed & {
	readonly overtime_hours: number;
	readonly overtime_consented_at?: string | null | undefined;
	/** The declared work-day inputs the sheet carries (`work_day_facts[].import`), by key. */
	readonly facts?: Readonly<Record<string, string | number | boolean>> | null | undefined;
};
export type MonthImport = {
	readonly legal_entity: string;
	readonly month: string;
	readonly timezone?: string | null | undefined;
	readonly roster?: readonly RosterRow[] | null | undefined;
	readonly attendance?: readonly AttendanceRow[] | null | undefined;
	readonly overtime?: readonly OvertimeRow[] | null | undefined;
};

/** The sheet's public-holiday tokens: the board's own holiday mark, and the spelled-out word. */
const HOLIDAY_MARK = messages['roster.public_holiday_mark'];
const HOLIDAY_TOKENS = new Set([HOLIDAY_MARK.toUpperCase(), 'PUBLIC_HOLIDAY']);
const all = { all: true } as const;
const on = (date: string) => date as `${number}-${number}-${number}`;
const day = (value: unknown): string => (value == null ? '' : dateKey(String(value)));
const hours = (value: unknown): number => (value == null ? 0 : decodeNumber(value));
const personDayKey = (employmentId: string, workDate: string) => `${employmentId}\t${workDate}`;
const who = (row: Keyed) => `${row.employee_number} on ${row.work_date}`;

type Interval = { readonly start: string; readonly end: string | null };
type Halves = {
	shift_definition_id?: string | null;
	worked_intervals?: readonly Interval[] | null;
	approved_overtime_hours?: number;
	incentive_hours?: number;
	overtime_consented_at?: string | null;
	facts?: Readonly<Record<string, unknown>>;
};

/** Every text cell trimmed; an empty one is the sheet's fault, named by row. */
function trimmed<T extends Keyed>(
	rows: readonly T[] | null | undefined,
	sheet: string,
	refuse: Ctx['refuse']
): T[] | undefined {
	if (rows == null) return undefined;
	return rows.map((row, index) => {
		const out = Object.fromEntries(
			Object.entries(row).map(([field, value]) => [
				field,
				Predicate.isString(value) ? value.trim() : value
			])
		) as T;
		const empty = Object.entries(out).find(([, value]) => value === '');
		if (empty !== undefined)
			refuse(`The ${sheet} sheet's row ${index + 1} has an empty ${empty[0]}.`);
		return out;
	});
}

/** Rows validated as dates inside the month, stated once each. */
function assertRowsOfMonth(
	rows: readonly Keyed[],
	month: string,
	sheet: string,
	refuse: Ctx['refuse'],
	repeats = false
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
	if (repeats) return;
	const seen = new Set<string>();
	const repeated: string[] = [];
	for (const row of rows) {
		const at = `${row.employee_number}\t${row.work_date}`;
		if (seen.has(at)) repeated.push(who(row));
		seen.add(at);
	}
	if (repeated.length > 0)
		refuse(
			`The ${sheet} sheet repeats the same employee and day:\n${formatNamedList(repeated)}\nPut everything about one day in that day's single cell.`
		);
}

function localWallTimeToUtcIso(
	calendarDate: string,
	clockTime: string,
	timeZone: string,
	refuse: Ctx['refuse']
): string {
	const [year, month, date] = calendarDate.split('-').map(Number) as [number, number, number];
	const [hour, minute] = clockTime.split(':').map(Number) as [number, number];
	const shown = (instant: Date): number =>
		instant.getTime() + offsetMinutesAt(timeZone, instant) * 60_000;
	const desired = Date.UTC(year, month - 1, date, hour, minute);
	let resolved = desired;
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const delta = desired - shown(new Date(resolved));
		if (delta === 0) break;
		resolved += delta;
	}
	if (shown(new Date(resolved)) !== desired)
		refuse(
			`Could not resolve ${calendarDate} ${clockTime} in ${timeZone}. The local time may fall in a daylight-saving gap.`
		);
	const iso = new Date(resolved).toISOString();
	if (!isUtcIsoInstant(iso)) refuse(`Could not resolve ${calendarDate} ${clockTime}.`);
	return iso;
}

/**
 * One interval of a person-day's clock; a day's rows come in the order the cell lists them. An equal or earlier
 * wall-clock close is the following calendar day, and so is an arrival before the previous interval's close
 * (`22:00-02:00; 03:00-06:00` works past midnight).
 */
function attendanceInterval(
	row: AttendanceRow,
	previous: Interval | undefined,
	timeZone: string,
	refuse: Ctx['refuse']
): Interval {
	let opened = row.work_date;
	let start = localWallTimeToUtcIso(opened, row.clock_in, timeZone, refuse);
	if (previous?.end != null && Date.parse(start) < Date.parse(previous.end)) {
		opened = addDays(opened, 1);
		start = localWallTimeToUtcIso(opened, row.clock_in, timeZone, refuse);
	}
	const close = row.clock_out;
	if (close == null) return { start, end: null };
	return {
		start,
		end: localWallTimeToUtcIso(
			clockMinutes(close) <= clockMinutes(row.clock_in) ? addDays(opened, 1) : opened,
			close,
			timeZone,
			refuse
		)
	};
}

/** Two attendance halves are the same when their instants match. */
export function sameIntervals(left: unknown, right: unknown): boolean {
	const normalize = (value: unknown) =>
		value == null
			? null
			: JSON.stringify(
					(value as readonly Interval[]).map((interval) => [
						Date.parse(interval.start),
						interval.end == null ? null : Date.parse(interval.end)
					])
				);
	return normalize(left) === normalize(right);
}

export async function importMonth(payload: MonthImport, ctx: Ctx) {
	const refuse: Ctx['refuse'] = ctx.refuse;
	const legalEntity = payload.legal_entity.trim();
	const month = payload.month.trim();
	const timezone = payload.timezone?.trim() || null;
	const roster = trimmed(payload.roster, 'Roster', refuse);
	const attendance = trimmed(payload.attendance, 'Time entries', refuse);
	const overtime = trimmed(payload.overtime, 'Overtime', refuse);
	if (!isYearMonth(month))
		refuse(
			`Set month on the Settings sheet to the YYYY-MM month this file is for, not "${month}".`
		);
	if (roster === undefined && attendance === undefined && overtime === undefined)
		refuse('The file has none of the Roster, Time entries or Overtime sheets.');
	if (attendance !== undefined && timezone == null)
		refuse(
			'This file does not say which timezone its clock times are in, so they cannot be imported. Add a "timezone" row to the Settings sheet — an IANA name such as Asia/Kuala_Lumpur.'
		);
	if (timezone != null)
		try {
			Intl.DateTimeFormat(undefined, { timeZone: timezone });
		} catch {
			refuse(
				`"${timezone}" is not a recognized IANA timezone. Use a place such as Asia/Kuala_Lumpur, not a fixed UTC offset.`
			);
		}
	const bounds = monthBounds(month);

	const companies = (await ctx.read('companies', { ...all, select: everyField('companies') })).rows;
	const wanted = legalEntity.toLowerCase();
	const matches = companies.filter(
		(company) =>
			company.name.trim().toLowerCase() === wanted ||
			(company.registration_number != null &&
				company.registration_number.trim().toLowerCase() === wanted)
	);
	if (matches.length === 0)
		refuse(
			`No legal entity named "${legalEntity}" is on file.\nKnown entities:\n${formatNamedList(companies.map((company) => company.name))}`
		);
	if (matches.length > 1)
		refuse(
			`"${legalEntity}" matches more than one legal entity:\n${formatNamedList(matches.map((company) => company.name))}`
		);
	const company = matches[0]!;
	const companyId = company.id;

	// ── the sheets, validated ──
	if (roster !== undefined) assertRowsOfMonth(roster, month, 'Roster', refuse);
	// several rows on one person-day are its intervals (a split shift), in the order the sheet lists them
	if (attendance !== undefined) assertRowsOfMonth(attendance, month, 'Time entries', refuse, true);
	if (overtime !== undefined) assertRowsOfMonth(overtime, month, 'Overtime', refuse);
	const holidayMarked = (roster ?? []).filter((row) =>
		HOLIDAY_TOKENS.has(row.shift_code.toUpperCase())
	);
	if (holidayMarked.length > 0)
		refuse(
			`${HOLIDAY_MARK} is not a roster code. A holiday is overlaid from ${company.name}'s calendar; the cell names the shift the person would have worked, or REST or OFF:\n${formatNamedList(holidayMarked.map(who))}`
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
	const invalidEvidence = (overtime ?? []).flatMap((row) =>
		row.overtime_consented_at == null || isUtcIsoInstant(row.overtime_consented_at)
			? []
			: [`${who(row)}: overtime_consented_at "${row.overtime_consented_at}"`]
	);
	if (invalidEvidence.length > 0)
		refuse(`These agreement facts must be UTC ISO instants:\n${formatNamedList(invalidEvidence)}`);

	// ── one read wave: the entity's codes, patterns, contracts, month, rosters and every settings version ──
	const [codeRows, patternRows, contractRows, versionRows] = await Promise.all([
		ctx.read('shift_definitions', {
			select: everyField('shift_definitions'),
			where: { company_id: { eq: companyId } },
			...all
		}),
		ctx.read('shift_patterns', {
			select: everyField('shift_patterns'),
			where: { company_id: { eq: companyId } },
			...all
		}),
		ctx.read('employments', {
			select: everyField('employments'),
			where: { company_id: { eq: companyId }, approval_id: { isNull: true } },
			...all
		}),
		// the entity's own lineage, and only what picks the version in force and splits overtime (a version's families are large)
		ctx.read('jurisdiction_settings', {
			where: { code: { eq: company.settings_code } },
			select: {
				id: true,
				code: true,
				name: true,
				sealed_at: true,
				voided_at: true,
				approval_id: true,
				effective_range: true,
				work_rules: true,
				work_day_facts: true
			},
			...all
		})
	]);
	const employmentIds = contractRows.rows.map((row) => row.id);
	const versions = versionRows.rows.map((row) => ({
		...row,
		sealed_at: row.sealed_at == null ? null : String(row.sealed_at),
		voided_at: row.voided_at == null ? null : String(row.voided_at),
		approval_id: row.approval_id == null ? null : row.approval_id
	}));
	const monthDates: string[] = [];
	for (let date = bounds.start; date <= bounds.end; date = addDays(date, 1)) monthDates.push(date);
	// A consecutive-work run is read a month either side, the schema's ceiling on the rest limit's `max_days` (30) plus one.
	const restWindow = { start: addDays(bounds.start, -31), end: addDays(bounds.end, 31) };
	// The limits read the days they reach: the union over every limit of the version (a superset of any one person's),
	// the cut-off windows around the month for the overtime split and the rest window for a roster; with neither
	// sheet, the month alone.
	const reach = [
		bounds,
		...(overtime === undefined && roster === undefined
			? []
			: [
					projectionBounds(
						monthDates,
						settingsInForce(versions, company.settings_code, bounds.start)?.work_rules?.limits ?? []
					)
				]),
		...(overtime === undefined
			? []
			: [
					assessmentWindow(bounds.start, company.pay_cutoff_day),
					assessmentWindow(bounds.end, company.pay_cutoff_day)
				]),
		...(roster === undefined ? [] : [restWindow])
	].flatMap((window) => (window == null ? [] : [window]));
	const [storedRows, rosterRows, leaveRows, termRows, holidayRows] = await Promise.all([
		ctx.read('work_days', {
			select: {
				id: true,
				employment_id: true,
				work_date: true,
				shift_definition_id: true,
				worked_intervals: true,
				approved_overtime_hours: true,
				incentive_hours: true,
				overtime_consented_at: true,
				facts: true,
				emergency_cause: true,
				payslip_id: true
			},
			where: {
				employment_id: { in: employmentIds },
				work_date: {
					gte: on(reach.map((window) => window.start).toSorted()[0]!),
					lte: on(
						reach
							.map((window) => window.end)
							.toSorted()
							.at(-1)!
					)
				},
				approval_id: { isNull: true }
			},
			...all
		}),
		ctx.read('rosters', { where: { employment_id: { in: employmentIds } }, ...all }),
		ctx.read('leave_entries', {
			select: everyField('leave_entries'),
			where: {
				employment_id: { in: employmentIds },
				activity: { eq: 'TIME_OFF' },
				approval_id: { isNull: true },
				from_date: { lte: on(bounds.end) },
				to_date: { gte: on(bounds.start) }
			},
			...all
		}),
		ctx.read('employment_terms', {
			select: everyField('employment_terms'),
			where: { employment_id: { in: employmentIds }, approval_id: { isNull: true } },
			...all
		}),
		ctx.read('jurisdiction_holidays', {
			where: {
				company_id: { eq: companyId },
				published_at: { isNull: false },
				approval_id: { isNull: true }
			},
			...all
		})
	]);

	const codes = codeRows.rows.map((code) => ({
		id: String(code.id),
		code: code.code,
		variant: code.variant,
		effective_range: code.effective_range
	}));
	const shiftByCode = new Map(codes.map((code) => [code.code, code]));
	const unknownCodes = [...new Set((roster ?? []).map((row) => row.shift_code))].filter(
		(code) => !shiftByCode.has(code)
	);
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
	for (const row of roster ?? []) rosterCodeKind(shiftByCode.get(row.shift_code)!.variant);

	// ── who the file names, on which contracts ──
	const contracts = contractRows.rows.map((row) => ({
		id: String(row.id),
		employee_number: row.employee_number,
		effective_range: row.effective_range
	}));
	const contractFor = (row: Keyed) => {
		const found = contracts.filter(
			(contract) =>
				contract.employee_number === row.employee_number &&
				coversDate(contract.effective_range, row.work_date)
		);
		if (found.length === 0)
			refuse(
				`No approved employment contract covers ${row.employee_number} on ${row.work_date} in this legal entity.`
			);
		if (found.length > 1)
			refuse(
				`More than one employment contract covers ${row.employee_number} on ${row.work_date}. ` +
					'Resolve the overlapping contracts or employee-number ambiguity before importing.'
			);
		return found[0]!;
	};
	const named = [...(roster ?? []), ...(attendance ?? []), ...(overtime ?? [])];
	for (const row of named) contractFor(row);

	const onLeave = (employmentId: string, date: string) =>
		leaveRows.rows.some(
			(request) =>
				String(request.employment_id) === employmentId &&
				leaveCoverage(
					{ ...request, from_date: day(request.from_date), to_date: day(request.to_date) },
					date
				).fullDay
		);

	// ── what the file breaches is reported, never refused (owner's rule, 2026-10-01) ──
	const warnings: string[] = [];
	const someDates = (dates: readonly string[]) =>
		`${dates.slice(0, 8).join(', ')}${dates.length > 8 ? ` and ${dates.length - 8} more` : ''}`;

	// A blank roster cell writes no plan: the day follows the work pattern (OFF for a rostered-as-assigned contract)
	// and, with no work-day row, payroll treats it as present. A day approved full-day leave owns is blank by design.
	if (roster !== undefined) {
		const stated = new Set(roster.map((row) => `${row.employee_number}\t${row.work_date}`));
		const gaps: string[] = [];
		for (const number of new Set(roster.map((row) => row.employee_number))) {
			const own = contracts.filter((contract) => contract.employee_number === number);
			const missing: string[] = [];
			for (let date = bounds.start; date <= bounds.end; date = addDays(date, 1))
				if (
					!stated.has(`${number}\t${date}`) &&
					own.some(
						(contract) => coversDate(contract.effective_range, date) && !onLeave(contract.id, date)
					)
				)
					missing.push(date);
			if (missing.length > 0) gaps.push(`${number}: ${someDates(missing)}`);
		}
		if (gaps.length > 0)
			warnings.push(
				`These employed days in ${month} have no roster code, so they follow the work pattern and are paid as present. Enter the leave, or a code, where that is wrong:\n${formatNamedList(gaps)}`
			);
	}

	// ── attendance and approved overtime cannot land on a day approved leave owns ──
	for (const row of [...(attendance ?? []), ...(overtime ?? [])]) {
		const employmentId = contractFor(row).id;
		const covering = leaveRows.rows.find(
			(request) =>
				String(request.employment_id) === employmentId &&
				leaveCoverage(
					{ ...request, from_date: day(request.from_date), to_date: day(request.to_date) },
					row.work_date
				).fullDay
		);
		if (covering != null)
			refuse(
				`${who(row)} is covered by approved leave ${day(covering.from_date)} → ${day(covering.to_date)}. ` +
					'Attendance or approved overtime on a leave day is not recorded; amend or cancel that leave first.'
			);
	}

	// ── the file's days, one per person-day, on the halves the file carries ──
	type FileDay = {
		employmentId: string;
		workDate: string;
		plan?: string | null;
		clock?: readonly Interval[] | null;
		approved?: OvertimeSplit;
		consent?: string | null;
		facts?: Readonly<Record<string, string | number | boolean>>;
	};
	const fileDays = new Map<string, FileDay>();
	const dayOf = (row: Keyed) => {
		const employmentId = contractFor(row).id;
		const at = personDayKey(employmentId, row.work_date);
		const found = fileDays.get(at) ?? { employmentId, workDate: row.work_date };
		fileDays.set(at, found);
		return found;
	};
	for (const row of roster ?? []) dayOf(row).plan = shiftByCode.get(row.shift_code)!.id;
	for (const row of attendance ?? []) {
		const found = dayOf(row);
		found.clock = [
			...(found.clock ?? []),
			attendanceInterval(row, found.clock?.at(-1), timezone!, refuse)
		];
	}
	const totalByKey = new Map<string, number>();
	for (const row of overtime ?? []) {
		const found = dayOf(row);
		totalByKey.set(personDayKey(found.employmentId, found.workDate), row.overtime_hours);
		found.consent = row.overtime_consented_at ?? null;
		found.facts = row.facts ?? {};
	}
	// The work-day inputs the version lets the workbook carry; any other column is refused by name.
	const importKeys = (
		(settingsInForce(versions, company.settings_code, bounds.start)?.work_day_facts ??
			[]) as readonly FactKey[]
	)
		.filter((field) => field.import === true)
		.map((field) => field.key);
	const unknownColumns = [
		...new Set((overtime ?? []).flatMap((row) => Object.keys(row.facts ?? {})))
	].filter((key) => !importKeys.includes(key));
	if (unknownColumns.length > 0)
		refuse(
			`The Overtime sheet carries columns these rules do not import:\n${formatNamedList(unknownColumns)}`
		);
	const sameFacts = (
		left: Readonly<Record<string, unknown>> | undefined,
		right: Readonly<Record<string, unknown>>
	) => importKeys.every((key) => (left?.[key] ?? null) === (right[key] ?? null));
	const carriesPlan = roster !== undefined;
	const carriesClock = attendance !== undefined;
	const carriesOvertime = overtime !== undefined;

	// ── the month as stored ──
	const numberByEmployment = new Map(contracts.map((row) => [row.id, row.employee_number]));
	const stored = storedRows.rows.map((row) => ({
		id: row.id,
		employment_id: String(row.employment_id),
		work_date: day(row.work_date),
		shift_definition_id: row.shift_definition_id == null ? null : String(row.shift_definition_id),
		worked_intervals: row.worked_intervals as readonly Interval[] | null,
		absence_decision_recorded: ABSENCE_DECISION_FACTS.some((key) =>
			key === 'partial_absence'
				? (row.facts as Readonly<Record<string, unknown>> | null)?.[key] === true
				: (row.facts as Readonly<Record<string, unknown>> | null)?.[key] != null
		),
		approved_overtime_hours: hours(row.approved_overtime_hours),
		incentive_hours: hours(row.incentive_hours),
		overtime_consented_at:
			row.overtime_consented_at == null ? null : String(row.overtime_consented_at),
		facts: row.facts ?? {},
		emergency_cause: row.emergency_cause === true,
		payslip_id: row.payslip_id
	}));
	const existingByKey = new Map(
		stored
			.filter((row) => row.work_date >= bounds.start && row.work_date <= bounds.end)
			.map((row) => [personDayKey(row.employment_id, row.work_date), row])
	);

	// ── sealed days: restated unchanged passes, changed or omitted is a conflict ──
	const conflicts: string[] = [];
	const untouched = new Set<string>();
	for (const [at, row] of existingByKey) {
		if (!row.absence_decision_recorded) continue;
		const file = fileDays.get(at);
		if (
			(file == null && (carriesPlan || carriesClock)) ||
			(file != null &&
				((carriesPlan && (file.plan ?? null) !== row.shift_definition_id) ||
					(carriesClock && !sameIntervals(file.clock ?? null, row.worked_intervals))))
		)
			conflicts.push(
				`${numberByEmployment.get(row.employment_id) ?? row.employment_id} on ${row.work_date} (the file changes a recorded absence decision)`
			);
	}
	if (conflicts.length > 0)
		refuse(
			`Reassess the saved absence decision before importing changed attendance or roster:\n${formatNamedList(conflicts)}`
		);
	for (const [at, row] of existingByKey) {
		if (row.payslip_id == null) continue;
		const label = `${numberByEmployment.get(row.employment_id) ?? row.employment_id} on ${row.work_date}`;
		const file = fileDays.get(at);
		if (file === undefined) {
			conflicts.push(`${label} (the file leaves it out)`);
			continue;
		}
		const same =
			(!carriesPlan || (file.plan ?? null) === row.shift_definition_id) &&
			(!carriesClock || sameIntervals(file.clock ?? null, row.worked_intervals)) &&
			(!carriesOvertime ||
				((totalByKey.get(at) ?? 0) === row.approved_overtime_hours + row.incentive_hours &&
					(file.consent === undefined || file.consent === row.overtime_consented_at) &&
					(file.facts === undefined || sameFacts(file.facts, row.facts))));
		if (same) untouched.add(at);
		else conflicts.push(`${label} (the file changes it)`);
	}
	if (conflicts.length > 0)
		refuse(
			`These days are already taken into account by a payslip, and the file would change them:\n${formatNamedList(conflicts)}\nA sealed day may only be restated as it is. Delete that payroll run to release them, then import the month again.`
		);

	// ── the statutory limits around the stored days: the Overtime sheet's totals split at them, and every limit the
	// file's roster or overtime passes returned as a warning ──
	if (carriesPlan || carriesOvertime) {
		const version = settingsInForce(versions, company.settings_code, bounds.start);
		if (version == null)
			refuse(`No governing jurisdiction is configured for ${company.name} in ${month}.`);
		const rules = version.work_rules;
		const cutoffDay = company.pay_cutoff_day;
		const restRule = rules?.limits.find(isRestLimit);
		const patterns = patternRows.rows.map((row) => ({
			id: String(row.id),
			code: row.code,
			pattern: row.pattern as WorkPattern,
			effective_range: row.effective_range
		}));
		const patternById = new Map(patterns.map((row) => [row.id, row]));
		const codeById = new Map<string, RosterCodeFacts>();
		const codeKindById = new Map<string, 'WORK' | 'REST' | 'OFF'>();
		for (const code of codes) {
			const facts = rosterCodeFacts(code.variant);
			if (facts != null) codeById.set(code.id, facts);
			codeKindById.set(code.id, rosterCodeKind(code.variant));
		}
		const terms = termRows.rows.map((term) => ({
			employment_id: String(term.employment_id),
			shift_pattern_id: term.shift_pattern_id,
			effective_range: term.effective_range,
			employment_type: term.employment_type,
			work_classification: term.work_classification,
			worksite: term.worksite
		}));
		const termOn = (employmentId: string, date: string) =>
			terms.find(
				(term) => term.employment_id === employmentId && coversDate(term.effective_range, date)
			) ?? null;
		const holidays = holidayRows.rows.map((holiday) => ({
			...holiday,
			id: String(holiday.id),
			company_id: String(holiday.company_id),
			date: day(holiday.date),
			replaces: holiday.replaces == null ? null : day(holiday.replaces),
			published_at: holiday.published_at == null ? null : String(holiday.published_at)
		}));
		// A shift granting less break than the rules owe for its length, once per code the roster names.
		for (const id of new Set(
			[...fileDays.values()].flatMap((file) => (file.plan == null ? [] : [file.plan]))
		)) {
			const code = codes.find((candidate) => candidate.id === id)!;
			const window = workWindow(code.variant);
			if (window == null) continue;
			const owed = selectBreakRule(rules?.breaks ?? [], {
				consecutiveHours: window.paid_minutes / 60,
				overtimeHours: 0,
				continuousAttendance: false
			});
			if (owed?.minimum_minutes != null && owed.minimum_minutes > window.break_minutes)
				warnings.push(
					`Shift ${code.code} grants ${window.break_minutes} minutes of break, but the rules require ${owed.minimum_minutes} for a ${(window.paid_minutes / 60).toFixed(2)}-hour day.`
				);
		}
		// Each month day as the import will leave it (its total, and its plan when the file carries the roster); a stored
		// day the file leaves out is cleared.
		const planOf = new Map<string, string | null>();
		const totals = new Map<string, number>();
		const fixed = new Set<string>();
		for (const [at, file] of fileDays) {
			totals.set(at, totalByKey.get(at) ?? 0);
			if (carriesPlan) planOf.set(at, file.plan ?? null);
			if (untouched.has(at)) fixed.add(at);
		}
		for (const [at] of existingByKey)
			if (!fileDays.has(at)) {
				totals.set(at, 0);
				if (carriesPlan) planOf.set(at, null);
			}
		for (const employmentId of new Set([...fileDays.values()].map((file) => file.employmentId))) {
			const number = numberByEmployment.get(employmentId) ?? employmentId;
			const person = personContext({
				employee: null,
				employment: { service_start: '' },
				terms: termOn(employmentId, bounds.start),
				company: { region: company.region ?? null, facts: company.facts as never },
				asOf: bounds.start
			});
			const limits = applicableLimits(rules?.limits ?? [], person);
			const storedOn = new Map(
				stored
					.filter((row) => row.employment_id === employmentId)
					.map((row) => [row.work_date, row])
			);
			const explicitOn = (date: string): string | null => {
				const at = personDayKey(employmentId, date);
				return planOf.has(at) ? planOf.get(at)! : (storedOn.get(date)?.shift_definition_id ?? null);
			};
			const patternOn = (date: string) => {
				const term = termOn(employmentId, date);
				const found = term == null ? null : termPatternRow(term, patternById);
				return found == null ? null : { pattern: found.pattern, anchor: patternAnchor(found) };
			};
			const codeOn = (date: string): string | null => {
				const patterned = patternOn(date);
				return (
					explicitOn(date) ??
					(patterned == null
						? null
						: patternRosterCodeId(patterned.pattern, date, patterned.anchor))
				);
			};
			const rosteredDates = new Set(
				carriesPlan
					? monthDates.filter(
							(date) => fileDays.get(personDayKey(employmentId, date))?.plan !== undefined
						)
					: []
			);
			if (rosteredDates.size > 0) {
				// The plan's hours and spread-over against the TOTAL_WORK_HOURS and SPREAD_HOURS limits.
				const window = projectionBounds([...rosteredDates], limits);
				const planByDate = new Map<string, SchedulePlanDay>();
				if (window != null)
					for (let date = window.start; date <= window.end; date = addDays(date, 1))
						planByDate.set(date, plannedDay({ date, rosterCodeId: codeOn(date), codeById }));
				for (const breach of projectedLimitBreaches({
					subject: number,
					changedDates: rosteredDates,
					planByDate,
					limits,
					authority: rules?.authority ?? null
				}))
					warnings.push(`${number}: ${breach.sentence}.`);
				// The weekly rest rule, over a run that may start or end in the neighbouring month.
				if (restRule != null) {
					const suspending = new Set(restRule.suspended_by_leave ?? []);
					const suspendedDates = new Set(
						monthDates.filter((date) =>
							leaveRows.rows.some(
								(request) =>
									String(request.employment_id) === employmentId &&
									suspending.has(request.leave_code) &&
									leaveCoverage(
										{
											...request,
											from_date: day(request.from_date),
											to_date: day(request.to_date)
										},
										date
									).fullDay
							)
						)
					);
					const averageWhen = (restRule.average?.when ?? '').trim();
					const plannedByDate = new Map<string, string | null>();
					for (let date = restWindow.start; date <= restWindow.end; date = addDays(date, 1))
						plannedByDate.set(date, explicitOn(date));
					for (const run of restRunBreaches({
						employeeNumber: number,
						rule: restRule,
						authority: null,
						window: restWindow,
						plannedByDate,
						changedDates: rosteredDates,
						terms: terms.filter((term) => term.employment_id === employmentId),
						patternById,
						codeKindById,
						suspendedDates,
						averaging: averageWhen === '' || isEligible(averageWhen, person)
					}))
						warnings.push(
							`${number}: ${run.start} to ${run.end} is ${run.length} consecutive worked days with no rest day; the rules allow ${restRule.max_days}${restRule.authority ? ` (${restRule.authority})` : ''}.`
						);
				}
			}
			if (!monthDates.some((date) => (totals.get(personDayKey(employmentId, date)) ?? 0) > 0))
				continue;
			// The Overtime sheet's totals, split: the hours within every limit are approved overtime, the rest incentive.
			const windows = [
				projectionBounds(monthDates, limits),
				assessmentWindow(bounds.start, cutoffDay),
				assessmentWindow(bounds.end, cutoffDay)
			].flatMap((window) => (window == null ? [] : [window]));
			const start = windows.map((window) => window.start).toSorted()[0]!;
			const end = windows
				.map((window) => window.end)
				.toSorted()
				.at(-1)!;
			const dates: string[] = [];
			for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
			const rosterPeriods = rosterRows.rows
				.filter((row) => String(row.employment_id) === employmentId && row.period !== month)
				.map((row) => row.period);
			const rosteredMonth = carriesPlan
				? [...fileDays.values()].some(
						(file) => file.employmentId === employmentId && file.plan !== undefined
					)
				: rosterRows.rows.some(
						(row) => String(row.employment_id) === employmentId && row.period === month
					);
			const observed = observedDays({
				dates,
				cutoffDay,
				companyId: String(companyId),
				holidays: holidays as never,
				codes: codes as never,
				work: rules,
				plans: dates.map((date) => ({ work_date: date, shift_definition_id: explicitOn(date) })),
				rosterPeriods: rosteredMonth ? [...rosterPeriods, month] : rosterPeriods,
				patternOn,
				worksiteOn: (date) => termOn(employmentId, date)?.worksite
			});
			const split = splitPlannedOvertime({
				days: dates.map((date) => {
					const at = personDayKey(employmentId, date);
					const inMonth = date >= bounds.start && date <= bounds.end;
					const row = storedOn.get(date);
					return {
						...observedPlan(plannedDay({ date, rosterCodeId: codeOn(date), codeById }), observed),
						emergency: row?.emergency_cause === true,
						total_overtime_hours: inMonth
							? (totals.get(at) ?? 0)
							: (row?.approved_overtime_hours ?? 0) + (row?.incentive_hours ?? 0),
						...(!inMonth || fixed.has(at)
							? { fixed_overtime_hours: row?.approved_overtime_hours ?? 0 }
							: {})
					};
				}),
				limits,
				cutoffDay,
				unitHours: rules?.overtime_unit_hours
			});
			const beyond: string[] = [];
			for (const date of monthDates) {
				const at = personDayKey(employmentId, date);
				const file = fileDays.get(at);
				const result = split.get(date);
				if (file === undefined || !totalByKey.has(at) || result == null) continue;
				if (result.incentive_hours > 0 && !fixed.has(at))
					beyond.push(`${date} (${result.incentive_hours} h)`);
				// Where the rules keep no incentive hours, the whole total stays approved overtime, over the limit.
				file.approved =
					rules?.incentive_hours_allowed === false
						? { approved_overtime_hours: totalByKey.get(at)!, incentive_hours: 0 }
						: result;
			}
			if (beyond.length > 0)
				warnings.push(
					`${number}: overtime above the statutory limits on ${someDates(beyond)}${
						rules?.incentive_hours_allowed === false
							? ' is recorded as approved overtime, since these rules keep no incentive hours'
							: ' is recorded as incentive hours'
					}.`
				);
		}
	}

	// ── the set, as one act ──
	const halvesOf = (
		file: FileDay | undefined,
		storedFacts: Readonly<Record<string, unknown>> = {}
	): Halves => ({
		...(carriesPlan ? { shift_definition_id: file?.plan ?? null } : {}),
		...(carriesClock ? { worked_intervals: file?.clock ?? null } : {}),
		...(carriesOvertime
			? {
					approved_overtime_hours: file?.approved?.approved_overtime_hours ?? 0,
					incentive_hours: file?.approved?.incentive_hours ?? 0,
					overtime_consented_at: file?.consent ?? null,
					...(importKeys.length === 0
						? {}
						: {
								facts: {
									...Object.fromEntries(
										Object.entries(storedFacts).filter(([key]) => !importKeys.includes(key))
									),
									...file?.facts
								}
							})
				}
			: {})
	});
	const creates = [...fileDays.entries()]
		.filter(([at]) => !existingByKey.has(at))
		.map(([, file]) => file)
		.toSorted(
			(left, right) =>
				left.employmentId.localeCompare(right.employmentId) ||
				left.workDate.localeCompare(right.workDate)
		);
	// a new day is created whole (its plan, clock and overtime with it); a stored one is updated in place
	if (creates.length > 0)
		await ctx.act(
			'work_days.create',
			creates.map((file) => ({
				employment_id: file.employmentId as Id<'employments'>,
				work_date: PlainDate(file.workDate),
				...halvesOf(file)
			})) as never
		);
	// A stored day the file does not name keeps only the halves the file does not carry; one left with nothing is removed.
	const emptied = [...existingByKey].filter(
		([at, row]) =>
			!fileDays.has(at) &&
			!row.absence_decision_recorded &&
			(carriesPlan || row.shift_definition_id == null) &&
			(carriesClock || row.worked_intervals == null) &&
			(carriesOvertime || row.approved_overtime_hours + row.incentive_hours === 0)
	);
	const removedKeys = new Set(emptied.map(([at]) => at));
	// Every other stored day is restated from the file, and written only when that changes it: the import is the month of
	// record, so an in-app edit the file does not repeat is overwritten, and reported by name rather than silently.
	const updates = [...existingByKey]
		.filter(([at]) => !untouched.has(at) && !removedKeys.has(at))
		.map(([at, row]) => ({ row, set: halvesOf(fileDays.get(at), row.facts) }))
		.filter(
			({ row, set }) =>
				(set.shift_definition_id !== undefined &&
					set.shift_definition_id !== row.shift_definition_id) ||
				(set.worked_intervals !== undefined &&
					!sameIntervals(set.worked_intervals, row.worked_intervals)) ||
				(set.approved_overtime_hours !== undefined &&
					(set.approved_overtime_hours !== row.approved_overtime_hours ||
						set.incentive_hours !== row.incentive_hours ||
						set.overtime_consented_at !== row.overtime_consented_at ||
						(set.facts !== undefined && !sameFacts(set.facts, row.facts))))
		);
	if (updates.length > 0)
		await ctx.act(
			'work_days.update',
			updates.map(({ row, set }) => ({ target: row.id, set })) as never
		);
	if (emptied.length > 0)
		await ctx.act('work_days.delete', { target: emptied.map(([, row]) => row.id) });

	// ── rosters of record: one per person the Roster sheet names; gone for those it drops ──
	if (carriesPlan) {
		const wantedRosters = new Set(
			[...fileDays.values()]
				.filter((file) => file.plan !== undefined)
				.map((file) => file.employmentId)
		);
		const monthRosters = rosterRows.rows.filter((row) => row.period === month);
		const present = new Set(monthRosters.map((row) => String(row.employment_id)));
		const add = [...wantedRosters].filter((employmentId) => !present.has(employmentId));
		if (add.length > 0)
			await ctx.act(
				'rosters.create',
				add.map((employmentId) => ({
					employment_id: employmentId as Id<'employments'>,
					period: month
				}))
			);
		const dropped = monthRosters
			.filter((row) => !wantedRosters.has(String(row.employment_id)))
			.map((row) => row.id);
		if (dropped.length > 0) await ctx.act('rosters.delete', { target: dropped });
	}
	return {
		days: fileDays.size,
		created: creates.length,
		updated: updates.length,
		removed: emptied.length,
		/** The stored days this import changed or removed, `EMP on YYYY-MM-DD`: what a re-import reverted. */
		overwritten: [...updates.map(({ row }) => row), ...emptied.map(([, row]) => row)]
			.map(
				(row) =>
					`${numberByEmployment.get(row.employment_id) ?? row.employment_id} on ${row.work_date}`
			)
			.toSorted(),
		/** What the file breaches and was written anyway: blank roster days and the statutory limits it passes. */
		warnings
	};
}
