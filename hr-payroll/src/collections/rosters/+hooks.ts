import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { dateKey } from '../../lib/iso-day.js';
import { monthBounds } from '../../lib/period.js';
import { rosterCodeKind, workWindow } from '../../lib/scheduling/roster-code.js';
import { patternRosterCodeId } from '../../lib/scheduling/work-pattern.js';
import { coversDate } from '../payroll_runs/lib/effective.js';
import {
	validateRosterSchedule,
	type ValidationDay,
	type ValidationShift,
	type WorkloadExpectation
} from './lib/workforce-validation.js';
import type { Api, Hooks, WorkspaceRow } from './$types.js';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const QUERY_LIMIT = 20_000;
const DAY_MS = 86_400_000;

function daysBetween(start: string, end: string): string[] {
	const first = Date.parse(`${start}T00:00:00.000Z`);
	const last = Date.parse(`${end}T00:00:00.000Z`);
	return Array.from({ length: Math.floor((last - first) / DAY_MS) + 1 }, (_value, index) =>
		new Date(first + index * DAY_MS).toISOString().slice(0, 10)
	);
}

function rangeIntersection(
	range: { readonly start?: string; readonly end?: string | null } | null,
	bounds: { readonly start: string; readonly end: string }
): { start: string; end: string } | null {
	if (range?.start == null) return null;
	const start = dateKey(range.start) > bounds.start ? dateKey(range.start) : bounds.start;
	const rawEnd = range.end == null ? bounds.end : dateKey(range.end);
	const end = rawEnd < bounds.end ? rawEnd : bounds.end;
	return start <= end ? { start, end } : null;
}

type AppraisedTerm = Pick<
	WorkspaceRow<'employment_terms'>,
	'employment_id' | 'work_pattern' | 'effective_range'
>;
type AppraisedCode = Pick<
	WorkspaceRow<'shift_definitions'>,
	'id' | 'code' | 'variant' | 'effective_range'
>;
type AppraisedEntry = Pick<
	WorkspaceRow<'roster_entries'>,
	'employment_id' | 'work_date' | 'shift_definition_id'
>;

/**
 * One employment term against one month: the days it covers, the schedule those days project
 * against the terms' work pattern, and the expectation that pattern promises.
 *
 * `null` when the term does not touch the month. The refusals belong here — each one names the
 * exact row and date the publication gate is failing on, and this is the one place the per-date
 * projection is walked.
 */
function appraiseTerm(
	term: AppraisedTerm,
	bounds: { readonly start: string; readonly end: string },
	entryByKey: ReadonlyMap<string, AppraisedEntry>,
	codeById: ReadonlyMap<string, AppraisedCode>
): {
	handledKeys: readonly string[];
	days: readonly ValidationDay[];
	expectation: WorkloadExpectation | null;
} | null {
	const active = rangeIntersection(term.effective_range, bounds);
	if (active == null) return null;
	const pattern = term.work_pattern;
	const activeDates = daysBetween(active.start, active.end);
	const handledKeys: string[] = [];
	const days: ValidationDay[] = [];
	let expectedWorkDays = 0;
	let expectedPaidMinutes = 0;

	for (const date of activeDates) {
		const entryKey = `${term.employment_id}:${date}`;
		const entry = entryByKey.get(entryKey);
		if (entry != null) handledKeys.push(entryKey);
		const projectedId = pattern.type === 'PATTERNED' ? patternRosterCodeId(pattern, date) : null;
		const codeId = entry?.shift_definition_id ?? projectedId;
		const code = codeId == null ? null : codeById.get(codeId);
		if (codeId != null && code == null) {
			refuse(`${date} names a roster code that is missing or belongs to another entity.`);
		}
		if (code != null && !coversDate(code.effective_range, date)) {
			refuse(`Roster code ${code.code} is not effective on ${date}.`);
		}
		if (pattern.type === 'PATTERNED') {
			const projected = projectedId == null ? null : codeById.get(projectedId);
			if (projected == null) refuse(`${date} projects an unknown roster code.`);
			if (rosterCodeKind(projected.variant) === 'WORK') {
				expectedWorkDays += 1;
				expectedPaidMinutes += workWindow(projected.variant)!.paid_minutes;
			}
		}
		if (code == null && pattern.type === 'ROSTERED') continue;
		const kind = code == null ? null : rosterCodeKind(code.variant);
		const window = code == null ? null : workWindow(code.variant);
		const shift: ValidationShift | null =
			kind !== 'WORK' || window == null
				? null
				: {
						code: code!.code,
						start_time: window.start_time,
						end_time: window.end_time,
						break_minutes: window.break_minutes
					};
		days.push({
			employment_id: term.employment_id,
			work_date: date,
			designation: kind,
			shift
		});
	}

	if (pattern.type === 'PATTERNED') {
		return {
			handledKeys,
			days,
			expectation: {
				employment_id: term.employment_id,
				start_date: active.start,
				end_date: active.end,
				kind: 'EXACT',
				work_days: expectedWorkDays,
				paid_minutes: expectedPaidMinutes
			}
		};
	}
	const requirement = pattern.expectation;
	const referenceDays =
		requirement.period === 'WEEK' ? 7 : daysBetween(bounds.start, bounds.end).length;
	const fraction = activeDates.length / referenceDays;
	if (requirement.kind === 'GUARANTEED_SCHEDULE') {
		return {
			handledKeys,
			days,
			expectation: {
				employment_id: term.employment_id,
				start_date: active.start,
				end_date: active.end,
				kind: 'MINIMUM',
				work_days: Math.ceil(requirement.required_work_days * fraction),
				paid_minutes: Math.ceil(requirement.required_paid_minutes * fraction)
			}
		};
	}
	if (requirement.maximum_paid_minutes != null) {
		return {
			handledKeys,
			days,
			expectation: {
				employment_id: term.employment_id,
				start_date: active.start,
				end_date: active.end,
				kind: 'MAXIMUM',
				work_days: null,
				paid_minutes: Math.floor(requirement.maximum_paid_minutes * fraction)
			}
		};
	}
	return { handledKeys, days, expectation: null };
}

