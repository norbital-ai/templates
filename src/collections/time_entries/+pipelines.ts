import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate, isClockTime, isUtcIsoInstant } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { dateKey } from '../../lib/iso-day.js';
import { formatNamedList, monthBounds } from '../../lib/period.js';
import { leaveCoverage } from '../../lib/scheduling/leave-coverage.js';
import { payrollWindows, assertNotSettled } from '../../lib/scheduling/lock.js';
import type { Pipelines, WorkspaceRow } from './$types.js';

type CompanyIdentity = Pick<WorkspaceRow<'companies'>, 'id' | 'name' | 'registration_number'>;

/**
 * Resolve one `legal_entity` cell to its company row, or refuse.
 *
 * The cell may name a company by display name or by registration number. Shared by the time-entries
 * and roster-entry imports, which ask the same question of the same Settings sheet.
 */
export function resolveLegalEntity(
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

const rowSchema = Schema.Struct({
	employee_number: trimmedNonEmpty,
	work_date: trimmedNonEmpty,
	clock_in: trimmedNonEmpty,
	clock_out: Schema.optional(trimmedNonEmpty),
	break_minutes: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
});

const importSchema = Schema.Struct({
	timezone: trimmedNonEmpty,
	legal_entity: Schema.optional(trimmedNonEmpty),
	month: Schema.optional(trimmedNonEmpty),
	rows: Schema.Array(rowSchema).check(Schema.isMinLength(1))
});

const QUERY_LIMIT = 20_000;
type ImportRow = Schema.Schema.Type<typeof rowSchema>;

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
		let shownHour = Number(part('hour'));
		if (shownHour === 24) shownHour = 0;
		return Date.UTC(
			Number(part('year')),
			Number(part('month')) - 1,
			Number(part('day')),
			shownHour,
			Number(part('minute')),
			Number(part('second'))
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

function createPayload(row: ImportRow, timeZone: string, employmentId: string) {
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
		employment_id: employmentId,
		work_date: row.work_date,
		worked_intervals: [{ start: start, end: end }],
		break_minutes: row.break_minutes ?? 0
	};
}

export default {
	import: {
		description:
			'Loads a month of local attendance punches for one legal entity as generic worked intervals. The import never labels or stores overtime; payroll derives it from actual intervals and the schedule.',
		input: importSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const {
					timezone,
					legal_entity: legalEntity,
					month: fileMonth,
					rows
				} = Schema.decodeUnknownSync(importSchema)(input);
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
					const companies = yield* api.db.query.companies.findMany({
						columns: { id: true, name: true, registration_number: true },
						limit: QUERY_LIMIT
					});
					companyId = resolveLegalEntity(companies, legalEntity).id;
				}

				const invalidDates = [
					...new Set(
						rows.filter((row) => !isCalendarDate(row.work_date)).map((row) => row.work_date)
					)
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

				const seen = new Set<string>();
				const repeated: string[] = [];
				for (const row of rows) {
					const key = `${row.employee_number}\t${row.work_date}`;
					if (seen.has(key)) repeated.push(`${row.employee_number} on ${row.work_date}`);
					seen.add(key);
				}
				if (repeated.length > 0) {
					refuse(
						`The import repeats the same employee and day:\n${formatNamedList(repeated)}\nKeep one row per person per operational day; use multiple worked intervals inside that entry when needed.`
					);
				}

				const employeeNumbers = [...new Set(rows.map((row) => row.employee_number))];
				const employments = yield* api.db.query.employments.findMany({
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

				const existing = yield* api.db.query.time_entries.findMany({
					where: {
						employment_id: {
							in: [...new Set(rows.map((row) => employmentIdFor(row.employee_number)))]
						},
						work_date: { in: [...new Set(rows.map((row) => row.work_date))] }
					},
					columns: { employment_id: true, work_date: true },
					limit: QUERY_LIMIT
				});
				const existingKeys = new Set(
					existing.map((entry) => `${entry.employment_id}\t${dateKey(entry.work_date)}`)
				);
				const present = rows
					.filter((row) =>
						existingKeys.has(`${employmentIdFor(row.employee_number)}\t${row.work_date}`)
					)
					.map((row) => `${row.employee_number} on ${row.work_date}`);
				if (present.length > 0) {
					refuse(
						`These days already have attendance:\n${formatNamedList(present)}\nUpdate the existing entry instead of importing a duplicate.`
					);
				}

				// One writer wins the day even on import: attendance cannot be loaded onto a day
				// approved leave already owns, or onto a day a paid payroll run settled.
				const employmentIds = [...new Set(rows.map((row) => employmentIdFor(row.employee_number)))];
				const workDates = [...new Set(rows.map((row) => row.work_date))].toSorted();
				const first = workDates[0]!;
				const last = workDates.at(-1)!;
				const companyIds = [...new Set(employments.map((employment) => employment.company_id))];
				if (companyIds.length > 0) {
					const runs = yield* api.db.query.payroll_runs.findMany({
						where: { company_id: { in: companyIds } },
						columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
						limit: QUERY_LIMIT
					});
					const windows = payrollWindows(runs);
					for (const row of rows) assertNotSettled(windows, row.work_date, 'Importing attendance');
				}
				const leaveRows = yield* api.db.query.leave_requests.findMany({
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

				return rows.map((row) =>
					createPayload(row, timezone, employmentIdFor(row.employee_number))
				);
			})
	}
} satisfies Pipelines;
