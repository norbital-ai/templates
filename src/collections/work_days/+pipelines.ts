import { resolveEmployment } from '../../lib/employment-contract.js';
import { resolveHolidays } from '../../lib/holiday-calendar.js';
import { settingsInForce } from '../../lib/jurisdiction_settings.js';
/**
 * The `work_days` import: one pipeline, two sheets, one row per person-day.
 *
 * ## Why one pipeline and not two
 *
 * A collection has exactly one `import` — the runtime dispatches an import by the collection its
 * records name, and `CollectionPipelines` declares `import` as a single optional member. So the two
 * workbooks that used to be two collections' imports are two ARMS of one input union here, tagged
 * by `sheet`, each handled by its own function below. They are genuinely different inputs: the
 * roster sheet states the legal entity and month its assignments belong to, the attendance sheet
 * needs the zone its clock cells are in, and neither fact means anything to the other sheet.
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
import { formatNamedList, isYearMonth, monthBounds } from '../../lib/period.js';
import { leaveCoverage } from '../../lib/scheduling/leave-coverage.js';
import { payrollWindows, assertNotSettled } from '../../lib/scheduling/lock.js';
import { rosterCodeVariantSchema } from '../../datatypes/roster_code_variant/+definition.js';
import { coversDate } from '../payroll_runs/lib/effective.js';
import { assessmentSpan } from '../payroll_runs/lib/period.js';
import { personDayMutations } from './lib/person-day-mutations.js';
import type { Api, Pipelines, WorkspaceRow } from './$types.js';
import { clockMinutes } from '../../lib/scheduling/roster-code.js';

const QUERY_LIMIT = 20_000;
const PH_TOKENS = new Set(['PH', 'PUBLIC_HOLIDAY']);

type CompanyIdentity = Pick<
	WorkspaceRow<'companies'>,
	'id' | 'name' | 'registration_number' | 'settings_code'
>;

/**
 * Resolve one `legal_entity` cell to its company row, or refuse.
 *
 * The cell may name a company by display name or by registration number. Both sheets ask the same
 * question of the same `Settings` sheet; it used to be exported from the time-entries pipeline and
 * imported by the roster one across a collection boundary, which is a boundary that no longer
 * exists.
 */
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
	shift_code: trimmedNonEmpty,
	assignment_code: Schema.optional(trimmedNonEmpty)
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

const workbookImportSchema = Schema.Struct({
	sheet: Schema.Literal('WORKBOOK'),
	roster: Schema.Struct({
		legal_entity: Schema.optional(trimmedNonEmpty),
		month: Schema.optional(trimmedNonEmpty),
		rows: Schema.Array(rosterRowSchema)
	}),
	attendance: Schema.Struct({
		timezone: trimmedNonEmpty,
		legal_entity: Schema.optional(trimmedNonEmpty),
		month: Schema.optional(trimmedNonEmpty),
		rows: Schema.Array(attendanceRowSchema)
	})
});
type WorkbookImport = Schema.Schema.Type<typeof workbookImportSchema>;

const importSchema = Schema.Union([
	rosterImportSchema,
	attendanceImportSchema,
	workbookImportSchema
]);

/** One stored person-day, reduced to what an import has to decide about it. */

function personDayKey(employmentId: string, workDate: string): string {
	return `${employmentId}\t${workDate}`;
}

/** The pay grid a company's assessment span is read off. */
type PayGridCompany = Pick<WorkspaceRow<'companies'>, 'pay_frequency' | 'pay_cutoff_day'>;

/** One person-day the file states, on the half the sheet carries. */
type PeriodStateRow<Values extends object> = Readonly<{
	readonly employmentId: string;
	readonly companyId: string;
	readonly workDate: string;
	/** The employee number, for refusals. */
	readonly who: string;
	readonly values: Values;
}>;

/**
 * The file is the state of the assessment period it touches.
 *
 * A roster or attendance import is not a merge: for every company assessment span (the pay grid's
 * half-month or cutoff window) the file's dates fall in, the file becomes that span's statement of
 * record on the half the sheet carries. A person-day the file names is created or overwritten on
 * that half; one it does not name loses that half — its row is deleted when nothing else is on it,
 * and kept with the other half when there is. The other sheet's half is never touched.
 *
 * The one thing no import may rewrite is a day a payslip has taken into account; the whole file is
 * refused by run so the operator deletes that run first. A paid day is refused earlier, by the
 * window guard.
 */
