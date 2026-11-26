import { DateTime } from 'effect';
import { isJsonObject, stableJson, type Json, type JsonObject } from './foundation.js';

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

/**
 * How deep a patch is read: so many keys, or whether the value at a path is read key by key. Below that a value is
 * replaced whole.
 */
export type Depth = number | ((path: readonly string[]) => boolean);
/** Whether the value at `path` is read key by key. */
export const opens = (depth: Depth, path: readonly string[]) =>
	typeof depth === 'number' ? path.length < depth : depth(path);
/** How many of a path's keys reach the value a patch replaces whole: the rest name a part of that value. */
export const leafLength = (depth: Depth, path: readonly string[]): number => {
	for (let length = 1; length < path.length; length++)
		if (!opens(depth, path.slice(0, length))) return length;
	return path.length;
};

/** The values a patch names, by path. A patch is read as deep as `depth` says; below that a value is replaced whole. */
export const leaves = (
	patch: JsonObject,
	depth: Depth,
	prefix: readonly string[] = []
): readonly (readonly [string, Json])[] =>
	Object.entries(patch).flatMap(([key, value]) =>
		isJsonObject(value) && opens(depth, [...prefix, key])
			? leaves(value, depth, [...prefix, key])
			: [[[...prefix, key].join(SEP), value] as const]
	);

/**
 * The patch that turns `before` into `after`, both whole documents: a changed value whole, a value gone as `null`.
 * Read as deep as the document is folded, so what the edit left alone is not restated.
 */
export const patchOf = (
	before: JsonObject,
	after: JsonObject,
	depth: Depth,
	prefix: readonly string[] = []
): JsonObject =>
	Object.fromEntries(
		[...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(
			(key): (readonly [string, Json])[] => {
				const was = before[key];
				const now = after[key];
				if (now === undefined || now === null)
					return was === undefined || was === null ? [] : [[key, null]];
				if (isJsonObject(now) && opens(depth, [...prefix, key])) {
					const inner = patchOf(isJsonObject(was) ? was : {}, now, depth, [...prefix, key]);
					return Object.keys(inner).length === 0 ? [] : [[key, inner]];
				}
				return stableJson(was) === stableJson(now) ? [] : [[key, now]];
			}
		)
	);

const clearOwners = (
	held: Json | undefined,
	depth: Depth,
	set_by: Record<string, string>,
	prefix: string[],
	path: string
): void => {
	delete set_by[path];
	if (!isJsonObject(held) || !opens(depth, prefix)) return;
	for (const [key, value] of Object.entries(held)) {
		prefix.push(key);
		clearOwners(value, depth, set_by, prefix, `${path}${SEP}${key}`);
		prefix.pop();
	}
};

const applyWithOwners = (
	state: JsonObject,
	patch: JsonObject,
	depth: Depth,
	rowId: string,
	set_by: Record<string, string>,
	prefix: string[],
	parentPath: string
): JsonObject => {
	const next: Record<string, Json> = { ...state };
	for (const [key, value] of Object.entries(patch)) {
		const held = next[key];
		const path = parentPath === '' ? key : `${parentPath}${SEP}${key}`;
		prefix.push(key);
		if (value === null) {
			delete next[key];
			if (held !== undefined) clearOwners(held, depth, set_by, prefix, path);
		} else if (isJsonObject(value) && opens(depth, prefix)) {
			next[key] = applyWithOwners(
				isJsonObject(held) ? held : {},
				value,
				depth,
				rowId,
				set_by,
				prefix,
				path
			);
		} else {
			if (held !== undefined && isJsonObject(held) && opens(depth, prefix))
				clearOwners(held, depth, set_by, prefix, path);
			next[key] = value;
			set_by[path] = rowId;
		}
		prefix.pop();
	}
	return next;
};

const isOrdered = (rows: readonly Change[]): boolean => {
	for (let i = 1; i < rows.length; i++) {
		const prev = rows[i - 1],
			curr = rows[i];
		if (prev === undefined || curr === undefined) continue;
		const cmp = prev.effective_from.localeCompare(curr.effective_from);
		if (cmp > 0 || (cmp === 0 && prev.id.localeCompare(curr.id) > 0)) return false;
	}
	return true;
};

const ordered = (rows: readonly Change[]) =>
	isOrdered(rows)
		? rows
		: rows.toSorted(
				(a, b) => a.effective_from.localeCompare(b.effective_from) || a.id.localeCompare(b.id)
			);

/**
 * What is in force on a day: the changes dated on or before it, applied oldest first. `set_by` names the change that
 * last set each path, so a value wrong since it was set is corrected on that row.
 */
export const inForce = (
	rows: readonly Change[],
	day: string,
	depth: Depth = 1
): { readonly state: JsonObject; readonly set_by: Readonly<Record<string, string>> } => {
	let state: JsonObject = {};
	const set_by: Record<string, string> = {};
	const prefix: string[] = [];
	for (const row of ordered(rows)) {
		if (row.effective_from > day) break;
		state = applyWithOwners(state, row.patch, depth, row.id, set_by, prefix, '');
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
	depth: Depth = 1,
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
	depth: Depth = 1
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
