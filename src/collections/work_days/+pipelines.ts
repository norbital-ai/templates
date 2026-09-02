/**
 * The `work_days` import: one pipeline, two sheets, one row per person-day.
 *
 * ## Why one pipeline and not two
 *
 * A collection has exactly one `import` — the runtime dispatches an import by the collection its
 * records name, and `CollectionPipelines` declares `import` as a single optional member. So the two
 * workbooks that used to be two collections' imports are two ARMS of one input union here, tagged
 * by `sheet`, each handled by its own function below. They are genuinely different inputs: the
 * roster sheet needs the drafted month it attaches to, the attendance sheet needs the zone its
 * clock cells are in, and neither fact means anything to the other sheet.
 *
 * ## Why a row is upserted and not inserted
 *
 * `work_days` is unique on `(employment_id, work_date)`. That is the merge's central claim — one
 * person-day is one row — and it turns what used to be a refusal into an ordinary write: a punch
 * imported onto a day that is already rostered is an UPDATE of `worked_intervals`, not a second
 * row, and a roster imported onto a day somebody already punched is an UPDATE of the plan.
 *
 * An import pipeline returns mutation rows: no `id` creates, while a stored `id` updates through the
 * same platform mutation path. The pipeline therefore returns both halves together and performs no
 * template-side writes. The count shown to the operator is the person-days the file stated, whether
 * each one created a row or filled the other half of an existing row.
 *
 * Each arm still updates only its own half of the row. The roster arm never touches the clock and
 * the attendance arm never touches the plan, which is the same boundary
 * `WORK_DAY_PLANNED_FIELDS` / `WORK_DAY_ATTENDANCE_FIELDS` draw in `src/lib/policy_grants.ts`.
 */

import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate, isClockTime, isUtcIsoInstant } from '@norbital-ai/std/date';
import { decodeNumber } from '@norbital-ai/std/json';

import { Array, Effect, Result, Schema } from 'effect';
import { dateKey } from '../../lib/iso-day.js';
import { formatNamedList, monthBounds } from '../../lib/period.js';
import { leaveCoverage } from '../../lib/scheduling/leave-coverage.js';
import { payrollWindows, assertNotSettled } from '../../lib/scheduling/lock.js';
import { rosterCodeVariantSchema } from '../../datatypes/roster_code_variant/+definition.js';
import { coversDate } from '../payroll_runs/lib/effective.js';
import { personDayMutations } from './lib/person-day-mutations.js';
import type { Api, Pipelines, WorkspaceRow } from './$types.js';

const QUERY_LIMIT = 20_000;
const PH_TOKENS = new Set(['PH', 'PUBLIC_HOLIDAY']);

type CompanyIdentity = Pick<WorkspaceRow<'companies'>, 'id' | 'name' | 'registration_number'>;

/**
 * Resolve one `legal_entity` cell to its company row, or refuse.
 *
 * The cell may name a company by display name or by registration number. Both sheets ask the same
 * question of the same `Settings` sheet; it used to be exported from the time-entries pipeline and
 * imported by the roster one across a collection boundary, which is a boundary that no longer
 * exists.
 */
function resolveLegalEntity(
	companies: readonly CompanyIdentity[],
	legalEntity: string
): CompanyIdentity {
	const wanted = legalEntity.trim().toLowerCase();
	const matches = companies.filter(
		(company) =>
			company.name.trim().toLowerCase() === wanted ||
			company.registration_number.trim().toLowerCase() === wanted
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
	shift_code: trimmedNonEmpty,
	assignment_code: Schema.optional(trimmedNonEmpty),
	planned_note: Schema.optional(Schema.String)
});
type RosterRow = Schema.Schema.Type<typeof rosterRowSchema>;

const attendanceRowSchema = Schema.Struct({
	employee_number: trimmedNonEmpty,
	work_date: trimmedNonEmpty,
	clock_in: trimmedNonEmpty,
	clock_out: Schema.optional(trimmedNonEmpty),
	break_minutes: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
});
type AttendanceRow = Schema.Schema.Type<typeof attendanceRowSchema>;

const rosterImportSchema = Schema.Struct({
	sheet: Schema.Literal('ROSTER'),
	roster_id: trimmedNonEmpty,
	legal_entity: Schema.optional(trimmedNonEmpty),
	month: Schema.optional(trimmedNonEmpty),
	rows: Schema.Array(rosterRowSchema)
});
type RosterImport = Schema.Schema.Type<typeof rosterImportSchema>;

