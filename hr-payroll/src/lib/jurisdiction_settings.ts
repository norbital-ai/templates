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
 * A locality overlay a base version routes to (`jurisdiction_settings.overlays`): on a day `when`
 * holds, the overlay lineage's version in force replaces the listed `work_rules` parts, its leave
 * rows by code and its tables by name. Schemes never move: they stay with the base.
 */
export type LineageOverlay = {
	readonly lineage: string;
	readonly when: string;
	readonly work_rules: readonly string[];
	readonly authority: string;
};

/** The overlay governing a day and the declaration that routed it. */
export type OverlayHit<V> = { readonly declaration: LineageOverlay; readonly version: V };

/**
 * The overlay version governing `day`, or null where no declaration's `when` holds (the base
 * governs). A day two declarations claim, or routed to a lineage with no version in force, throws:
 * pricing it at the base would apply law the overlay replaces.
 */
export function overlayInForce<V extends SettingsVersionLike>(
	overlays: readonly LineageOverlay[],
	versions: readonly V[],
	day: string,
	holds: (when: string) => boolean
): OverlayHit<V> | null {
	const routed = overlays.filter((overlay) => holds(overlay.when));
	if (routed.length === 0) return null;
	if (routed.length > 1)
		throw new Error(
			`Overlays ${routed.map((overlay) => overlay.lineage).join(', ')} both claim ${day}. Narrow their conditions so one governs.`
		);
	const declaration = routed[0]!;
	const version = settingsInForce(versions, declaration.lineage, day);
	if (version == null)
		throw new Error(
			`${day} is routed to overlay ${declaration.lineage}, which has no sealed version covering it. Seal one before payroll.`
		);
	return { declaration, version };
}

/** A version's tables with the overlay's replacing those of the same name. */
export function overlayTables<T extends { readonly name: string }>(
	base: readonly T[],
	overlay: readonly T[]
): T[] {
	const replaced = new Set(overlay.map((table) => table.name));
	return [...base.filter((table) => !replaced.has(table.name)), ...overlay];
}

/**
 * The base version as an overlay day reads it: the declared `work_rules` parts and the tables the
 * overlay states replace the base's. Everything else, the id included, stays the base's, so the
 * schemes and catalogues keyed to it keep governing.
 */
export function composeOverlay<
	V extends { readonly work_rules: unknown; readonly tables?: unknown; readonly checks?: unknown }
>(base: V, hit: OverlayHit<V>): V {
	const own = hit.version.work_rules as Readonly<Record<string, unknown>>;
	return {
		...base,
		work_rules: {
			...(base.work_rules as Readonly<Record<string, unknown>>),
			...Object.fromEntries(
				hit.declaration.work_rules.filter((key) => key in own).map((key) => [key, own[key]])
			)
		},
		tables: overlayTables(
			(base.tables ?? []) as readonly { readonly name: string }[],
			(hit.version.tables ?? []) as readonly { readonly name: string }[]
		),
		// The overlay's checks replace the base's by code (E9).
		checks: [
			...((base.checks ?? []) as readonly { readonly code: string }[]).filter(
				(check) =>
					!((hit.version.checks ?? []) as readonly { readonly code: string }[]).some(
						(own) => own.code === check.code
					)
			),
			...((hit.version.checks ?? []) as readonly { readonly code: string }[])
		]
	};
}

/**
 * Why an overlay version cannot serve a declaration, or null: it must be another lineage, state
 * every `work_rules` part the declaration replaces, route nowhere itself and own no scheme
 * (national schemes stay with the base lineage). The seal calls this for both sides.
 */
export function overlayFault(
	baseCode: string,
	declaration: LineageOverlay,
	version: {
		readonly code: string;
		readonly work_rules: unknown;
		readonly overlays?: readonly unknown[] | null | undefined;
	},
	schemeCodes: readonly string[]
): string | null {
	if (declaration.lineage === baseCode) return `${baseCode} cannot overlay itself.`;
	if (version.code !== declaration.lineage) return null;
	if (schemeCodes.length > 0)
		return `Overlay ${version.code} declares schemes ${schemeCodes.join(', ')}; schemes stay with ${baseCode}.`;
	if ((version.overlays ?? []).length > 0)
		return `Overlay ${version.code} declares overlays of its own; an overlay does not route further.`;
	const own = Predicate.isObjectOrArray(version.work_rules) ? version.work_rules : {};
	const missing = declaration.work_rules.filter((key) => !(key in own));
	return missing.length === 0
		? null
		: `Overlay ${version.code} does not state work_rules.${missing.join(', work_rules.')}, which ${baseCode} says it replaces.`;
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