function replacePeriodState<Values extends object>(
	api: Api,
	options: {
		/** Which half the file carries; `BOTH` is the whole day and keeps nothing it does not name. */
		readonly half: 'PLAN' | 'CLOCK' | 'BOTH';
		readonly companies: ReadonlyMap<string, PayGridCompany>;
		readonly rows: readonly PeriodStateRow<Values>[];
	}
) {
	return Effect.gen(function* () {
		const spansByCompany = new Map<string, Map<string, { start: string; end: string }>>();
		for (const row of options.rows) {
			const company = options.companies.get(row.companyId);
			if (company == null) refuse(`No legal entity resolved for ${row.who} on ${row.workDate}.`);
			const span = assessmentSpan(company, row.workDate);
			const spans = spansByCompany.get(row.companyId) ?? new Map();
			spans.set(span.start, span);
			spansByCompany.set(row.companyId, spans);
		}
		if (spansByCompany.size === 0) return [];
		const employments = yield* api.db.employments.findMany({
			where: { company_id: { in: [...spansByCompany.keys()] }, approval_id: { isNull: true } },
			columns: { id: true, company_id: true, employee_number: true },
			limit: QUERY_LIMIT
		});
		if (employments.length >= QUERY_LIMIT) refuse('Employment history is incomplete.');
		const employmentById = new Map(employments.map((row) => [row.id, row]));
		const allSpans = [...spansByCompany.values()].flatMap((spans) => [...spans.values()]);
		const stored = yield* api.db.work_days.findMany({
			where: {
				employment_id: { in: employments.map((row) => row.id) },
				work_date: {
					gte: allSpans.map((span) => span.start).toSorted()[0]!,
					lte: allSpans
						.map((span) => span.end)
						.toSorted()
						.at(-1)!
				},
				approval_id: { isNull: true }
			},
			columns: {
				id: true,
				employment_id: true,
				work_date: true,
				shift_definition_id: true,
				worked_intervals: true,
				payslip_id: true
			},
			limit: QUERY_LIMIT
		});
		if (stored.length >= QUERY_LIMIT) refuse('Work day history is incomplete.');
		const inSpan = stored.filter((day) => {
			const date = dateKey(day.work_date) ?? '';
			const spans = spansByCompany.get(employmentById.get(day.employment_id)?.company_id ?? '');
			return [...(spans?.values() ?? [])].some((span) => date >= span.start && date <= span.end);
		});
		const who = (day: (typeof stored)[number]) =>
			`${employmentById.get(day.employment_id)?.employee_number ?? day.employment_id} on ${dateKey(day.work_date) ?? ''}`;
		const held = inSpan.filter((day) => day.payslip_id != null).map(who);
		if (held.length > 0)
			refuse(
				`These days are already taken into account by a payroll run:\n${formatNamedList(held)}\n` +
					'Delete that run to release them, then import the period again.'
			);
		const fileKeys = new Set(
			options.rows.map((row) => personDayKey(row.employmentId, row.workDate))
		);
		const existing = new Map(
			inSpan.map((day) => [
				personDayKey(day.employment_id, dateKey(day.work_date) ?? ''),
				{ id: day.id }
			])
		);
		const clears: Array<
			| {
					id: string;
					employment_id: string;
					work_date: string;
					shift_definition_id: null;
					assignment_code: null;
					planned_origin: 'IMPORT';
			  }
			| {
					id: string;
					employment_id: string;
					work_date: string;
					worked_intervals: null;
					break_minutes: number;
			  }
		> = [];
		const deletes: string[] = [];
		for (const day of inSpan) {
			if (fileKeys.has(personDayKey(day.employment_id, dateKey(day.work_date) ?? ''))) continue;
			const keepsOtherHalf =
				options.half === 'BOTH'
					? false
					: options.half === 'PLAN'
						? day.worked_intervals != null
						: day.shift_definition_id != null;
			if (!keepsOtherHalf) {
				deletes.push(day.id);
				continue;
			}
			const base = {
				id: day.id,
				employment_id: day.employment_id,
				work_date: dateKey(day.work_date) ?? ''
			};
			// `planned_origin` stays IMPORT on a cleared plan: the import is what decided this day has
			// no assignment, and it is the provenance the write hook admits under recorded attendance.
			clears.push(
				options.half === 'PLAN'
					? {
							...base,
							shift_definition_id: null,
							assignment_code: null,
							planned_origin: 'IMPORT' as const
						}
					: { ...base, worked_intervals: null, break_minutes: 0 }
			);
		}
		if (deletes.length > 0) yield* api.db.work_days.delete(deletes);
		// A roster sheet states a roster of record: every person-cycle the file touches has one,
		// created here when it has none. The days the file leaves out of a cycle are what a run then
		// refuses as an incomplete roster.
		if (options.half !== 'CLOCK') yield* rostersOfRecord(api, options);
		return [
			...personDayMutations(
				existing,
				options.rows.map((row) => ({
					employment_id: row.employmentId,
					work_date: row.workDate,
					values: row.values
				})),
				personDayKey
			),
			...clears
		];
	});
}