function assertPublishable(
	api: Api,
	roster: { readonly id: string; readonly company_id: string; readonly month: string }
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const bounds = monthBounds(roster.month);
		const [entries, employments, codes] = yield* Effect.all(
			[
				api.db.roster_entries.findMany({
					where: { roster_id: { eq: roster.id } },
					limit: QUERY_LIMIT
				}),
				api.db.employments.findMany({
					where: { company_id: { eq: roster.company_id } },
					columns: { id: true, employee_number: true, effective_range: true },
					limit: QUERY_LIMIT
				}),
				api.db.shift_definitions.findMany({
					where: { company_id: { eq: roster.company_id } },
					columns: {
						id: true,
						code: true,
						variant: true,
						effective_range: true
					},
					limit: QUERY_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		if ([entries, employments, codes].some((rows) => rows.length === QUERY_LIMIT)) {
			refuse(`Roster ${roster.month} is too large to validate in one page.`);
		}
		const employmentIds = employments
			.filter((employment) => rangeIntersection(employment.effective_range, bounds) != null)
			.map((employment) => employment.id);
		const terms =
			employmentIds.length === 0
				? []
				: yield* api.db.employment_terms.findMany({
						where: { employment_id: { in: employmentIds } },
						columns: { employment_id: true, work_pattern: true, effective_range: true },
						limit: QUERY_LIMIT
					});
		if (terms.length === QUERY_LIMIT) {
			refuse(`Roster ${roster.month} has too many effective-dated terms to validate.`);
		}

		const codeById = new Map(codes.map((code) => [code.id, code]));
		const entryByKey = new Map(
			entries.map((entry) => [`${entry.employment_id}:${dateKey(entry.work_date)}`, entry])
		);
		const validationDays: ValidationDay[] = [];
		const expectations: WorkloadExpectation[] = [];
		const handledEntryKeys = new Set<string>();

		for (const term of terms) {
			const appraised = appraiseTerm(term, bounds, entryByKey, codeById);
			if (appraised == null) continue;
			for (const key of appraised.handledKeys) handledEntryKeys.add(key);
			validationDays.push(...appraised.days);
			if (appraised.expectation != null) expectations.push(appraised.expectation);
		}
		const orphanedEntries = entries.filter(
			(entry) => !handledEntryKeys.has(`${entry.employment_id}:${dateKey(entry.work_date)}`)
		);
		if (orphanedEntries.length > 0) {
			const first = orphanedEntries[0]!;
			refuse(
				`${dateKey(first.work_date)} has an assignment for an employment with no effective terms in this legal entity.`
			);
		}

		const violations = validateRosterSchedule({ days: validationDays, expectations });
		if (violations.length === 0) return;
		const employeeNumberById = new Map(
			employments.map((employment) => [employment.id, employment.employee_number])
		);
		const shown = violations.slice(0, 20);
		const lines = shown.map(
			(violation) =>
				`• ${employeeNumberById.get(violation.employment_id) ?? violation.employment_id}: ${violation.message}`
		);
		const remainder =
			violations.length > shown.length ? `\n…and ${violations.length - shown.length} more.` : '';
		refuse(
			`Roster ${roster.month} cannot be published because ${violations.length} assignment check(s) failed:\n${lines.join('\n')}${remainder}`
		);
	});
}

export default {
	create: {
		perRecord: {
			before: {
				description: 'Requires a YYYY-MM company roster to start as a draft.',
				handler: ({ input }) => {
					if (!MONTH_PATTERN.test(input.month)) {
						refuse(`Roster month must be written YYYY-MM, not "${input.month}".`);
					}
					if (input.published_at != null) {
						refuse('Create the monthly roster as a draft, then publish it after review.');
					}
					return input;
				}
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Pins the legal entity and month, then validates explicit assignments against each employment work pattern before publication.',
				handler: ({ input, existing, api }) => {
					if (input.month != null && input.month !== existing.month) {
						refuse('A roster month cannot be moved after its dated assignments exist.');
					}
					if (input.company_id != null && input.company_id !== existing.company_id) {
						refuse('A monthly roster cannot be moved to another legal entity.');
					}
					// Only the draft → published transition has anything left to validate.
					if (input.published_at == null || existing.published_at != null) {
						return Effect.succeed(input);
					}
					return Effect.as(assertPublishable(api, existing), input);
				}
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Refuses to delete a published monthly roster.',
				handler: ({ existing }) => {
					if (existing.published_at != null) {
						refuse(`Re-open roster ${existing.month} before deleting it.`);
					}
				}
			}
		}
	}
} satisfies Hooks;