const attendanceImportSchema = Schema.Struct({
	sheet: Schema.Literal('ATTENDANCE'),
	timezone: trimmedNonEmpty,
	legal_entity: Schema.optional(trimmedNonEmpty),
	month: Schema.optional(trimmedNonEmpty),
	rows: Schema.Array(attendanceRowSchema).check(Schema.isMinLength(1))
});
type AttendanceImport = Schema.Schema.Type<typeof attendanceImportSchema>;

const importSchema = Schema.Union([rosterImportSchema, attendanceImportSchema]);

/** One stored person-day, reduced to what an import has to decide about it. */
type ExistingDay = {
	readonly id: string;
	readonly planned: boolean;
	readonly attended: boolean;
};

function personDayKey(employmentId: string, workDate: string): string {
	return `${employmentId}\t${workDate}`;
}

/**
 * The person-days this file touches that already exist, keyed the way the unique index keys them.
 *
 * One read for the whole file. Both halves of the row are read because both arms need to know
 * which side is already occupied: the roster arm to tell a re-import from attendance that arrived
 * first, the attendance arm to refuse overwriting punches somebody already recorded.
 */
function readExistingDays(
	api: Api,
	employmentIds: readonly string[],
	workDates: readonly string[]
): Effect.Effect<ReadonlyMap<string, ExistingDay>, never, never> {
	if (employmentIds.length === 0 || workDates.length === 0) {
		return Effect.succeed(new Map<string, ExistingDay>());
	}
	return Effect.map(
		api.db.work_days.findMany({
			where: { employment_id: { in: employmentIds }, work_date: { in: workDates } },
			columns: {
				id: true,
				employment_id: true,
				work_date: true,
				shift_definition_id: true,
				worked_intervals: true
			},
			limit: QUERY_LIMIT
		}),
		(days) =>
			new Map(
				days.map((day) => [
					personDayKey(day.employment_id, dateKey(day.work_date)),
					{
						id: day.id,
						planned: day.shift_definition_id != null,
						attended: day.worked_intervals != null
					}
				])
			)
	);
}

// ── the roster sheet ───────────────────────────────────────────────────────────────────────────

function dateInMonth(date: string, month: string): boolean {
	const bounds = monthBounds(month);
	return date >= bounds.start && date <= bounds.end;
}

function formatRosterRows(rows: readonly RosterRow[]): string[] {
	return rows.map((row) => `${row.employee_number} on ${row.work_date}`);
}

