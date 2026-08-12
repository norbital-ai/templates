import { workPatternSchema } from '../../custom-types/work_pattern/+definition.js';
import { monthBounds } from '../../lib/period.js';
import { rosterCodeKind, workWindow } from '../../lib/scheduling/roster-code.js';
import { patternRosterCodeId } from '../../lib/scheduling/work-pattern.js';
import {
	validateRosterSchedule,
	type ValidationDay,
	type ValidationShift,
	type WorkloadExpectation
} from './lib/workforce-validation.js';
import type { HookApi, Hooks } from './$types.js';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const QUERY_LIMIT = 20_000;
const DAY_MS = 86_400_000;

function dateKey(value: string | Date): string {
	return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): string[] {
	const first = Date.parse(`${start}T00:00:00.000Z`);
	const last = Date.parse(`${end}T00:00:00.000Z`);
	return Array.from({ length: Math.floor((last - first) / DAY_MS) + 1 }, (_value, index) =>
		new Date(first + index * DAY_MS).toISOString().slice(0, 10)
	);
}

function rangeIntersection(
	range: { readonly start?: string; readonly end?: string } | null,
	bounds: { readonly start: string; readonly end: string }
): { start: string; end: string } | null {
	if (range?.start == null) return null;
	const start = dateKey(range.start) > bounds.start ? dateKey(range.start) : bounds.start;
	const rawEnd = range.end == null ? bounds.end : dateKey(range.end);
	const end = rawEnd < bounds.end ? rawEnd : bounds.end;
	return start <= end ? { start, end } : null;
}

function rangeCovers(
	range: { readonly start?: string; readonly end?: string } | null,
	date: string
): boolean {
	if (range?.start == null) return false;
	return date >= dateKey(range.start) && (range.end == null || date <= dateKey(range.end));
}

