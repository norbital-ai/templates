import {
	workPatternSchema,
	type WorkPattern
} from '../../custom-types/work_pattern/+definition.js';

export type EmploymentScheduleTerm = {
	readonly effective_range?: unknown;
	readonly work_pattern?: unknown;
};

export type EmploymentSchedule =
	| {
			readonly state: 'current' | 'next';
			readonly effectiveRange: unknown;
			readonly summary: string;
	  }
	| { readonly state: 'missing' };

type Range = { readonly start: string; readonly end: string | null };

function rangeOf(value: unknown): Range | null {
	if (value == null || typeof value !== 'object') return null;
	const start = Reflect.get(value, 'start');
	const end = Reflect.get(value, 'end');
	if (typeof start !== 'string' || start.length === 0) return null;
	return { start, end: typeof end === 'string' && end.length > 0 ? end : null };
}

function isEffectiveOn(range: Range, date: string): boolean {
	return range.start.slice(0, 10) <= date && (range.end == null || range.end.slice(0, 10) >= date);
}

function summarizePattern(pattern: WorkPattern): string {
	if (pattern.type === 'ROSTERED') {
		if (pattern.expectation.kind === 'AS_ASSIGNED') {
			return pattern.expectation.maximum_paid_minutes == null
				? 'Roster-assigned · as assigned'
				: `Roster-assigned · up to ${pattern.expectation.maximum_paid_minutes / 60}h/${pattern.expectation.period.toLowerCase()}`;
		}
		return `Roster-assigned · ${pattern.expectation.required_work_days}d · ${pattern.expectation.required_paid_minutes / 60}h/${pattern.expectation.period.toLowerCase()}`;
	}

	const continuous =
		pattern.phases.length === 1 && pattern.phases[0]?.duration.kind === 'CONTINUOUS';
	if (continuous) {
		const days = pattern.phases[0]?.day_cycle.length ?? 0;
		return `Patterned · ${days}-day cycle · starts ${pattern.anchor_date}`;
	}
	return `Patterned · ${pattern.phases.length} calendar phases · starts ${pattern.anchor_date}`;
}

/**
 * Select the one effective work pattern for an employment without flattening its term history.
 *
 * `employment_terms_no_overlap` guarantees at most one current term. A future successor is useful
 * context, but an expired term is intentionally not presented as the person's current schedule.
 */
export function employmentScheduleOn(
	terms: readonly EmploymentScheduleTerm[],
	date: string
): EmploymentSchedule {
	const candidates = terms.flatMap((term) => {
		const range = rangeOf(term.effective_range);
		const parsed = workPatternSchema.safeParse(term.work_pattern);
		return range == null || !parsed.success ? [] : [{ range, pattern: parsed.data }];
	});
	const current = candidates.find((candidate) => isEffectiveOn(candidate.range, date));
	if (current) {
		return {
			state: 'current',
			effectiveRange: current.range,
			summary: summarizePattern(current.pattern)
		};
	}
	const next = candidates
		.filter((candidate) => candidate.range.start.slice(0, 10) > date)
		.toSorted((left, right) => left.range.start.localeCompare(right.range.start))[0];
	if (next) {
		return {
			state: 'next',
			effectiveRange: next.range,
			summary: summarizePattern(next.pattern)
		};
	}
	return { state: 'missing' };
}