function importRosterMonth(payload: RosterImport, api: Api) {
	return Effect.gen(function* () {
		const { roster_id: rosterId, legal_entity: legalEntity, month: fileMonth, rows } = payload;
		const roster = yield* api.db.rosters.findFirst({
			where: { id: { eq: rosterId } },
			columns: { month: true, published_at: true, company_id: true }
		});
		if (roster == null) refuse('Create the draft monthly roster before importing it.');
		if (roster.published_at != null) {
			refuse(`Roster ${roster.month} is published. Re-open it before importing changes.`);
		}
		if (fileMonth != null && fileMonth !== roster.month) {
			refuse(
				`This workbook is for ${fileMonth}, but the open draft is ${roster.month}. Import it into that month's roster.`
			);
		}
		if (legalEntity != null) {
			const companies = yield* api.db.companies.findMany({
				columns: { id: true, name: true, registration_number: true },
				limit: QUERY_LIMIT
			});
			const company = resolveLegalEntity(companies, legalEntity);
			if (company.id !== roster.company_id) {
				refuse(
					`This workbook is for ${company.name}, which is not the legal entity of roster ${roster.month}.`
				);
			}
		}

		const invalidDates = rows.filter((row) => !isCalendarDate(row.work_date));
		if (invalidDates.length > 0) {
			refuse(
				`These rows do not use valid YYYY-MM-DD dates:\n${formatNamedList(formatRosterRows(invalidDates))}`
			);
		}
		const outsideMonth = rows.filter((row) => !dateInMonth(row.work_date, roster.month));
		if (outsideMonth.length > 0) {
			refuse(
				`These rows do not belong to roster ${roster.month}:\n${formatNamedList(formatRosterRows(outsideMonth))}`
			);
		}
		const seen = new Set<string>();
		const duplicates: string[] = [];
		for (const row of rows) {
			const key = personDayKey(row.employee_number, row.work_date);
			if (seen.has(key)) duplicates.push(`${row.employee_number} on ${row.work_date}`);
			seen.add(key);
		}
		if (duplicates.length > 0) {
			refuse(`The import repeats person-days:\n${formatNamedList(duplicates)}`);
		}

		const employeeNumbers = [...new Set(rows.map((row) => row.employee_number))];
		const employments = yield* api.db.employments.findMany({
			where: {
				company_id: { eq: roster.company_id },
				employee_number: { in: employeeNumbers }
			},
			columns: { id: true, employee_number: true },
			limit: QUERY_LIMIT
		});
		const employmentByNumber = new Map(
			employments.map((employment) => [employment.employee_number, employment.id])
		);
		const unknownEmployees = employeeNumbers.filter((number) => !employmentByNumber.has(number));
		if (unknownEmployees.length > 0) {
			refuse(
				`These employee numbers are not employed by this legal entity:\n${formatNamedList(unknownEmployees)}`
			);
		}

		const [holidayRows, assignments] = Array.partition(rows, (row) =>
			PH_TOKENS.has(row.shift_code.toUpperCase()) ? Result.fail(row) : Result.succeed(row)
		);
		if (holidayRows.length > 0) {
			const dates = [...new Set(holidayRows.map((row) => row.work_date))];
			const holidays = yield* api.db.company_holidays.findMany({
				where: { company_id: { eq: roster.company_id }, date: { in: dates } },
				columns: { date: true },
				limit: QUERY_LIMIT
			});
			const configured = new Set(holidays.map((holiday) => dateKey(holiday.date)));
			const unknown = holidayRows.filter((row) => !configured.has(row.work_date));
			if (unknown.length > 0) {
				refuse(
					`These PH rows are not observed holidays for the legal entity:\n${formatNamedList(formatRosterRows(unknown))}\nConfigure the holiday calendar first.`
				);
			}
		}

		const codes = [...new Set(assignments.map((row) => row.shift_code))];
		const rosterCodes = yield* api.db.shift_definitions.findMany({
			where: { company_id: { eq: roster.company_id }, code: { in: codes } },
			columns: { id: true, code: true, variant: true, effective_range: true },
			limit: QUERY_LIMIT
		});
		const codeByName = new Map(rosterCodes.map((code) => [code.code, code]));
		const unknownCodes = codes.filter((code) => !codeByName.has(code));
		if (unknownCodes.length > 0) {
			refuse(
				`These roster codes are not defined for this legal entity:\n${formatNamedList(unknownCodes)}`
			);
		}
		const ineffective = assignments.filter((row) => {
			const code = codeByName.get(row.shift_code);
			return code == null || !coversDate(code.effective_range, row.work_date);
		});
		if (ineffective.length > 0) {
			refuse(
				`These roster codes are not effective on the assigned date:\n${formatNamedList(formatRosterRows(ineffective))}`
			);
		}
		for (const code of rosterCodes) Schema.decodeUnknownSync(rosterCodeVariantSchema)(code.variant);

		const employmentId = (number: string): string => {
			const id = employmentByNumber.get(number);
			if (id == null) refuse(`No employment resolved for ${number}.`);
			return id;
		};
		const employmentIds = [...new Set(assignments.map((row) => employmentId(row.employee_number)))];
		const workDates = [...new Set(assignments.map((row) => row.work_date))];
		const existing = yield* readExistingDays(api, employmentIds, workDates);

		/**
		 * A day that already carries a PLAN is the conflict. A day that exists only because
		 * attendance was imported first is not one — that is the merge working, and the plan lands
		 * on the row the punch already made.
		 */
		const alreadyAssigned = assignments.filter(
			(row) => existing.get(personDayKey(employmentId(row.employee_number), row.work_date))?.planned
		);
		if (alreadyAssigned.length > 0) {
			refuse(
				`These days already have an explicit assignment:\n${formatNamedList(formatRosterRows(alreadyAssigned))}`
			);
		}

		const runs = yield* api.db.payroll_runs.findMany({
			where: { company_id: { eq: roster.company_id } },
			columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
			limit: QUERY_LIMIT
		});
		const windows = payrollWindows(runs);
		for (const row of assignments) assertNotSettled(windows, row.work_date, 'Importing roster');

		// Every column the sheet is read for is written. `planned_origin` is `IMPORT` because that is
		// what these rows are — the board writes `MANUAL`, and leaving provenance unset would have
		// made a whole imported month indistinguishable from an operator's ad hoc edits. The note is
		// an optional column of the long-form sheet, so a file that carries one carries it through
		// rather than having it read and discarded.
		return personDayMutations(
			existing,
			assignments.map((row) => {
				const code = codeByName.get(row.shift_code);
				if (code == null) refuse(`No roster code resolved for ${row.shift_code}.`);
				return {
					employment_id: employmentId(row.employee_number),
					work_date: row.work_date,
					values: {
						shift_definition_id: code.id,
						roster_id: rosterId,
						assignment_code: row.assignment_code ?? null,
						planned_origin: 'IMPORT' as const,
						planned_note: row.planned_note ?? null
					}
				};
			}),
			personDayKey
		);
	});
}