/** The payroll cycle a date settles in, in the entity's period grammar. */
function cyclePeriod(company: PayGridCompany, date: string): string {
	if (company.pay_frequency === 'SEMI_MONTHLY')
		return `${date.slice(0, 7)}-${Number(date.slice(8, 10)) <= 15 ? 1 : 2}`;
	// A monthly cycle is named by the month its cutoff falls in: the window ending on the 20th of
	// January is January's.
	return assessmentSpan(company, date).end.slice(0, 7);
}

/** The roster of record for every person-cycle a roster sheet touches: created where absent. */
function rostersOfRecord<Values extends object>(
	api: Api,
	options: {
		readonly companies: ReadonlyMap<string, PayGridCompany>;
		readonly rows: readonly PeriodStateRow<Values>[];
	}
) {
	return Effect.gen(function* () {
		const key = (employmentId: string, period: string) => `${employmentId}\u0000${period}`;
		const wanted = new Map<string, { employmentId: string; companyId: string; period: string }>();
		for (const row of options.rows) {
			const company = options.companies.get(row.companyId)!;
			const period = cyclePeriod(company, row.workDate);
			wanted.set(key(row.employmentId, period), {
				employmentId: row.employmentId,
				companyId: row.companyId,
				period
			});
		}
		const stored = yield* api.db.rosters.findMany({
			where: {
				employment_id: { in: [...new Set([...wanted.values()].map((row) => row.employmentId))] },
				period: { in: [...new Set([...wanted.values()].map((row) => row.period))] }
			},
			columns: { id: true, employment_id: true, period: true },
			limit: QUERY_LIMIT
		});
		if (stored.length >= QUERY_LIMIT) refuse('Roster history is incomplete.');
		const present = new Set(stored.map((row) => key(row.employment_id, row.period)));
		const creates = [...wanted.entries()]
			.filter(([wantedKey]) => !present.has(wantedKey))
			.map(([, row]) => ({
				employment_id: row.employmentId,
				company_id: row.companyId,
				period: row.period,
				origin: 'IMPORT' as const
			}));
		// The cycle window is the hook's to resolve from the entity's cutoff, so the create states
		// everything but `range`, which the generated create type requires.
		if (creates.length > 0) yield* api.db.rosters.mutate(creates as never);
	});
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

// ── the roster sheet ───────────────────────────────────────────────────────────────────────────

function dateInMonth(date: string, month: string): boolean {
	const bounds = monthBounds(month);
	return date >= bounds.start && date <= bounds.end;
}

function formatRosterRows(rows: readonly RosterRow[]): string[] {
	return rows.map((row) => `${row.employee_number} on ${row.work_date}`);
}

/** The roster sheet, validated into the period-state rows it replaces, and the entity they belong to. */
function prepareRosterMonth(payload: RosterImport, api: Api) {
	return Effect.gen(function* () {
		const { legal_entity: legalEntity, month: fileMonth, rows } = payload;
		// A roster import states its own legal entity and month on the Settings sheet: there is no
		// draft roster to attach it to, and an assignment belongs to the company and the day.
		if (legalEntity == null) {
			refuse('Set legal_entity on the Settings sheet to the employing entity this file is for.');
		}
		if (fileMonth == null || !isYearMonth(fileMonth)) {
			refuse(
				`Set month on the Settings sheet to the YYYY-MM month this file is for, not "${fileMonth ?? ''}".`
			);
		}
		const month: string = fileMonth;
		const companies = yield* api.db.companies.findMany({
			columns: {
				id: true,
				name: true,
				registration_number: true,
				settings_code: true,
				pay_frequency: true,
				pay_cutoff_day: true
			},
			limit: QUERY_LIMIT
		});
		const company = resolveLegalEntity(companies, legalEntity);
		const companyId = company.id;

		const invalidDates = rows.filter((row) => !isCalendarDate(row.work_date));
		if (invalidDates.length > 0) {
			refuse(
				`These rows do not use valid YYYY-MM-DD dates:\n${formatNamedList(formatRosterRows(invalidDates))}`
			);
		}
		const outsideMonth = rows.filter((row) => !dateInMonth(row.work_date, month));
		if (outsideMonth.length > 0) {
			refuse(
				`These rows do not belong to ${month}:\n${formatNamedList(formatRosterRows(outsideMonth))}`
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

		const contractFor = yield* readImportContracts(api, rows, companyId);

		const [holidayRows, assignments] = Array.partition(rows, (row) =>
			PH_TOKENS.has(row.shift_code.toUpperCase()) ? Result.fail(row) : Result.succeed(row)
		);
		if (holidayRows.length > 0) {
			// A PH row is validated against the entity's own calendar. It used to be validated against
			// the jurisdiction in force, which needed the settings history read above purely to reach
			// a country code — and which could not tell two entities of one country apart at all.
			const dates = [...new Set(holidayRows.map((row) => row.work_date))];
			const last = dates.toSorted().at(-1)!;
			const holidays = yield* api.db.jurisdiction_holidays.findMany({
				where: {
					company_id: { eq: companyId },
					date: { in: dates },
					published_at: { isNotNull: true },
					approval_id: { isNull: true }
				},
				limit: QUERY_LIMIT
			});
			if (holidays.length >= QUERY_LIMIT) refuse('Holiday history is incomplete.');
			const configured = resolveHolidays(holidays, companyId, dates.toSorted()[0]!, last);
			const unknown = holidayRows.filter((row) => !configured.has(row.work_date));
			if (unknown.length > 0) {
				refuse(
					`These PH rows are not published holidays for ${company.name}:\n${formatNamedList(formatRosterRows(unknown))}\nPublish the holiday on the entity first.`
				);
			}
		}

		const codes = [...new Set(assignments.map((row) => row.shift_code))];
		const rosterCodes = yield* api.db.shift_definitions.findMany({
			where: { company_id: { eq: companyId }, code: { in: codes } },
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

		const runs = yield* api.db.payroll_runs.findMany({
			where: { company_id: { eq: companyId } },
			columns: { id: true, period: true, attendance_from: true, attendance_to: true },
			limit: QUERY_LIMIT
		});
		// The lock is the payslip's, so a row is refused only where *its own* person has been paid.
		const runPayslips = runs.length
			? yield* api.db.payslips.findMany({
					where: { payroll_run_id: { in: runs.map((run) => run.id) } },
					columns: { payroll_run_id: true, employment_id: true, paid_at: true },
					limit: QUERY_LIMIT
				})
			: [];
		const windows = payrollWindows(runs, runPayslips);
		for (const row of assignments)
			assertNotSettled(windows, row.work_date, 'Importing roster', contractFor(row).id);

		// Every column the sheet is read for is written. `planned_origin` is `IMPORT` because that is
		// what these rows are — the board writes `MANUAL`, and leaving provenance unset would have
		// made a whole imported month indistinguishable from an operator's ad hoc edits. The note is
		// an optional column of the long-form sheet, so a file that carries one carries it through
		// rather than having it read and discarded.
		return {
			companies: new Map([[company.id, company]]),
			rows: assignments.map((row) => {
				const code = codeByName.get(row.shift_code);
				if (code == null) refuse(`No roster code resolved for ${row.shift_code}.`);
				return {
					employmentId: contractFor(row).id,
					companyId: contractFor(row).company_id,
					workDate: row.work_date,
					who: row.employee_number,
					values: {
						shift_definition_id: code.id,
						assignment_code: row.assignment_code ?? null,
						planned_origin: 'IMPORT' as const
					}
				};
			})
		};
	});
}

function importRosterMonth(payload: RosterImport, api: Api) {
	return Effect.gen(function* () {
		const prepared = yield* prepareRosterMonth(payload, api);
		return yield* replacePeriodState(api, { half: 'PLAN', ...prepared });
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

/** The time-entries sheet, validated into the period-state rows it replaces, by each contract's entity. */
function prepareAttendanceMonth(payload: AttendanceImport, api: Api) {
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

		// Every company, not only a named one: the file may name no legal entity, and the period the
		// rows replace is read off each contract's own company pay grid.
		const companies = yield* api.db.companies.findMany({
			columns: {
				id: true,
				name: true,
				registration_number: true,
				settings_code: true,
				pay_frequency: true,
				pay_cutoff_day: true
			},
			limit: QUERY_LIMIT
		});
		const companyById = new Map(companies.map((company) => [company.id, company]));
		const companyId =
			legalEntity == null ? undefined : resolveLegalEntity(companies, legalEntity).id;

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

		const contractFor = yield* readImportContracts(api, rows, companyId);
		const employmentIds = [...new Set(rows.map((row) => contractFor(row).id))];
		const workDates = [...new Set(rows.map((row) => row.work_date))].toSorted();

		// One writer wins the day even on import: attendance cannot be loaded onto a day approved
		// leave already owns, or onto a day a paid payroll run settled.
		const first = workDates[0]!;
		const last = workDates.at(-1)!;
		const companyIds = [...new Set(rows.map((row) => contractFor(row).company_id))];
		if (companyIds.length > 0) {
			const runs = yield* api.db.payroll_runs.findMany({
				where: { company_id: { in: companyIds } },
				columns: {
					id: true,
					company_id: true,
					period: true,
					attendance_from: true,
					attendance_to: true
				},
				limit: QUERY_LIMIT
			});
			const runPayslips = runs.length
				? yield* api.db.payslips.findMany({
						where: { payroll_run_id: { in: runs.map((run) => run.id) } },
						columns: { payroll_run_id: true, employment_id: true, paid_at: true },
						limit: QUERY_LIMIT
					})
				: [];
			const windowsByCompany = new Map(
				companyIds.map((id) => [
					id,
					payrollWindows(
						runs.filter((run) => run.company_id === id),
						runPayslips
					)
				])
			);
			for (const row of rows)
				assertNotSettled(
					windowsByCompany.get(contractFor(row).company_id)!,
					row.work_date,
					'Importing attendance',
					contractFor(row).id
				);
		}
		const leaveRows = yield* api.db.leave_entries.findMany({
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
			const employmentId = contractFor(row).id;
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

		return {
			companies: companyById,
			rows: rows.map((row) => ({
				employmentId: contractFor(row).id,
				companyId: contractFor(row).company_id,
				workDate: row.work_date,
				who: row.employee_number,
				values: attendanceValues(row, timezone)
			}))
		};
	});
}

function importAttendanceMonth(payload: AttendanceImport, api: Api) {
	return Effect.gen(function* () {
		const prepared = yield* prepareAttendanceMonth(payload, api);
		return yield* replacePeriodState(api, { half: 'CLOCK', ...prepared });
	});
}

/**
 * One workbook carrying both sheets is the whole state of the period: plan and clock together,
 * every person-day either sheet names, and nothing else. A day only the roster names has no
 * clock; a day only the time entries name has no plan; a stored day neither names goes.
 */
function importWorkbookMonth(payload: WorkbookImport, api: Api) {
	return Effect.gen(function* () {
		const [roster, attendance] = yield* Effect.all(
			[
				prepareRosterMonth({ ...payload.roster, sheet: 'ROSTER' }, api),
				prepareAttendanceMonth({ ...payload.attendance, sheet: 'ATTENDANCE' }, api)
			],
			{ concurrency: 'unbounded' }
		);
		const blankPlan = {
			shift_definition_id: null,
			assignment_code: null,
			planned_origin: 'IMPORT' as const
		};
		const blankClock = { worked_intervals: null, break_minutes: 0 };
		const merged = new Map<string, PeriodStateRow<Record<string, unknown>>>();
		for (const row of roster.rows)
			merged.set(personDayKey(row.employmentId, row.workDate), {
				...row,
				values: { ...blankClock, ...row.values }
			});
		for (const row of attendance.rows) {
			const key = personDayKey(row.employmentId, row.workDate);
			const planned = merged.get(key);
			merged.set(key, {
				...row,
				values: { ...blankPlan, ...(planned?.values ?? {}), ...row.values }
			});
		}
		return yield* replacePeriodState(api, {
			half: 'BOTH',
			companies: new Map([...roster.companies, ...attendance.companies]),
			rows: [...merged.values()]
		});
	});
}

export default {
	import: {
		description:
			'Loads one month of person-days for one legal entity from the scheduling workbook: the Roster sheet loads planned roster-code assignments, the Time entries sheet loads local attendance punches as generic worked intervals, and a workbook carrying both loads both as one state. The file is the state of the assessment period it covers (the half-month or cutoff window of the legal entity): on the half a sheet carries, every person-day of that entity in the period is replaced by the file, and a day the file omits loses that half; with both sheets, a day neither names goes. The half a single sheet does not carry is never touched. A period a payroll run has already taken into account is refused until that run is deleted. The import never labels or stores overtime; payroll derives it from actual intervals and the schedule.',
		input: importSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const payload = Schema.decodeUnknownSync(importSchema)(input);
				if (payload.sheet === 'ROSTER') return yield* importRosterMonth(payload, api);
				if (payload.sheet === 'WORKBOOK') return yield* importWorkbookMonth(payload, api);
				return yield* importAttendanceMonth(payload, api);
			})
	}
} satisfies Pipelines;
