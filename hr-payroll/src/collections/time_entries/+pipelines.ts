import { isCalendarDate, isClockTime, isUtcIsoInstant } from '@norbital-ai/std/date';
import { z } from 'zod';
import { formatNamedList } from '../../lib/period.js';
import type { Pipelines } from './$types.js';

const rowSchema = z.object({
	employee_number: z.string().trim().min(1),
	work_date: z.string().trim().min(1),
	clock_in: z.string().trim().min(1),
	clock_out: z.string().trim().optional(),
	break_minutes: z.number().int().nonnegative().optional(),
	/** Informational provenance only; leave and overtime are both derived elsewhere. */
	reason: z.string().optional()
});

const importSchema = z.object({
	timezone: z.string().trim().min(1),
	rows: z.array(rowSchema).min(1)
});

const QUERY_LIMIT = 20_000;
type ImportRow = z.infer<typeof rowSchema>;

function addDays(date: string, days: number): string {
	return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
		.toISOString()
		.slice(0, 10);
}

function dateKey(value: string | Date): string {
	return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function assertValidTimeZone(timeZone: string): void {
	try {
		Intl.DateTimeFormat(undefined, { timeZone });
	} catch {
		throw new Error(
			`"${timeZone}" is not a recognized IANA timezone. Use a place such as Asia/Kuala_Lumpur, not a fixed UTC offset.`
		);
	}
}

function clockMinutes(value: string): number {
	const [hours, minutes] = value.split(':').map(Number) as [number, number];
	return hours * 60 + minutes;
}

/** An equal or earlier wall-clock close is the following calendar day. */
function endCalendarDate(workDate: string, started: string, ended: string): string {
	return clockMinutes(ended) <= clockMinutes(started) ? addDays(workDate, 1) : workDate;
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
		throw new Error(
			`Could not resolve ${calendarDate} ${clockTime} in ${timeZone}. The local time may fall in a daylight-saving gap.`
		);
	}
	const iso = new Date(resolved).toISOString();
	if (!isUtcIsoInstant(iso)) throw new Error(`Could not resolve ${calendarDate} ${clockTime}.`);
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
		worked_intervals: [{ start_at: start, end_at: end }],
		break_minutes: row.break_minutes ?? 0
	};
}

export default {
	import: {
		description:
			'Loads local attendance punches as generic worked intervals. The import never labels or stores overtime; payroll derives it from actual intervals and the schedule.',
		input: importSchema,
		handler: async ({ input }, api) => {
			const { timezone, rows } = importSchema.parse(input);
			assertValidTimeZone(timezone);

			const invalidDates = [
				...new Set(rows.filter((row) => !isCalendarDate(row.work_date)).map((row) => row.work_date))
			];
			if (invalidDates.length > 0) {
				throw new Error(
					`These work_date values are not valid calendar days (YYYY-MM-DD):\n${formatNamedList(invalidDates)}`
				);
			}
			const invalidClocks = rows.flatMap((row) =>
				[
					['clock_in', row.clock_in],
					['clock_out', row.clock_out]
				]
					.filter((pair): pair is [string, string] => pair[1] != null && !isClockTime(pair[1]))
					.map(
						([field, value]) => `${row.employee_number} on ${row.work_date}: ${field} "${value}"`
					)
			);
			if (invalidClocks.length > 0) {
				throw new Error(
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
				throw new Error(
					`The import repeats the same employee and day:\n${formatNamedList(repeated)}\nKeep one row per person per operational day; use multiple worked intervals inside that entry when needed.`
				);
			}

			const employeeNumbers = [...new Set(rows.map((row) => row.employee_number))];
			const employments = await api.db.query.employments.findMany({
				where: { employee_number: { in: employeeNumbers } },
				columns: { norbital_id: true, employee_number: true },
				limit: QUERY_LIMIT
			});
			const idsByNumber = new Map<string, string[]>();
			for (const employment of employments) {
				const ids = idsByNumber.get(employment.employee_number) ?? [];
				ids.push(employment.norbital_id);
				idsByNumber.set(employment.employee_number, ids);
			}
			const ambiguous = employeeNumbers.filter(
				(number) => (idsByNumber.get(number)?.length ?? 0) > 1
			);
			if (ambiguous.length > 0) {
				throw new Error(
					`These employee numbers exist in more than one company:\n${formatNamedList(ambiguous)}\nImport them within a company-scoped roster workbook.`
				);
			}
			const idByNumber = new Map(
				employments.map((employment) => [employment.employee_number, employment.norbital_id])
			);
			const unknown = employeeNumbers.filter((number) => !idByNumber.has(number));
			if (unknown.length > 0) {
				throw new Error(`These employee numbers are not on file:\n${formatNamedList(unknown)}`);
			}
			const employmentIdFor = (number: string): string => {
				const id = idByNumber.get(number);
				if (id == null) throw new Error(`No employment resolved for ${number}.`);
				return id;
			};

			const existing = await api.db.query.time_entries.findMany({
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
				throw new Error(
					`These days already have attendance:\n${formatNamedList(present)}\nUpdate the existing entry instead of importing a duplicate.`
				);
			}

			return rows.map((row) => createPayload(row, timezone, employmentIdFor(row.employee_number)));
		}
	}
} satisfies Pipelines;