// ── the attendance sheet ───────────────────────────────────────────────────────────────────────

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

function clockMinutes(value: string): number {
	const [hours, minutes] = value.split(':').map(Number) as [number, number];
	return hours * 60 + minutes;
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

/** The clock half of a person-day: the intervals worked and the unpaid break, and nothing else. */
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
	return {
		worked_intervals: [{ start, end }],
		break_minutes: row.break_minutes ?? 0
	};
}

function importAttendanceMonth(payload: AttendanceImport, api: Api) {
	return Effect.gen(function* () {
		const { timezone, legal_entity: legalEntity, month: fileMonth, rows } = payload;
		yield* assertValidTimeZone(timezone);

		if (fileMonth != null) {
			const bounds = monthBounds(fileMonth);
			const outsideMonth = [
				...new Set(
					rows
						.filter((row) => row.work_date < bounds.start || row.work_date > bounds.end)
						.map((row) => `${row.employee_number} on ${row.work_date}`)
				)
			];
			if (outsideMonth.length > 0) {
				refuse(`These rows do not belong to ${fileMonth}:\n${formatNamedList(outsideMonth)}`);
			}
		}

		let companyId: string | undefined;
		if (legalEntity != null) {
			const companies = yield* api.db.companies.findMany({
				columns: { id: true, name: true, registration_number: true },
				limit: QUERY_LIMIT
			});
			companyId = resolveLegalEntity(companies, legalEntity).id;
		}

		const invalidDates = [
			...new Set(rows.filter((row) => !isCalendarDate(row.work_date)).map((row) => row.work_date))
		];
		if (invalidDates.length > 0) {
			refuse(
				`These work_date values are not valid calendar days (YYYY-MM-DD):\n${formatNamedList(invalidDates)}`
			);
		}
		const invalidClocks = rows.flatMap((row): string[] => {
			const checks = [
				['clock_in', row.clock_in],
				['clock_out', row.clock_out]
			] as const;
			return checks.flatMap(([field, value]) =>
				value == null || isClockTime(value)
					? []
					: [`${row.employee_number} on ${row.work_date}: ${field} "${value}"`]
			);
		});
		if (invalidClocks.length > 0) {
			refuse(
				`These clock fields are not valid local times (HH:mm):\n${formatNamedList(invalidClocks)}`
			);
		}

		// The file cannot state one person-day twice: `unique(employment_id, work_date)` says a
		// person-day is one row, so two cells claiming the same day have no defined resolution and
		// the second would silently overwrite the first.
		const seen = new Set<string>();
		const repeated: string[] = [];
		for (const row of rows) {
			const key = personDayKey(row.employee_number, row.work_date);
			if (seen.has(key)) repeated.push(`${row.employee_number} on ${row.work_date}`);
			seen.add(key);
		}
		if (repeated.length > 0) {
			refuse(
				`The import repeats the same employee and day:\n${formatNamedList(repeated)}\nPut every interval of one day in that day's single cell.`
			);
		}

		const employeeNumbers = [...new Set(rows.map((row) => row.employee_number))];
		const employments = yield* api.db.employments.findMany({
			where: {
				employee_number: { in: employeeNumbers },
				...(companyId == null ? {} : { company_id: { eq: companyId } })
			},
			columns: { id: true, employee_number: true, company_id: true },
			limit: QUERY_LIMIT
		});
		const idsByNumber = new Map<string, string[]>();
		for (const employment of employments) {
			const ids = idsByNumber.get(employment.employee_number) ?? [];
			ids.push(employment.id);
			idsByNumber.set(employment.employee_number, ids);
		}
		const ambiguous = employeeNumbers.filter(
			(number) => (idsByNumber.get(number)?.length ?? 0) > 1
		);
		if (ambiguous.length > 0) {
			refuse(
				`These employee numbers exist in more than one company:\n${formatNamedList(ambiguous)}\nSet legal_entity on the Settings sheet to the employing entity this file is for.`
			);
		}
		const idByNumber = new Map(
			employments.map((employment) => [employment.employee_number, employment.id])
		);
		const unknown = employeeNumbers.filter((number) => !idByNumber.has(number));
		if (unknown.length > 0) {
			refuse(
				companyId == null
					? `These employee numbers are not on file:\n${formatNamedList(unknown)}`
					: `These employee numbers are not employed by this legal entity:\n${formatNamedList(unknown)}`
			);
		}
		const employmentIdFor = (number: string): string => {
			const id = idByNumber.get(number);
			if (id == null) refuse(`No employment resolved for ${number}.`);
			return id;
		};

		const employmentIds = [...new Set(rows.map((row) => employmentIdFor(row.employee_number)))];
		const workDates = [...new Set(rows.map((row) => row.work_date))].toSorted();
		const existing = yield* readExistingDays(api, employmentIds, workDates);

		/**
		 * A rostered day is not a conflict — the punch lands on the row the plan already made. A day
		 * that already carries ATTENDANCE is: `worked_intervals` non-NULL is somebody's recorded
		 * answer about that day, and an import silently replacing it would lose it.
		 */
		const present = rows
			.filter(
				(row) =>
					existing.get(personDayKey(employmentIdFor(row.employee_number), row.work_date))?.attended
			)
			.map((row) => `${row.employee_number} on ${row.work_date}`);
		if (present.length > 0) {
			refuse(
				`These days already have attendance:\n${formatNamedList(present)}\nUpdate the existing day instead of importing a duplicate.`
			);
		}

		// One writer wins the day even on import: attendance cannot be loaded onto a day approved
		// leave already owns, or onto a day a paid payroll run settled.
		const first = workDates[0]!;
		const last = workDates.at(-1)!;
		const companyIds = [...new Set(employments.map((employment) => employment.company_id))];
		if (companyIds.length > 0) {
			const runs = yield* api.db.payroll_runs.findMany({
				where: { company_id: { in: companyIds } },
				columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
				limit: QUERY_LIMIT
			});
			const windows = payrollWindows(runs);
			for (const row of rows) assertNotSettled(windows, row.work_date, 'Importing attendance');
		}
		const leaveRows = yield* api.db.leave_requests.findMany({
			where: {
				employment_id: { in: employmentIds },
				kind: { eq: 'TIME_OFF' },
				approval_id: { isNull: true },
				from_date: { lte: last },
				to_date: { gte: first }
			},
			columns: {
				employment_id: true,
				from_date: true,
				to_date: true,
				half_day_start: true,
				half_day_end: true
			},
			limit: QUERY_LIMIT
		});
		for (const row of rows) {
			const employmentId = employmentIdFor(row.employee_number);
			const covering = leaveRows
				.filter((request) => request.employment_id === employmentId)
				.find((request) => leaveCoverage(request, row.work_date).fullDay);
			if (covering != null) {
				refuse(
					`${row.employee_number} on ${row.work_date} is covered by approved leave ` +
						`${dateKey(covering.from_date)} → ${dateKey(covering.to_date)}. Attendance on a ` +
						'leave day is not recorded; amend or cancel that leave first.'
				);
			}
		}

		return personDayMutations(
			existing,
			rows.map((row) => ({
				employment_id: employmentIdFor(row.employee_number),
				work_date: row.work_date,
				values: attendanceValues(row, timezone)
			})),
			personDayKey
		);
	});
}

export default {
	import: {
		description:
			'Loads one month of person-days for one legal entity, from either sheet of the scheduling workbook: the Roster sheet loads planned roster-code assignments, and the Time entries sheet loads local attendance punches as generic worked intervals. A day already held by the other sheet is updated rather than duplicated. The import never labels or stores overtime; payroll derives it from actual intervals and the schedule.',
		input: importSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const payload = Schema.decodeUnknownSync(importSchema)(input);
				if (payload.sheet === 'ROSTER') return yield* importRosterMonth(payload, api);
				return yield* importAttendanceMonth(payload, api);
			})
	}
} satisfies Pipelines;
