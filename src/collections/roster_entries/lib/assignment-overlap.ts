import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { RosterCodeVariant } from '../../../datatypes/roster_code_variant/+definition.js';
import { dateKey } from '../../../lib/iso-day.js';
import { rosterCodeKind, workWindow } from '../../../lib/scheduling/roster-code.js';
import { patternRosterCodeId } from '../../../lib/scheduling/work-pattern.js';
import { coversDate } from '../../payroll_runs/lib/effective.js';
import {
	overlappingWorkShifts,
	type ValidationDay
} from '../../rosters/lib/workforce-validation.js';
import type { Api, WorkspaceRow } from '../$types.js';

const QUERY_LIMIT = 20_000;
const DAY_MS = 86_400_000;

type ExplicitEntry = Pick<
	WorkspaceRow<'roster_entries'>,
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
type AssignmentChange = Pick<WorkspaceRow<'roster_entries'>, 'employment_id' | 'work_date'> & {
	readonly shift_definition_id: string | null;
	readonly existing_id?: string;
};

/**
 * Everything the overlap rule reads, for however many changes it is asked about at once.
 *
 * The rule is about one employment's three-day neighbourhood, but the *reads* are the same four
 * queries whether they answer for one row or three thousand — which is exactly the split `prepare`
 * exists for. A published month is written a whole month at a time, so asking per row cost four
 * round trips a row.
 */
export type OverlapData = {
	readonly termsByEmployment: ReadonlyMap<
		string,
		ReadonlyArray<Pick<WorkspaceRow<'employment_terms'>, 'work_pattern' | 'effective_range'>>
	>;
	readonly explicitByKey: ReadonlyMap<string, ExplicitEntry>;
	readonly codeById: ReadonlyMap<
		string,
		{ readonly code: string; readonly variant: RosterCodeVariant }
	>;
};

function addDays(date: string, amount: number): string {
	return new Date(Date.parse(`${date}T00:00:00.000Z`) + amount * DAY_MS).toISOString().slice(0, 10);
}

/** The four reads. Data only — every refusal below is `assertNoOverlap`'s. */
export function readOverlapData(
	api: Api,
	changes: readonly AssignmentChange[]
): Effect.Effect<OverlapData, never, never> {
	return Effect.gen(function* () {
		const employmentIds = [...new Set(changes.map((change) => change.employment_id))];
		const changedDates = changes.map((change) => dateKey(change.work_date));
		const first = addDays(changedDates.toSorted()[0]!, -1);
		const last = addDays(changedDates.toSorted().at(-1)!, 1);
		const [employments, terms, existingEntries] = yield* Effect.all(
			[
				api.db.employments.findMany({
					where: { id: { in: employmentIds } },
					columns: { id: true, company_id: true },
					limit: Math.max(1, employmentIds.length)
				}),
				api.db.employment_terms.findMany({
					where: { employment_id: { in: employmentIds } },
					columns: { employment_id: true, work_pattern: true, effective_range: true },
					limit: QUERY_LIMIT
				}),
				api.db.roster_entries.findMany({
					where: {
						employment_id: { in: employmentIds },
						work_date: { gte: first, lte: last }
					},
					columns: {
						id: true,
						employment_id: true,
						work_date: true,
						shift_definition_id: true
					},
					limit: QUERY_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		if (terms.length === QUERY_LIMIT || existingEntries.length === QUERY_LIMIT) {
			refuse('This schedule is too large to validate safely in one write.');
		}
		const companyIds = [...new Set(employments.map((employment) => employment.company_id))];
		const codes = yield* api.db.shift_definitions.findMany({
			where: { company_id: { in: companyIds } },
			columns: { id: true, code: true, variant: true },
			limit: QUERY_LIMIT
		});
		if (codes.length === QUERY_LIMIT) {
			refuse('This legal entity has too many roster codes to validate safely.');
		}

		const termsByEmployment = new Map<string, Array<(typeof terms)[number]>>();
		for (const term of terms) {
			const bucket = termsByEmployment.get(term.employment_id);
			if (bucket) bucket.push(term);
			else termsByEmployment.set(term.employment_id, [term]);
		}
		return {
			termsByEmployment,
			explicitByKey: new Map(
				existingEntries.map((entry) => [
					`${entry.employment_id}:${dateKey(entry.work_date)}`,
					{
						id: entry.id,
						employment_id: entry.employment_id,
						work_date: dateKey(entry.work_date),
						shift_definition_id: entry.shift_definition_id
					}
				])
			),
			codeById: new Map(codes.map((code) => [code.id, code]))
		};
	});
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
			const codeId =
				explicit?.shift_definition_id ??
				(term == null ? null : patternRosterCodeId(term.work_pattern, date));
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

/**
 * Read, then decide — for the two paths that have no batch to read for.
 *
 * `update` and `delete` are authored for one existing record and the platform gives them no view of
 * the call they arrived in, so they pay their own four reads. The decision is `assertNoOverlap`'s
 * either way; only where its data comes from differs.
 */
export function assertNoOverlappingAssignments(
	api: Api,
	changes: readonly AssignmentChange[]
): Effect.Effect<void, never, never> {
	if (changes.length === 0) return Effect.void;
	return Effect.map(readOverlapData(api, changes), (data) => assertNoOverlap(data, changes));
}
