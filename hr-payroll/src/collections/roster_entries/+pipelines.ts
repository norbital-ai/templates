import { isCalendarDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { rosterCodeVariantSchema } from '../../custom-types/roster_code_variant/+definition.js';
import { formatNamedList, monthBounds } from '../../lib/period.js';
import type { Pipelines } from './$types.js';

type CompanyIdentity = {
	readonly norbital_id: string;
	readonly name: string;
	readonly registration_number: string;
};

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
		throw new Error(
			`No legal entity named "${legalEntity}" is on file.\n` +
				`Known entities:\n${formatNamedList(companies.map((company) => company.name))}`
		);
	}
	throw new Error(
		`"${legalEntity}" matches more than one legal entity:\n${formatNamedList(matches.map((company) => company.name))}`
	);
}

const trimmedNonEmpty = Schema.Trimmed.check(Schema.isMinLength(1));

const rowSchema = Schema.Struct({
	employee_number: trimmedNonEmpty,
	work_date: trimmedNonEmpty,
	shift_code: trimmedNonEmpty,
	assignment_code: Schema.optional(trimmedNonEmpty),
	note: Schema.optional(Schema.String)
});

const importSchema = Schema.Struct({
	roster_id: trimmedNonEmpty,
	legal_entity: Schema.optional(trimmedNonEmpty),
	month: Schema.optional(trimmedNonEmpty),
	rows: Schema.Array(rowSchema)
});

const QUERY_LIMIT = 20_000;
const PH_TOKENS = new Set(['PH', 'PUBLIC_HOLIDAY']);
type ImportRow = Schema.Schema.Type<typeof rowSchema>;

