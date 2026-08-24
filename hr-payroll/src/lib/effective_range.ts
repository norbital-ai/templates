import { Effect, Schema } from 'effect';
import type { StoredRange } from '../collections/payroll_runs/lib/effective.js';

/**
 * Effective-range helpers shared by every effective-dated configuration collection.
 *
 * `effective_range` is a `custom('instant_range', { precision: 'day' })` column: JSONB `{ start, end }` holding UTC ISO instants,
 * NOT a Postgres range type. Overlap therefore cannot be enforced by an `EXCLUDE USING gist`
 * constraint and is checked here, in `create.before` / `update.before` hooks.
 */

/** A row of any effective-dated collection, as far as the overlap check is concerned. */
const effectiveDatedRowSchema = Schema.Struct({
	id: Schema.String,
	effective_range: Schema.optional(Schema.Unknown)
});
type EffectiveDatedRow = Schema.Schema.Type<typeof effectiveDatedRowSchema>;

/** The inputs the overlap check needs, as one shape so the two call sites cannot disagree. */
const overlapCheckSchema = Schema.Struct({
	candidate: Schema.Unknown,
	existing: Schema.Array(effectiveDatedRowSchema),
	/** Human-readable identity key, used in the error message. */
	identity: Schema.String,
	/** The row being updated, which must not conflict with itself. */
	excludeId: Schema.optional(Schema.NullOr(Schema.String))
});
type OverlapCheck = Schema.Schema.Type<typeof overlapCheckSchema>;

function instant(value: string, what: string): number {
	const milliseconds = Date.parse(value);
	if (Number.isNaN(milliseconds)) {
		throw new Error(`${what} is not a valid ISO instant: "${value}".`);
	}
	return milliseconds;
}

/** Validate and normalise a raw `effective_range` value. */
function parseEffectiveRange(value: unknown, what = 'effective_range'): StoredRange {
	if (value == null || typeof value !== 'object') {
		throw new Error(`${what} is required.`);
	}
	const start = Reflect.get(value, 'start');
	const end = Reflect.get(value, 'end');
	if (typeof start !== 'string' || start === '') {
		throw new Error(`${what}.start is required.`);
	}
	if (end != null && typeof end !== 'string') {
		throw new Error(`${what}.end must be an ISO instant or null.`);
	}
	const normalizedEnd = end == null || end === '' ? null : end;
	if (
		normalizedEnd !== null &&
		instant(normalizedEnd, `${what}.end`) <= instant(start, `${what}.start`)
	) {
		throw new Error(`${what}.end must be after ${what}.start.`);
	}
	return { start, end: normalizedEnd };
}

/** `[aStart, aEnd)` and `[bStart, bEnd)` overlap iff `aStart < bEnd && bStart < aEnd`. */
function rangesOverlap(a: StoredRange, b: StoredRange): boolean {
	const aStart = instant(a.start, 'effective_range.start');
	const bStart = instant(b.start, 'effective_range.start');
	const aEnd = a.end === null ? Number.POSITIVE_INFINITY : instant(a.end, 'effective_range.end');
	const bEnd = b.end === null ? Number.POSITIVE_INFINITY : instant(b.end, 'effective_range.end');
	return aStart < bEnd && bStart < aEnd;
}

/**
 * Throw when the candidate range overlaps any of `existing`.
 *
 * `existing` must already be narrowed to the rows sharing the candidate's identity key —
 * scalar parts via the database query, variant/JSONB parts by filtering in TypeScript.
 */
export function assertNoOverlap(options: OverlapCheck): void {
	const candidate = parseEffectiveRange(options.candidate, `${options.identity}: effective_range`);
	for (const row of options.existing) {
		if (options.excludeId != null && row.id === options.excludeId) continue;
		const other = parseEffectiveRange(row.effective_range);
		if (rangesOverlap(candidate, other)) {
			throw new Error(
				`Effective range ${candidate.start} → ${candidate.end ?? '∞'} overlaps an existing row ` +
					`for ${options.identity} (${other.start} → ${other.end ?? '∞'}). ` +
					`End-date the existing row and insert a successor instead of overlapping it.`
			);
		}
	}
}

/**
 * Read the siblings that share an exclusion key, assert the candidate range clears them, and hand
 * the input straight back.
 *
 * Every effective-dated catalogue runs this same `before` shape and differs only in which column
 * scopes the code and what a row is called in the message. Those two are arguments; the shape is
 * stated once, here.
 */
export function guardEffectiveRange<Input, E, R>(
	siblings: Effect.Effect<ReadonlyArray<EffectiveDatedRow>, E, R>,
	candidate: unknown,
	identity: string,
	input: Input,
	excludeId?: string
): Effect.Effect<Input, E, R> {
	return Effect.map(siblings, (existing) => {
		assertNoOverlap({ candidate, existing, identity, excludeId });
		return input;
	});
}

/**
 * Whether a stored `effective_range` is in force on a calendar day, keyed by the day head of each
 * bound. Both ends inclusive; an absent end is open.
 *
 * This is the day-head comparison the app pages make, not the timezone-resolved one
 * `payroll_runs/lib/effective.ts` makes for pricing. Keeping the two apart is deliberate: a list
 * filter reads the stored text, a rate lookup resolves the instant.
 */
export function inForceOnDay(
	range: Readonly<{ start?: string | null; end?: string | null }> | null | undefined,
	day: string
): boolean {
	if (range?.start == null) return false;
	if (range.start.slice(0, 10) > day) return false;
	return range.end == null || range.end.slice(0, 10) >= day;
}
