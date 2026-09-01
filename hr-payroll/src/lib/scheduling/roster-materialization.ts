import type { RosterCodeVariant } from '../../datatypes/roster_code_variant/+definition.js';
import type { WorkPattern } from '../../datatypes/work_pattern/+definition.js';
import { coversDate, readRange } from '../../collections/payroll_runs/lib/effective.js';
import { dateKey } from '../iso-day.js';
import { calendarDaysInMonth, isYearMonth } from '../period.js';
import { rosterCodeKind } from './roster-code.js';
import { patternRosterCodeId } from './work-pattern.js';

/** A page at this size is indistinguishable from a truncated read and is always refused. */
export const ROSTER_MATERIALIZATION_QUERY_LIMIT = 20_000;

interface MaterializationEmployment {
	readonly id: string;
	readonly company_id: string;
	readonly employee_number: string;
	readonly effective_range: unknown;
}

interface MaterializationTerm {
	readonly id: string;
	readonly employment_id: string;
	readonly work_pattern: WorkPattern;
	readonly effective_range: unknown;
}

interface MaterializationRosterCode {
	readonly id: string;
	readonly company_id: string;
	readonly code: string;
	readonly variant: RosterCodeVariant;
	readonly effective_range: unknown;
}

interface MaterializationWorkDay {
	readonly id: string;
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id: string | null;
	readonly roster_id: string | null;
}

interface NewMaterializedWorkDayMutation {
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id: string;
	readonly assignment_code: string;
	readonly planned_origin: 'GENERATED';
	readonly planned_note: null;
}

interface ExistingMaterializedWorkDayMutation {
	readonly id: string;
	readonly shift_definition_id?: string;
	readonly assignment_code?: string;
	readonly planned_origin?: 'GENERATED';
	readonly planned_note?: null;
}

type MaterializedWorkDayMutation =
	NewMaterializedWorkDayMutation | ExistingMaterializedWorkDayMutation;

type RosterMaterializationDiagnosticCode =
	| 'INVALID_MONTH'
	| 'EMPLOYMENT_COMPANY_MISMATCH'
	| 'EMPLOYMENT_RANGE_INVALID'
	| 'DUPLICATE_PERSON_DAY'
	| 'PERSON_DAY_ALREADY_ROSTERED'
	| 'MISSING_TERM'
	| 'AMBIGUOUS_TERM'
	| 'INVALID_PATTERN'
	| 'ROSTERED_ASSIGNMENT_MISSING'
	| 'ROSTER_CODE_MISSING'
	| 'ROSTER_CODE_WRONG_COMPANY'
	| 'ROSTER_CODE_INEFFECTIVE'
	| 'ROSTER_CODE_INVALID'
	| 'INCOMPLETE_GRAPH';

interface RosterMaterializationDiagnostic {
	readonly code: RosterMaterializationDiagnosticCode;
	readonly message: string;
	readonly employment_id?: string;
	readonly employee_number?: string;
	readonly work_date?: string;
}

interface RosterMaterializationReady {
	readonly kind: 'ready';
	readonly work_day_roster: readonly MaterializedWorkDayMutation[];
	readonly expected_count: number;
	readonly created_count: number;
	readonly updated_count: number;
	readonly preserved_explicit_plan_count: number;
	readonly materialized_attendance_only_count: number;
}

interface RosterMaterializationRefused {
	readonly kind: 'refused';
	readonly diagnostics: readonly RosterMaterializationDiagnostic[];
}

type RosterMaterializationResult = RosterMaterializationReady | RosterMaterializationRefused;

interface BuildRosterMaterializationInput {
	readonly company_id: string;
	readonly month: string;
	readonly employments: readonly MaterializationEmployment[];
	readonly terms: readonly MaterializationTerm[];
	readonly roster_codes: readonly MaterializationRosterCode[];
	readonly work_days: readonly MaterializationWorkDay[];
}

const personDayKey = (employmentId: string, date: string): string => `${employmentId}:${date}`;

const employeeDayLabel = (employment: MaterializationEmployment, date: string): string =>
	`${employment.employee_number} (${employment.id}) on ${date}`;

/** Every roster-code identity a bounded code read must resolve before planning starts. */
export function referencedRosterCodeIds(
	terms: readonly MaterializationTerm[],
	workDays: readonly MaterializationWorkDay[]
): readonly string[] {
	const ids = new Set<string>();
	for (const term of terms) {
		if (term.work_pattern.type !== 'PATTERNED') continue;
		for (const phase of term.work_pattern.phases) {
			for (const day of phase.day_cycle) ids.add(day.roster_code_id);
		}
	}
	for (const day of workDays) {
		if (day.shift_definition_id != null) ids.add(day.shift_definition_id);
	}
	return [...ids].sort();
}

