/**
 * Two WORK windows must not occupy the same real minute — across days, not only within one.
 *
 * `unique(employment_id, work_date)` is the *other* rule and it does a different job: it stops two
 * rows describing one person-day. It says nothing at all about a night shift that ends at 05:30
 * running into the next morning's 05:00 start, because those are two legitimate rows on two
 * different days. That is the collision this module refuses, and it is why every read below spans
 * day-1, day and day+1.
 *
 * A `work_days` row with no `shift_definition_id` is attendance on an unplanned day. It carries no
 * assignment, so the pattern baseline decides that day exactly as it does for a day with no row at
 * all — which the `??` below already expresses, and is why the read is not filtered to planned rows.
 */
import { refuse } from '@norbital-ai/bolt/authoring';
import type { RosterCodeVariant } from '../../../datatypes/roster_code_variant/+definition.js';
import { dateKey } from '../../../lib/iso-day.js';
import { rosterCodeKind, workWindow } from '../../../lib/scheduling/roster-code.js';
import {
	patternAnchor,
	patternRosterCodeId,
	termPatternRow,
	type ShiftPatternLike
} from '../../../lib/scheduling/work-pattern.js';
import { coversDate } from '../../payroll_runs/lib/effective.js';
import {
	overlappingWorkShifts,
	type ValidationDay
} from '../../../lib/scheduling/workforce-validation.js';
import type { WorkspaceRow } from '../$types.js';
import { addDays } from '../../payroll_runs/lib/dates.js';

type ExplicitEntry = Pick<
	WorkspaceRow<'work_days'>,
	'id' | 'employment_id' | 'shift_definition_id'
> & {
	/** The normalized YYYY-MM-DD key of `work_date`, so every comparison is one day form. */
	readonly work_date: string;
};

/**
 * The difference one roster-assignment write makes to the board.
 *
 * `shift_definition_id` of null means the explicit override is being removed and the pattern
 * baseline resumes; `existing_id` names the stored row when the change is an update.
 */
type AssignmentChange = Pick<WorkspaceRow<'work_days'>, 'employment_id' | 'work_date'> & {
	readonly shift_definition_id: string | null;
	readonly existing_id?: string;
};

/**
 * Everything the overlap rule reads, for however many changes it is asked about at once.
 *
 * The rule is about one employment's three-day neighbourhood, but the *reads* are the same
 * whether they answer for one row or three thousand: the transform reads them once for the batch
 * and this holds them.
 */
type OverlapData = {
	readonly termsByEmployment: ReadonlyMap<
		string,
		ReadonlyArray<Pick<WorkspaceRow<'employment_terms'>, 'shift_pattern_id' | 'effective_range'>>
	>;
	/** The named patterns of every company touched, which the terms' pointers resolve through. */
	readonly patternById: ReadonlyMap<string, ShiftPatternLike>;
	readonly explicitByKey: ReadonlyMap<string, ExplicitEntry>;
	readonly codeById: ReadonlyMap<
		string,
		{ readonly code: string; readonly variant: RosterCodeVariant }
	>;
};

/** The overlap data, built from rows the transform already holds. Data only — every refusal below is `assertNoOverlap`'s. */
export function overlapDataFrom(rows: {
	readonly terms: ReadonlyArray<
		Pick<WorkspaceRow<'employment_terms'>, 'employment_id' | 'shift_pattern_id' | 'effective_range'>
	>;
	readonly entries: ReadonlyArray<
		Pick<WorkspaceRow<'work_days'>, 'id' | 'employment_id' | 'work_date' | 'shift_definition_id'>
	>;
	readonly codes: ReadonlyArray<{
		readonly id: string;
		readonly code: string;
		readonly variant: RosterCodeVariant;
	}>;
	readonly patterns: ReadonlyArray<ShiftPatternLike & { readonly id: string }>;
}): OverlapData {
	return {
		termsByEmployment: Map.groupBy(rows.terms, (term) => term.employment_id),
		patternById: new Map(rows.patterns.map((pattern) => [pattern.id, pattern])),
		explicitByKey: new Map(
			rows.entries.map((entry) => [
				`${entry.employment_id}:${dateKey(entry.work_date)}`,
				{
					id: entry.id,
					employment_id: entry.employment_id,
					work_date: dateKey(entry.work_date),
					shift_definition_id: entry.shift_definition_id
				}
			])
		),
		codeById: new Map(rows.codes.map((code) => [code.id, code]))
	};
}

/** Reject a draft write that would make two WORK windows occupy the same real minute. */
export function assertNoOverlap(data: OverlapData, changes: readonly AssignmentChange[]): void {
	if (changes.length === 0) return;
	const removedIds = new Set(
		changes.flatMap((change) => (change.existing_id ? [change.existing_id] : []))
	);
	// The changes overlay the stored day, exactly as the single-shot version did by mutating its own
	// copy of the map. Reading through an overlay rather than rebuilding it keeps this O(changes)
	// instead of O(batch × stored entries) when it is called once per record.
	const overlay = new Map<string, ExplicitEntry | null>();
	for (const change of changes) {
		const key = `${change.employment_id}:${dateKey(change.work_date)}`;
		overlay.set(
			key,
			change.shift_definition_id == null
				? null
				: {
						id: change.existing_id ?? '',
						employment_id: change.employment_id,
						work_date: dateKey(change.work_date),
						shift_definition_id: change.shift_definition_id
					}
		);
	}
	const explicitAt = (key: string): ExplicitEntry | undefined => {
		if (overlay.has(key)) return overlay.get(key) ?? undefined;
		const stored = data.explicitByKey.get(key);
		return stored != null && removedIds.has(stored.id) ? undefined : stored;
	};

	const datesByEmployment = new Map<string, Set<string>>();
	for (const change of changes) {
		const date = dateKey(change.work_date);
		const bucket = datesByEmployment.get(change.employment_id) ?? new Set<string>();
		bucket.add(addDays(date, -1));
		bucket.add(date);
		bucket.add(addDays(date, 1));
		datesByEmployment.set(change.employment_id, bucket);
	}

	const days: ValidationDay[] = [];
	for (const [employmentId, dates] of datesByEmployment) {
		for (const date of dates) {
			const explicit = explicitAt(`${employmentId}:${date}`);
			const term = (data.termsByEmployment.get(employmentId) ?? []).find((candidate) =>
				coversDate(candidate.effective_range, date)
			);
			const patternRow = term == null ? null : termPatternRow(term, data.patternById);
			const codeId =
				explicit?.shift_definition_id ??
				patternRosterCodeId(patternRow?.pattern ?? null, date, patternAnchor(patternRow));
			const code = codeId == null ? null : data.codeById.get(codeId);
			const kind = code == null ? null : rosterCodeKind(code.variant);
			const window = kind === 'WORK' ? workWindow(code?.variant) : null;
			days.push({
				employment_id: employmentId,
				work_date: date,
				designation: kind,
				shift:
					window == null || code == null
						? null
						: {
								code: code.code,
								start_time: window.start_time,
								end_time: window.end_time,
								break_minutes: window.break_minutes
							}
			});
		}
	}
	const [overlap] = overlappingWorkShifts(days);
	if (overlap != null) {
		refuse(
			`${overlap.first.work_date} ${overlap.first.shift?.code ?? 'WORK'} overlaps ${overlap.second.work_date} ${overlap.second.shift?.code ?? 'WORK'} for this employment.`
		);
	}
}
