import { readRange } from '../collections/payroll_runs/lib/effective.js';
import { dateKey } from './iso-day.js';

/**
 * Jurisdiction settings: one sealed, shareable root per lineage.
 *
 * A lineage is a `code` (`MY`, `SG`, or `SG-norbital` where an entity forked the shared law with
 * its own catalogue). A company binds to a lineage through `companies.settings_code`; the versions
 * of the lineage share the code and never overlap once sealed. The version **in force** on a date
 * is the sealed, unvoided version whose effective range covers it, read half-open (`[start, end)`,
 * the same reading the `jurisdiction_settings_sealed_no_overlap` exclusion makes), so a successor
 * that starts on the day its predecessor ends is adjacent, not overlapping.
 *
 * Everything below is pure over read rows, so the engine's pick, the leave reconciler's pick and
 * the client timeline quote the same selection from the same inputs.
 */

/** The members every reader of a version needs; the rows carry more. */
type SettingsVersionLike = {
	readonly id: string;
	readonly code: string;
	readonly name?: string | null;
	readonly sealed_at?: string | null;
	readonly voided_at?: string | null;
	readonly effective_range: unknown;
	readonly approval_id?: string | null;
};

/** Whether a version is sealed and not voided: the only state that governs anything. */
export function isInForceCandidate(version: SettingsVersionLike): boolean {
	return version.sealed_at != null && version.voided_at == null && version.approval_id == null;
}

/** Whether a half-open `[start, end)` day range covers a calendar day. */
export function coversDay(range: unknown, day: string): boolean {
	const parsed = readRange(range);
	if (parsed == null) return false;
	const start = dateKey(parsed.start);
	const end = parsed.end == null ? null : dateKey(parsed.end);
	return start <= day && (end == null || day < end);
}

/**
 * Whether two `[start, end)` day ranges share a day: the same half-open reading as the
 * `bolt_daterange` the database exclusion compares.
 */
export function halfOpenOverlap(
	left: { readonly start: string; readonly end: string | null },
	right: { readonly start: string; readonly end: string | null }
): boolean {
	const leftEnd = left.end == null ? null : dateKey(left.end);
	const rightEnd = right.end == null ? null : dateKey(right.end);
	return (
		(rightEnd == null || dateKey(left.start) < rightEnd) &&
		(leftEnd == null || dateKey(right.start) < leftEnd)
	);
}

/**
 * The version of one lineage in force on a day, or null when none is. Two candidates covering one
 * day is the overlap the exclusion keeps out of the database, and it throws by name rather than
 * pick one.
 */
export function settingsInForce<V extends SettingsVersionLike>(
	versions: readonly V[],
	code: string,
	day: string
): V | null {
	const covering = versions.filter(
		(version) =>
			version.code === code &&
			isInForceCandidate(version) &&
			coversDay(version.effective_range, day)
	);
	if (covering.length === 0) return null;
	if (covering.length > 1)
		throw new Error(
			`Sealed ${code} settings versions ${covering
				.map((version) => version.name ?? version.id)
				.join(
					', '
				)} overlap on ${day}. Void or end every version but one before payroll can pick one.`
		);
	return covering[0] ?? null;
}

/**
 * The treatment grid an entry pinned to an older revision of a code is charged under.
 *
 * A shared code survives catalogue revisions. Every cell the entry's own revision decided stands —
 * including an explicit `UNSET`, which is a decision and not a gap — because an approved entry's
 * treatment is history and a later revision does not get to re-decide it. But a scheme sealed into
 * a later version has no cell in that older row to keep, since it did not exist when the row was
 * written; the run resolves the schemes it levies, so the run's own row of the same code supplies
 * those. A code neither row decides stays absent, and ACCUMULATE still refuses it by name.
 */
export function treatmentsInForce<TGrid extends Readonly<Record<string, unknown>>>(
	source: TGrid,
	current: TGrid | undefined
): TGrid {
	return current == null ? source : ({ ...current, ...source } as TGrid);
}

/**
 * The jurisdiction a lineage transcribes: the first segment of its code. `SG-norbital` is
 * Singapore law with Norbital's own catalogue; the engine's few country-specific rules (the
 * Philippine 313-day divisor, night-work hours) read this and never the whole code.
 */
export function countryOf(code: string): string {
	return code.split('-')[0] ?? code;
}

/** One line naming a version for a refusal: its name, code and the day it was sealed. */
export function describeVersion(version: {
	readonly name?: string | null;
	readonly code: string;
	readonly sealed_at?: string | null;
}): string {
	const sealed = version.sealed_at == null ? 'a draft' : `sealed on ${dateKey(version.sealed_at)}`;
	return `${version.name ?? version.code} (${version.code}, ${sealed})`;
}

/** Versions of one lineage newest first, by the start of their range. */
export function newestFirst<V extends SettingsVersionLike>(versions: readonly V[]): V[] {
	return [...versions].toSorted((left, right) =>
		String(readRange(right.effective_range)?.start ?? '').localeCompare(
			String(readRange(left.effective_range)?.start ?? '')
		)
	);
}

/** Key-order-insensitive JSON, so two decodings of one custom value compare equal. */
export function stableJson(value: unknown): string {
	if (value == null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	return `{${Object.entries(value)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, member]) => `${JSON.stringify(key)}:${stableJson(member)}`)
		.join(',')}}`;
}