/** Whether the employment contributes at least one person-day to this month. */
export function employmentTouchesRosterMonth(
	employment: MaterializationEmployment,
	month: string
): boolean {
	if (!isYearMonth(month) || readRange(employment.effective_range) == null) return false;
	return calendarDaysInMonth(month).some((date) => coversDate(employment.effective_range, date));
}

function generatedPlan(
	employmentId: string,
	date: string,
	code: MaterializationRosterCode
): NewMaterializedWorkDayMutation {
	return {
		employment_id: employmentId,
		work_date: date,
		shift_definition_id: code.id,
		assignment_code: code.code,
		planned_origin: 'GENERATED',
		planned_note: null
	};
}

function existingGeneratedPlan(
	id: string,
	code: MaterializationRosterCode
): ExistingMaterializedWorkDayMutation {
	return {
		id,
		shift_definition_id: code.id,
		assignment_code: code.code,
		planned_origin: 'GENERATED',
		planned_note: null
	};
}

/**
 * Build the complete desired `work_day_roster` graph without performing a write.
 *
 * A refused result deliberately carries no partial graph. The caller can only submit a month after
 * every active employee-date has one term and one valid explicit or generated roster code.
 */
export function buildRosterMaterialization(
	input: BuildRosterMaterializationInput
): RosterMaterializationResult {
	if (!isYearMonth(input.month)) {
		return {
			kind: 'refused',
			diagnostics: [
				{
					code: 'INVALID_MONTH',
					message: `Roster month must be written YYYY-MM, not "${input.month}".`
				}
			]
		};
	}

	const diagnostics: RosterMaterializationDiagnostic[] = [];
	const monthDates = calendarDaysInMonth(input.month);
	const termByEmployment = new Map<string, MaterializationTerm[]>();
	for (const term of input.terms) {
		const grouped = termByEmployment.get(term.employment_id) ?? [];
		grouped.push(term);
		termByEmployment.set(term.employment_id, grouped);
	}

	const codeById = new Map<string, MaterializationRosterCode>();
	for (const code of input.roster_codes) codeById.set(code.id, code);

	const workDayByKey = new Map<string, MaterializationWorkDay>();
	const duplicateKeys = new Set<string>();
	for (const day of input.work_days) {
		const key = personDayKey(day.employment_id, dateKey(day.work_date));
		if (workDayByKey.has(key)) duplicateKeys.add(key);
		else workDayByKey.set(key, day);
	}
	for (const key of [...duplicateKeys].sort()) {
		const [employmentId, workDate] = key.split(':') as [string, string];
		diagnostics.push({
			code: 'DUPLICATE_PERSON_DAY',
			employment_id: employmentId,
			work_date: workDate,
			message: `${employmentId} has more than one work_days row on ${workDate}.`
		});
	}

	const children: MaterializedWorkDayMutation[] = [];
	let expectedCount = 0;
	let createdCount = 0;
	let updatedCount = 0;
	let preservedExplicitPlanCount = 0;
	let materializedAttendanceOnlyCount = 0;

	const employments = [...input.employments].sort(
		(left, right) =>
			left.employee_number.localeCompare(right.employee_number) || left.id.localeCompare(right.id)
	);
	for (const employment of employments) {
		if (employment.company_id !== input.company_id) {
			diagnostics.push({
				code: 'EMPLOYMENT_COMPANY_MISMATCH',
				employment_id: employment.id,
				employee_number: employment.employee_number,
				message: `${employment.employee_number} belongs to another company.`
			});
			continue;
		}
		if (readRange(employment.effective_range) == null) {
			diagnostics.push({
				code: 'EMPLOYMENT_RANGE_INVALID',
				employment_id: employment.id,
				employee_number: employment.employee_number,
				message: `${employment.employee_number} has no valid employment effective range.`
			});
			continue;
		}

		const activeDates = monthDates.filter((date) => coversDate(employment.effective_range, date));
		expectedCount += activeDates.length;
		const employmentTerms = termByEmployment.get(employment.id) ?? [];
		for (const date of activeDates) {
			const dayLabel = employeeDayLabel(employment, date);
			const effectiveTerms = employmentTerms.filter((term) =>
				coversDate(term.effective_range, date)
			);
			if (effectiveTerms.length === 0) {
				diagnostics.push({
					code: 'MISSING_TERM',
					employment_id: employment.id,
					employee_number: employment.employee_number,
					work_date: date,
					message: `${dayLabel} has no effective employment term.`
				});
				continue;
			}
			if (effectiveTerms.length > 1) {
				diagnostics.push({
					code: 'AMBIGUOUS_TERM',
					employment_id: employment.id,
					employee_number: employment.employee_number,
					work_date: date,
					message: `${dayLabel} has ${effectiveTerms.length} effective employment terms.`
				});
				continue;
			}

			const term = effectiveTerms[0]!;
			const existing = workDayByKey.get(personDayKey(employment.id, date));
			if (existing?.roster_id != null) {
				diagnostics.push({
					code: 'PERSON_DAY_ALREADY_ROSTERED',
					employment_id: employment.id,
					employee_number: employment.employee_number,
					work_date: date,
					message: `${dayLabel} already belongs to roster ${existing.roster_id}.`
				});
				continue;
			}

			const preservesExplicitPlan = existing?.shift_definition_id != null;
			let rosterCodeId = existing?.shift_definition_id ?? null;
			if (rosterCodeId == null && term.work_pattern.type === 'ROSTERED') {
				diagnostics.push({
					code: 'ROSTERED_ASSIGNMENT_MISSING',
					employment_id: employment.id,
					employee_number: employment.employee_number,
					work_date: date,
					message: `${dayLabel} is ROSTERED and needs an explicit WORK, REST or OFF assignment.`
				});
				continue;
			}
			try {
				// Only a day without an explicit assignment projects its pattern; `??=` is what keeps
				// the projection off the days that already name a code.
				rosterCodeId ??= patternRosterCodeId(term.work_pattern, date);
			} catch (cause) {
				diagnostics.push({
					code: 'INVALID_PATTERN',
					employment_id: employment.id,
					employee_number: employment.employee_number,
					work_date: date,
					message: `${dayLabel} cannot project its work pattern: ${cause instanceof Error ? cause.message : String(cause)}`
				});
				continue;
			}
			if (rosterCodeId == null) {
				diagnostics.push({
					code: 'INVALID_PATTERN',
					employment_id: employment.id,
					employee_number: employment.employee_number,
					work_date: date,
					message: `${dayLabel} did not project a roster code.`
				});
				continue;
			}

			const rosterCode = codeById.get(rosterCodeId);
			if (rosterCode == null) {
				diagnostics.push({
					code: 'ROSTER_CODE_MISSING',
					employment_id: employment.id,
					employee_number: employment.employee_number,
					work_date: date,
					message: `${dayLabel} names missing roster code ${rosterCodeId}.`
				});
				continue;
			}
			if (rosterCode.company_id !== input.company_id) {
				diagnostics.push({
					code: 'ROSTER_CODE_WRONG_COMPANY',
					employment_id: employment.id,
					employee_number: employment.employee_number,
					work_date: date,
					message: `${dayLabel} names roster code ${rosterCode.code} from another company.`
				});
				continue;
			}
			if (!coversDate(rosterCode.effective_range, date)) {
				diagnostics.push({
					code: 'ROSTER_CODE_INEFFECTIVE',
					employment_id: employment.id,
					employee_number: employment.employee_number,
					work_date: date,
					message: `${dayLabel} names roster code ${rosterCode.code}, which is not effective on that date.`
				});
				continue;
			}
			try {
				rosterCodeKind(rosterCode.variant);
			} catch (cause) {
				diagnostics.push({
					code: 'ROSTER_CODE_INVALID',
					employment_id: employment.id,
					employee_number: employment.employee_number,
					work_date: date,
					message: `${dayLabel} names invalid roster code ${rosterCode.code}: ${cause instanceof Error ? cause.message : String(cause)}`
				});
				continue;
			}

			if (existing == null) {
				children.push(generatedPlan(employment.id, date, rosterCode));
				createdCount += 1;
				continue;
			}
			updatedCount += 1;
			if (preservesExplicitPlan) {
				// The relationship injects only roster_id. Omitting every plan and actual field is how the
				// existing explicit assignment and attendance are preserved byte-for-byte.
				children.push({ id: existing.id });
				preservedExplicitPlanCount += 1;
				continue;
			}
			// The explicit id is the generic graph engine's null-owner claim. Actual fields stay omitted.
			children.push(existingGeneratedPlan(existing.id, rosterCode));
			materializedAttendanceOnlyCount += 1;
		}
	}

	if (children.length !== expectedCount) {
		diagnostics.push({
			code: 'INCOMPLETE_GRAPH',
			message: `The month requires ${expectedCount} person-days, but only ${children.length} passed validation.`
		});
	}
	if (diagnostics.length > 0) return { kind: 'refused', diagnostics };
	return {
		kind: 'ready',
		work_day_roster: children,
		expected_count: expectedCount,
		created_count: createdCount,
		updated_count: updatedCount,
		preserved_explicit_plan_count: preservedExplicitPlanCount,
		materialized_attendance_only_count: materializedAttendanceOnlyCount
	};
}

/** Complete operator-facing refusal text; no employee-date diagnostic is truncated. */
export function formatRosterMaterializationRefusal(
	companyName: string,
	month: string,
	diagnostics: readonly RosterMaterializationDiagnostic[]
): string {
	return (
		`Cannot open ${month} for ${companyName}: ${diagnostics.length} validation check(s) failed.\n` +
		diagnostics.map((diagnostic) => `• ${diagnostic.message}`).join('\n')
	);
}
