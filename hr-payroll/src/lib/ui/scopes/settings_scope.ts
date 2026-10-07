/**
 * Client-side scoping by jurisdiction settings lineage.
 *
 * A company binds to a lineage by `settings_code`, and every catalogue row (leave catalogue entries, pay
 * components, schemes) belongs to one version of it through `settings_id`. A page that
 * shows an entity's catalogue therefore asks for rows whose version is on the lineage, or whose
 * version is the one in force on a day, as one relationship predicate on the child query rather
 * than a second query for the versions.
 */
import { Schema } from 'effect';

/** A stored range as either the `{ from, to }` period or the bank's `{ start, end }`. */
const StoredRange = Schema.Struct({
	from: Schema.optional(Schema.String),
	to: Schema.optional(Schema.NullOr(Schema.String)),
	start: Schema.optional(Schema.String),
	end: Schema.optional(Schema.NullOr(Schema.String))
});

/** The days a version's `effective_range` governs, both ends inclusive; `to` null is open. */
export function governed(
	range: unknown
): { readonly from: string; readonly to: string | null } | null {
	if (!Schema.is(StoredRange)(range)) return null;
	const from = range.from ?? range.start;
	if (from == null || from === '') return null;
	const to = range.to ?? range.end;
	return { from, to: to == null || to === '' ? null : to };
}

/** Whether a version is sealed and not voided: the only state that governs anything. */
export function is_in_force_candidate(version: {
	readonly sealed_at?: unknown;
	readonly voided_at?: unknown;
	readonly approval_id?: unknown;
}): boolean {
	return version.sealed_at != null && version.voided_at == null && version.approval_id == null;
}

/** Whether a version's period covers a calendar day. */
export function covers_day(range: unknown, day: string): boolean {
	const days = governed(range);
	return days != null && days.from <= day && (days.to == null || day <= days.to);
}

/** Versions newest first by the day they start. */
export function newest_first<V extends { readonly effective_range: unknown }>(
	versions: readonly V[]
): V[] {
	return [...versions].toSorted((left, right) =>
		(governed(right.effective_range)?.from ?? '').localeCompare(
			governed(left.effective_range)?.from ?? ''
		)
	);
}
