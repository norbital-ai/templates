import { DateTime } from 'effect';
import {
	isJsonObject,
	stableJson,
	type Json,
	type JsonObject
} from './payroll_engine/foundation.js';

/**
 * A dated change: from `effective_from`, the values in `patch` are now these. A patch holds only what it changes;
 * `null` takes a value away. A person's, a company's and a law's changes are all read by the one fold below.
 */
export interface Change {
	readonly id: string;
	readonly effective_from: string;
	readonly patch: JsonObject;
}

/** Where a value sits in the folded state: its keys joined, as `subtotal/GROSS/expression` or `rate`. */
const SEP = '/';

/** The values a patch names, by path. A patch is read `depth` keys deep; below that a value is replaced whole. */
export const leaves = (
	patch: JsonObject,
	depth: number,
	prefix = ''
): readonly (readonly [string, Json])[] =>
	Object.entries(patch).flatMap(([key, value]) =>
		depth > 1 && isJsonObject(value)
			? leaves(value, depth - 1, `${prefix}${key}${SEP}`)
			: [[`${prefix}${key}`, value] as const]
	);

const applied = (state: JsonObject, patch: JsonObject, depth: number): JsonObject => {
	const next: Record<string, Json> = { ...state };
	for (const [key, value] of Object.entries(patch)) {
		const held = next[key];
		if (value === null) delete next[key];
		else if (depth > 1 && isJsonObject(value))
			next[key] = applied(isJsonObject(held) ? held : {}, value, depth - 1);
		else next[key] = value;
	}
	return next;
};

const ordered = (rows: readonly Change[]) =>
	rows.toSorted(
		(a, b) => a.effective_from.localeCompare(b.effective_from) || a.id.localeCompare(b.id)
	);

/**
 * What is in force on a day: the changes dated on or before it, applied oldest first. `set_by` names the change that
 * last set each path, so a value wrong since it was set is corrected on that row.
 */
export const inForce = (
	rows: readonly Change[],
	day: string,
	depth = 1
): { readonly state: JsonObject; readonly set_by: Readonly<Record<string, string>> } => {
	let state: JsonObject = {};
	const set_by: Record<string, string> = {};
	for (const row of ordered(rows)) {
		if (row.effective_from > day) break;
		state = applied(state, row.patch, depth);
		for (const [path, value] of leaves(row.patch, depth)) {
			// a key taken away, or replaced above the deepest level, takes everything under it
			if (value === null || path.split(SEP).length < depth)
				for (const known of Object.keys(set_by))
					if (known === path || known.startsWith(`${path}${SEP}`)) delete set_by[known];
			if (value !== null) set_by[path] = row.id;
		}
	}
	return { state, set_by };
};

const dayBefore = (day: string) =>
	DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(day), { days: -1 }));

/**
 * The days a write to one change reaches: from its date (the earlier of old and new when it moves) to the day before
 * the next change that sets one of the same paths, or without end when none does. `before` is absent for a new row and
 * `after` for a deleted one. Only paths `read` answers for count, so a corrected field payroll never reads reaches
 * nothing. `others` are the chain's other changes.
 */
export const reachOf = (
	others: readonly Change[],
	before: Change | undefined,
	after: Change | undefined,
	depth = 1,
	read: (path: string) => boolean = () => true
): { readonly from: string; readonly to: string | null } | undefined => {
	const was = new Map(before === undefined ? [] : leaves(before.patch, depth));
	const now = new Map(after === undefined ? [] : leaves(after.patch, depth));
	const moved = before?.effective_from !== after?.effective_from;
	const paths = [...new Set([...was.keys(), ...now.keys()])].filter(
		(path) =>
			read(path) &&
			(moved ||
				!was.has(path) ||
				!now.has(path) ||
				stableJson(was.get(path)) !== stableJson(now.get(path)))
	);
	if (paths.length === 0) return undefined;
	const dates = [before?.effective_from, after?.effective_from].filter(
		(date): date is string => date !== undefined
	);
	const from = dates.toSorted()[0];
	const last = dates.toSorted().at(-1);
	if (from === undefined || last === undefined) return undefined;
	// a path under a key another change takes away or replaces is set by that change too
	const sets = (row: Change, path: string) =>
		leaves(row.patch, depth).some(
			([other]) =>
				other === path || path.startsWith(`${other}${SEP}`) || other.startsWith(`${path}${SEP}`)
		);
	const ends = paths.map(
		(path) =>
			ordered(others).find((row) => row.effective_from > last && sets(row, path))?.effective_from ??
			null
	);
	const open = ends.some((end) => end === null);
	const end = ends
		.filter((value): value is string => value !== null)
		.toSorted()
		.at(-1);
	return { from, to: open || end === undefined ? null : dayBefore(end) };
};

const put = (state: JsonObject, keys: readonly string[], value: Json | undefined): JsonObject => {
	const [key, ...rest] = keys;
	if (key === undefined) return state;
	const next: Record<string, Json> = { ...state };
	if (rest.length === 0) {
		if (value === undefined) delete next[key];
		else next[key] = value;
		return next;
	}
	const held = next[key];
	const inner = put(isJsonObject(held) ? held : {}, rest, value);
	// a key left holding nothing no longer says anything
	if (value === undefined && Object.keys(inner).length === 0) delete next[key];
	else next[key] = inner;
	return next;
};

/**
 * A correction: the values were always so. Each goes on the change that set it, and one nothing set goes on the first
 * change. A value taken away leaves every change that set it or anything under it. `set_by` is the fold's, on the day
 * being corrected; the answer is the patch each touched change now holds.
 */
export const corrected = (
	rows: readonly Change[],
	set_by: Readonly<Record<string, string>>,
	patch: JsonObject,
	depth = 1
): ReadonlyMap<string, JsonObject> => {
	const first = ordered(rows)[0];
	const held = new Map(rows.map((row) => [row.id, row.patch]));
	const out = new Map<string, JsonObject>();
	const write = (id: string, path: string, value: Json | undefined) =>
		out.set(id, put(out.get(id) ?? held.get(id) ?? {}, path.split(SEP), value));
	for (const [path, value] of leaves(patch, depth)) {
		if (value !== null) {
			const owner = set_by[path] ?? first?.id;
			if (owner !== undefined) write(owner, path, value);
			continue;
		}
		for (const row of rows)
			for (const [other] of leaves(row.patch, depth))
				if (other === path || other.startsWith(`${path}${SEP}`)) write(row.id, other, undefined);
	}
	return out;
};