async function assertPublishable(
	api: HookApi,
	roster: { readonly norbital_id: string; readonly company_id: string; readonly month: string }
): Promise<void> {
	const bounds = monthBounds(roster.month);
	const [entries, employments, codes] = await Promise.all([
		api.db.query.roster_entries.findMany({
			where: { roster_id: { eq: roster.norbital_id } },
			limit: QUERY_LIMIT
		}),
		api.db.query.employments.findMany({
			where: { company_id: { eq: roster.company_id } },
			columns: { norbital_id: true, employee_number: true, effective_range: true },
			limit: QUERY_LIMIT
		}),
		api.db.query.shift_definitions.findMany({
			where: { company_id: { eq: roster.company_id } },
			columns: {
				norbital_id: true,
				code: true,
				variant: true,
				effective_range: true
			},
			limit: QUERY_LIMIT
		})
	]);
	if ([entries, employments, codes].some((rows) => rows.length === QUERY_LIMIT)) {
		throw new Error(`Roster ${roster.month} is too large to validate in one page.`);
	}
	const employmentIds = employments
		.filter((employment) => rangeIntersection(employment.effective_range, bounds) != null)
		.map((employment) => employment.norbital_id);
	const terms =
		employmentIds.length === 0
			? []
			: await api.db.query.employment_terms.findMany({
					where: { employment_id: { in: employmentIds } },
					columns: { employment_id: true, work_pattern: true, effective_range: true },
					limit: QUERY_LIMIT
				});
	if (terms.length === QUERY_LIMIT) {
		throw new Error(`Roster ${roster.month} has too many effective-dated terms to validate.`);
	}

	const codeById = new Map(codes.map((code) => [code.norbital_id, code]));
	const entryByKey = new Map(
		entries.map((entry) => [`${entry.employment_id}:${dateKey(entry.work_date)}`, entry])
	);
	const validationDays: ValidationDay[] = [];
	const expectations: WorkloadExpectation[] = [];
	const handledEntryKeys = new Set<string>();

	for (const term of terms) {
		const active = rangeIntersection(term.effective_range, bounds);
		if (active == null) continue;
		const pattern = workPatternSchema.parse(term.work_pattern);
		const activeDates = daysBetween(active.start, active.end);
		let expectedWorkDays = 0;
		let expectedPaidMinutes = 0;

		for (const date of activeDates) {
			const entryKey = `${term.employment_id}:${date}`;
			const entry = entryByKey.get(entryKey);
			if (entry != null) handledEntryKeys.add(entryKey);
			const projectedId = pattern.type === 'PATTERNED' ? patternRosterCodeId(pattern, date) : null;
			const codeId = entry?.shift_definition_id ?? projectedId;
			const code = codeId == null ? null : codeById.get(codeId);
			if (codeId != null && code == null) {
				throw new Error(
					`${date} names a roster code that is missing or belongs to another entity.`
				);
			}
			if (code != null && !rangeCovers(code.effective_range, date)) {
				throw new Error(`Roster code ${code.code} is not effective on ${date}.`);
			}
			if (pattern.type === 'PATTERNED') {
				const projected = projectedId == null ? null : codeById.get(projectedId);
				if (projected == null) throw new Error(`${date} projects an unknown roster code.`);
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
			validationDays.push({
				employment_id: term.employment_id,
				work_date: date,
				designation: kind,
				shift
			});
		}

		if (pattern.type === 'PATTERNED') {
			expectations.push({
				employment_id: term.employment_id,
				start_date: active.start,
				end_date: active.end,
				kind: 'EXACT',
				work_days: expectedWorkDays,
				paid_minutes: expectedPaidMinutes
			});
			continue;
		}
		const expectation = pattern.expectation;
		const referenceDays =
			expectation.period === 'WEEK' ? 7 : daysBetween(bounds.start, bounds.end).length;
		const fraction = activeDates.length / referenceDays;
		if (expectation.kind === 'GUARANTEED_SCHEDULE') {
			expectations.push({
				employment_id: term.employment_id,
				start_date: active.start,
				end_date: active.end,
				kind: 'MINIMUM',
				work_days: Math.ceil(expectation.required_work_days * fraction),
				paid_minutes: Math.ceil(expectation.required_paid_minutes * fraction)
			});
		} else if (expectation.maximum_paid_minutes != null) {
			expectations.push({
				employment_id: term.employment_id,
				start_date: active.start,
				end_date: active.end,
				kind: 'MAXIMUM',
				work_days: null,
				paid_minutes: Math.floor(expectation.maximum_paid_minutes * fraction)
			});
		}
	}
	const orphanedEntries = entries.filter(
		(entry) => !handledEntryKeys.has(`${entry.employment_id}:${dateKey(entry.work_date)}`)
	);
	if (orphanedEntries.length > 0) {
		const first = orphanedEntries[0]!;
		throw new Error(
			`${dateKey(first.work_date)} has an assignment for an employment with no effective terms in this legal entity.`
		);
	}

	const violations = validateRosterSchedule({ days: validationDays, expectations });
	if (violations.length === 0) return;
	const employeeNumberById = new Map(
		employments.map((employment) => [employment.norbital_id, employment.employee_number])
	);
	const shown = violations.slice(0, 20);
	const lines = shown.map(
		(violation) =>
			`• ${employeeNumberById.get(violation.employment_id) ?? violation.employment_id}: ${violation.message}`
	);
	const remainder =
		violations.length > shown.length ? `\n…and ${violations.length - shown.length} more.` : '';
	throw new Error(
		`Roster ${roster.month} cannot be published because ${violations.length} assignment check(s) failed:\n${lines.join('\n')}${remainder}`
	);
}

export default {
	create: {
		before: {
			description: 'Requires a YYYY-MM company roster to start as a draft.',
			handler: async ({ input }) => {
				if (!MONTH_PATTERN.test(input.month)) {
					throw new Error(`Roster month must be written YYYY-MM, not "${input.month}".`);
				}
				if (input.published_at != null) {
					throw new Error('Create the monthly roster as a draft, then publish it after review.');
				}
				return input;
			}
		}
	},
	update: {
		before: {
			description:
				'Pins the legal entity and month, then validates explicit assignments against each employment work pattern before publication.',
			handler: async ({ input, existing, api }) => {
				if (input.month != null && input.month !== existing.month) {
					throw new Error('A roster month cannot be moved after its dated assignments exist.');
				}
				if (input.company_id != null && input.company_id !== existing.company_id) {
					throw new Error('A monthly roster cannot be moved to another legal entity.');
				}
				if (input.published_at != null && existing.published_at == null) {
					await assertPublishable(api, existing);
				}
				return input;
			}
		}
	},
	delete: {
		before: {
			description: 'Refuses to delete a published monthly roster.',
			handler: async ({ existing }) => {
				if (existing.published_at != null) {
					throw new Error(`Re-open roster ${existing.month} before deleting it.`);
				}
			}
		}
	}
} satisfies Hooks;