function dateKey(value: string | Date): string {
	return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function dateInMonth(date: string, month: string): boolean {
	const bounds = monthBounds(month);
	return date >= bounds.start && date <= bounds.end;
}

function rangeCovers(
	range: { readonly start?: string; readonly end?: string } | null,
	date: string
): boolean {
	if (range?.start == null) return false;
	return date >= dateKey(range.start) && (range.end == null || date <= dateKey(range.end));
}

function formatRows(rows: readonly ImportRow[]): string[] {
	return rows.map((row) => `${row.employee_number} on ${row.work_date}`);
}

export default {
	import: {
		description:
			'Loads a month of planned roster-code assignments for one legal entity. Blank cells are omitted and public holidays are verified against the company calendar rather than stored as roster entries.',
		input: importSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const {
					roster_id: rosterId,
					legal_entity: legalEntity,
					month: fileMonth,
					rows
				} = Schema.decodeUnknownSync(importSchema)(input);
				const roster = yield* api.db.query.rosters.findFirst({
					where: { norbital_id: { eq: rosterId } },
					columns: { month: true, published_at: true, company_id: true }
				});
				if (roster == null) throw new Error('Create the draft monthly roster before importing it.');
				if (roster.published_at != null) {
					throw new Error(
						`Roster ${roster.month} is published. Re-open it before importing changes.`
					);
				}
				if (fileMonth != null && fileMonth !== roster.month) {
					throw new Error(
						`This workbook is for ${fileMonth}, but the open draft is ${roster.month}. Import it into that month's roster.`
					);
				}
				if (legalEntity != null) {
					const companies = yield* api.db.query.companies.findMany({
						columns: { norbital_id: true, name: true, registration_number: true },
						limit: QUERY_LIMIT
					});
					const company = resolveLegalEntity(companies, legalEntity);
					if (company.norbital_id !== roster.company_id) {
						throw new Error(
							`This workbook is for ${company.name}, which is not the legal entity of roster ${roster.month}.`
						);
					}
				}

				const invalidDates = rows.filter((row) => !isCalendarDate(row.work_date));
				if (invalidDates.length > 0) {
					throw new Error(
						`These rows do not use valid YYYY-MM-DD dates:\n${formatNamedList(formatRows(invalidDates))}`
					);
				}
				const outsideMonth = rows.filter((row) => !dateInMonth(row.work_date, roster.month));
				if (outsideMonth.length > 0) {
					throw new Error(
						`These rows do not belong to roster ${roster.month}:\n${formatNamedList(formatRows(outsideMonth))}`
					);
				}
				const seen = new Set<string>();
				const duplicates: string[] = [];
				for (const row of rows) {
					const key = `${row.employee_number}\t${row.work_date}`;
					if (seen.has(key)) duplicates.push(`${row.employee_number} on ${row.work_date}`);
					seen.add(key);
				}
				if (duplicates.length > 0) {
					throw new Error(`The import repeats person-days:\n${formatNamedList(duplicates)}`);
				}

				const employeeNumbers = [...new Set(rows.map((row) => row.employee_number))];
				const employments = yield* api.db.query.employments.findMany({
					where: {
						company_id: { eq: roster.company_id },
						employee_number: { in: employeeNumbers }
					},
					columns: { norbital_id: true, employee_number: true },
					limit: QUERY_LIMIT
				});
				const employmentByNumber = new Map(
					employments.map((employment) => [employment.employee_number, employment.norbital_id])
				);
				const unknownEmployees = employeeNumbers.filter(
					(number) => !employmentByNumber.has(number)
				);
				if (unknownEmployees.length > 0) {
					throw new Error(
						`These employee numbers are not employed by this legal entity:\n${formatNamedList(unknownEmployees)}`
					);
				}

				const holidayRows = rows.filter((row) => PH_TOKENS.has(row.shift_code.toUpperCase()));
				if (holidayRows.length > 0) {
					const dates = [...new Set(holidayRows.map((row) => row.work_date))];
					const holidays = yield* api.db.query.company_holidays.findMany({
						where: { company_id: { eq: roster.company_id }, date: { in: dates } },
						columns: { date: true },
						limit: QUERY_LIMIT
					});
					const configured = new Set(holidays.map((holiday) => dateKey(holiday.date)));
					const unknown = holidayRows.filter((row) => !configured.has(row.work_date));
					if (unknown.length > 0) {
						throw new Error(
							`These PH rows are not observed holidays for the legal entity:\n${formatNamedList(formatRows(unknown))}\nConfigure the holiday calendar first.`
						);
					}
				}

				const assignments = rows.filter((row) => !PH_TOKENS.has(row.shift_code.toUpperCase()));
				const codes = [...new Set(assignments.map((row) => row.shift_code))];
				const rosterCodes = yield* api.db.query.shift_definitions.findMany({
					where: { company_id: { eq: roster.company_id }, code: { in: codes } },
					columns: { norbital_id: true, code: true, variant: true, effective_range: true },
					limit: QUERY_LIMIT
				});
				const codeByName = new Map(rosterCodes.map((code) => [code.code, code]));
				const unknownCodes = codes.filter((code) => !codeByName.has(code));
				if (unknownCodes.length > 0) {
					throw new Error(
						`These roster codes are not defined for this legal entity:\n${formatNamedList(unknownCodes)}`
					);
				}
				const ineffective = assignments.filter((row) => {
					const code = codeByName.get(row.shift_code);
					return code == null || !rangeCovers(code.effective_range, row.work_date);
				});
				if (ineffective.length > 0) {
					throw new Error(
						`These roster codes are not effective on the assigned date:\n${formatNamedList(formatRows(ineffective))}`
					);
				}
				for (const code of rosterCodes)
					Schema.decodeUnknownSync(rosterCodeVariantSchema)(code.variant);

				const employmentId = (number: string): string => {
					const id = employmentByNumber.get(number);
					if (id == null) throw new Error(`No employment resolved for ${number}.`);
					return id;
				};
				const employmentIds = [
					...new Set(assignments.map((row) => employmentId(row.employee_number)))
				];
				const workDates = [...new Set(assignments.map((row) => row.work_date))];
				const existing =
					employmentIds.length === 0
						? []
						: yield* api.db.query.roster_entries.findMany({
								where: { employment_id: { in: employmentIds }, work_date: { in: workDates } },
								columns: { employment_id: true, work_date: true },
								limit: QUERY_LIMIT
							});
				const existingKeys = new Set(
					existing.map((entry) => `${entry.employment_id}\t${dateKey(entry.work_date)}`)
				);
				const alreadyPresent = assignments.filter((row) =>
					existingKeys.has(`${employmentId(row.employee_number)}\t${row.work_date}`)
				);
				if (alreadyPresent.length > 0) {
					throw new Error(
						`These days already have an explicit assignment:\n${formatNamedList(formatRows(alreadyPresent))}`
					);
				}

				// Every column the sheet is read for is written. `origin` is `IMPORT` because that is
				// what these rows are — the model's default is `MANUAL`, which is what the board writes,
				// and leaving the default in place would have made a whole imported month indistinguishable
				// from an operator's ad hoc edits. `note` is an optional column of the long-form sheet, so
				// a file that carries one carries it through rather than having it read and discarded.
				return assignments.map((row) => {
					const code = codeByName.get(row.shift_code);
					if (code == null) throw new Error(`No roster code resolved for ${row.shift_code}.`);
					return {
						employment_id: employmentId(row.employee_number),
						work_date: row.work_date,
						shift_definition_id: code.norbital_id,
						roster_id: rosterId,
						assignment_code: row.assignment_code ?? null,
						origin: 'IMPORT' as const,
						note: row.note ?? null
					};
				});
			})
	}
} satisfies Pipelines;
