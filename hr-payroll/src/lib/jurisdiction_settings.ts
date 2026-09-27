import { readRange } from '../lib/payroll/run/effective.js';
import { addDays } from '../lib/payroll/run/dates.js';
import { dateKey } from './iso-day.js';
import * as Predicate from 'effect/Predicate';

/**
 * Jurisdiction settings: one sealed, shareable root per lineage.
 *
 * A lineage is a `code` (`MY`, `SG`, or `SG-norbital` where an entity forked the shared law with
 * its own catalogue). A company binds to a lineage through `companies.settings_code`; the versions
 * of the lineage share the code and never overlap once sealed. The version **in force** on a date
 * is the sealed, unvoided version whose period covers it. A period is inclusive (`{ from, to }`):
 * sealing a successor ends its predecessor the day before the successor begins.
 *
 * Everything below is pure over read rows, so the engine's pick, the leave reconciler's pick and
 * the client timeline quote the same selection from the same inputs.
 */

/** The members every reader of a version needs; the rows carry more. */
type SettingsVersionLike = {
	readonly id: string;
	readonly code: string;
	readonly name?: string | null | undefined;
	readonly sealed_at?: unknown | undefined;
	readonly voided_at?: unknown | undefined;
	readonly effective_range: unknown;
	readonly approval_id?: unknown | undefined;
};

/** The days a version governs, both ends inclusive; `to` null is open. */
export type Governed = { readonly from: string; readonly to: string | null };

/**
 * A version's `effective_range` as the days it governs. A 0.0.1 period is `{ from, to }` inclusive.
 */
// ponytail: the bank still carries today's half-open `{ start, end }` (its end is the successor's
// start) and the goldens' fixture reads it raw; drop that branch once both read through `seed/seed.ts`.
export function governed(range: unknown): Governed | null {
	if (!Predicate.isObjectOrArray(range)) return null;
	const period = range as { from?: unknown; to?: unknown };
	if (Predicate.isString(period.from))
		return {
			from: dateKey(period.from),
			to: Predicate.isString(period.to) ? dateKey(period.to) : null
		};
	const bank = readRange(range);
	if (bank == null) return null;
	return {
		from: dateKey(bank.start),
		to: bank.end == null ? null : addDays(dateKey(bank.end), -1)
	};
}

/** Whether a version is sealed and not voided: the only state that governs anything. */
export function isInForceCandidate(version: SettingsVersionLike): boolean {
	return version.sealed_at != null && version.voided_at == null && version.approval_id == null;
}

/** Whether a version's period covers a calendar day. */
export function coversDay(range: unknown, day: string): boolean {
	const days = governed(range);
	return days != null && days.from <= day && (days.to == null || day <= days.to);
}

/** Whether two governed periods share a day. */
export function periodsOverlap(left: Governed, right: Governed): boolean {
	return (right.to == null || left.from <= right.to) && (left.to == null || right.from <= left.to);
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
 * The jurisdiction a lineage transcribes: the first segment of its code. `SG-norbital` is
 * Singapore law with Norbital's own catalogue; the engine's few country-specific rules (the
 * Philippine 313-day divisor, night-work hours) read this and never the whole code.
 */
export function countryOf(code: string): string {
	return code.split('-')[0] ?? code;
}

/** One line naming a version for a refusal: its name, code and the day it was sealed. */
export function describeVersion(version: {
	readonly name?: string | null | undefined;
	readonly code: string;
	readonly sealed_at?: unknown | undefined;
}): string {
	const sealed =
		version.sealed_at == null ? 'a draft' : `sealed on ${dateKey(String(version.sealed_at))}`;
	return `${version.name ?? version.code} (${version.code}, ${sealed})`;
}

/** Versions of one lineage newest first, by the start of their range. */
export function newestFirst<V extends SettingsVersionLike>(versions: readonly V[]): V[] {
	return [...versions].toSorted((left, right) =>
		(governed(right.effective_range)?.from ?? '').localeCompare(
			governed(left.effective_range)?.from ?? ''
		)
	);
}

/** Key-order-insensitive JSON, so two decodings of one custom value compare equal. */
export function stableJson(value: unknown): string {
	if (!Predicate.isObjectOrArray(value)) return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	return `{${Object.entries(value)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, member]) => `${JSON.stringify(key)}:${stableJson(member)}`)
		.join(',')}}`;
}
