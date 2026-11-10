import { isDynObject, jsonObject, jsonValues, Refusal, stableJson } from './foundation.js';
import type { DynObject, Json, JsonObject } from './foundation.js';

/** The settings row itself as a change's family; it has no `row_code`. */
export const SETTINGS_FAMILY = 'jurisdiction_settings';
/** A change's `field_path` when it adds or removes a whole catalogue row. */
export const WHOLE_ROW = '$row';
const IDENTITY = ['id', 'revision', 'created_at', 'updated_at', 'created_by', 'updated_by'];
/** A change never moves a row's identity, version binding, chain position or lifecycle. */
const PROTECTED = new Set([
	...IDENTITY,
	'code',
	'settings_id',
	'previous_id',
	'status',
	'reason',
	'effective_range'
]);
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);

/** An official host: government, tax or social-security domains of the workspace's jurisdictions. */
export const officialSource = (url: string): boolean => {
	const parsed = URL.parse(url);
	return parsed?.protocol === 'https:' && /\.(gov|go)(\.[a-z]{2})?$/.test(parsed.hostname);
};
/** The host a source lives on, empty for what is not a URL; sources move page by page, rarely host by host. */
export const hostOf = (url: string): string => URL.parse(url)?.hostname ?? '';
/** A citation as a stable key: the same instrument, however a run spells it, is one finding. */
export const instrumentKey = (instrument: string): string =>
	instrument
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-|-$/g, '');

export type Snapshot = {
	readonly settings: JsonObject;
	readonly rows: { readonly [family: string]: readonly JsonObject[] };
};
export type StatutoryChange = {
	readonly id: string;
	readonly jurisdiction_code: string;
	readonly family: string;
	readonly row_code: string | null;
	readonly field_path: string;
	readonly old_value: Json | null;
	readonly new_value: Json | null;
	readonly effective_from: string | null;
	readonly status: string;
	readonly applied_version_id: string | null;
};
export type MaterializedVersion = {
	readonly effective_from: string;
	readonly change_ids: readonly string[];
	readonly snapshot: Snapshot;
};

const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const byKeys =
	<A>(keys: (value: A) => readonly string[]) =>
	(left: A, right: A): number => {
		const a = keys(left),
			b = keys(right);
		for (let i = 0; i < a.length; i++) {
			const order = compare(a[i] ?? '', b[i] ?? '');
			if (order !== 0) return order;
		}
		return 0;
	};
const changeOrder = byKeys((change: StatutoryChange) => [
	change.effective_from ?? '',
	change.family,
	change.row_code ?? '',
	change.field_path,
	change.id
]);
const rowOrder = byKeys((row: JsonObject) => [String(row.code ?? ''), String(row.id ?? '')]);
const labelOf = (change: StatutoryChange): string =>
	[change.family, change.row_code, change.field_path].filter((part) => part !== null).join('/');
const refuse = (reason: string, change: StatutoryChange, message: string): never => {
	throw new Refusal({ message: `${reason}: ${labelOf(change)}: ${message}`, detail: reason });
};
const object = (value: unknown): DynObject => {
	const copy = jsonValues(value);
	if (!isDynObject(copy)) throw new Refusal({ message: 'A configuration row must be an object.' });
	return copy;
};

const segments = (change: StatutoryChange): readonly string[] => {
	const parts = change.field_path.split('.');
	if (parts.some((part) => part === '' || UNSAFE.has(part)))
		return refuse('unsafe_path', change, 'the path is not a declared field path.');
	if (PROTECTED.has(parts[0] ?? ''))
		return refuse('protected_field', change, `${parts[0]} is not statutory content.`);
	return parts;
};
const step = (value: unknown, key: string): unknown =>
	Array.isArray(value)
		? /^\d+$/.test(key)
			? value[Number(key)]
			: undefined
		: isDynObject(value) && Object.hasOwn(value, key)
			? value[key]
			: undefined;

/** The change's row in the working snapshot, or `undefined` when the catalogue has none with its code. */
const rowOf = (
	working: { settings: DynObject; rows: Record<string, DynObject[]> },
	change: StatutoryChange
) => {
	if (change.family === SETTINGS_FAMILY) return working.settings;
	const family = working.rows[change.family];
	if (family === undefined) return refuse('unknown_family', change, 'not in this baseline.');
	if (change.row_code === null) return refuse('missing_row', change, 'names no row code.');
	return family.find((row) => row.code === change.row_code);
};

/** The value a change's path holds in a snapshot, `null` when absent: research records it as `old_value`. */
export const valueAt = (
	snapshot: Snapshot,
	change: Pick<StatutoryChange, 'family' | 'row_code' | 'field_path'>
): Json | null => {
	const rows =
		change.family === SETTINGS_FAMILY ? [snapshot.settings] : snapshot.rows[change.family];
	const row =
		change.family === SETTINGS_FAMILY
			? rows?.[0]
			: rows?.find((candidate) => candidate.code === change.row_code);
	if (row === undefined) return null;
	if (change.field_path === WHOLE_ROW) return business(row);
	let value: unknown = row;
	for (const key of change.field_path.split('.')) value = step(value, key);
	return value === undefined ? null : (jsonObject({ value }).value ?? null);
};

/** A row's statutory content: what a whole-row change compares and carries. */
const business = (row: JsonObject | DynObject): JsonObject =>
	jsonObject(
		Object.fromEntries(
			Object.entries(row).filter(([key]) => !IDENTITY.includes(key) && key !== 'settings_id')
		)
	);

const applyRow = (
	working: { settings: DynObject; rows: Record<string, DynObject[]> },
	change: StatutoryChange
): void => {
	if (change.family === SETTINGS_FAMILY || change.family === 'subtotal')
		refuse('unsupported_row_change', change, 'this family takes field changes only.');
	const row = rowOf(working, change);
	const family = working.rows[change.family] ?? [];
	if (change.new_value === null) {
		if (row === undefined) refuse('missing_row', change, 'no row to remove.');
		else if (stableJson(business(row)) !== stableJson(change.old_value))
			refuse('stale', change, 'the row differs from the one this change removes.');
		else family.splice(family.indexOf(row), 1);
		return;
	}
	if (row !== undefined || change.old_value !== null)
		return refuse('stale', change, 'the row already exists.');
	family.push({ ...object(change.new_value), code: change.row_code });
};

const applyField = (
	working: { settings: DynObject; rows: Record<string, DynObject[]> },
	change: StatutoryChange
): void => {
	const parts = segments(change);
	const row = rowOf(working, change);
	if (row === undefined) return refuse('missing_row', change, 'no such row in this baseline.');
	let parent: unknown = row;
	for (const key of parts.slice(0, -1)) {
		let next = step(parent, key);
		if (next === undefined) {
			if (change.old_value !== null || !isDynObject(parent))
				return refuse('missing_path', change, `${key} does not exist.`);
			next = parent[key] = {};
		}
		parent = next;
	}
	const key = parts.at(-1) ?? '';
	const current = step(parent, key);
	if (current === undefined && change.old_value !== null)
		return refuse('missing_path', change, 'the path does not exist.');
	if (current !== undefined && stableJson(current) !== stableJson(change.old_value))
		return refuse(
			'stale',
			change,
			`the baseline holds ${stableJson(current)}, the change expects ${stableJson(change.old_value)}.`
		);
	if (Array.isArray(parent)) {
		if (change.new_value === null) parent.splice(Number(key), 1);
		else parent[Number(key)] = jsonValues(change.new_value);
		return;
	}
	if (!isDynObject(parent)) return refuse('missing_path', change, 'the path is not an object.');
	if (change.new_value === null) Reflect.deleteProperty(parent, key);
	else parent[key] = jsonValues(change.new_value);
};

const frozen = (
	working: { settings: DynObject; rows: Record<string, DynObject[]> },
	range: { from: string; to: unknown }
): Snapshot => ({
	settings: jsonObject({
		...working.settings,
		name: `${String(working.settings.name ?? working.settings.code).split(' — ')[0]} — ${range.from}`,
		effective_range: range
	}),
	rows: Object.fromEntries(
		Object.keys(working.rows)
			.toSorted(compare)
			.map((family) => [
				family,
				(working.rows[family] ?? []).map((row) => jsonObject(row)).toSorted(rowOrder)
			])
	)
});

/**
 * Applies a jurisdiction's confirmed changes to a sealed baseline: one cumulative snapshot per effective date, earliest
 * first. Pure: the caller supplies every input and reads no clock, database or generator here, so the same inputs answer
 * byte-identical plans. Undated and unconfirmed changes never reach a snapshot; a stale or conflicting one refuses it all.
 */
export const materialize = ({
	baseline,
	changes,
	target,
	jurisdiction
}: {
	readonly baseline: Snapshot;
	readonly changes: readonly StatutoryChange[];
	readonly target: string;
	readonly jurisdiction: string;
}): readonly MaterializedVersion[] => {
	if (baseline.settings.code !== jurisdiction)
		throw new Refusal({
			message: `wrong_baseline: the baseline is ${String(baseline.settings.code)}, not ${jurisdiction}.`,
			detail: 'wrong_baseline'
		});
	const range = object(baseline.settings.effective_range);
	const from = String(range.from);
	const due = changes
		.filter(
			(change) =>
				change.jurisdiction_code === jurisdiction &&
				change.status === 'CONFIRMED' &&
				change.applied_version_id === null &&
				change.effective_from !== null &&
				change.effective_from <= target
		)
		.toSorted(changeOrder);
	const seen = new Map<string, StatutoryChange>();
	const distinct = due.filter((change) => {
		const key = stableJson([
			change.effective_from,
			change.family,
			change.row_code,
			change.field_path
		]);
		const earlier = seen.get(key);
		if (earlier === undefined) {
			seen.set(key, change);
			return true;
		}
		if (stableJson(earlier.new_value) !== stableJson(change.new_value))
			refuse('conflict', change, `${earlier.id} and ${change.id} confirm different values.`);
		return false;
	});
	const working = {
		settings: object(baseline.settings),
		rows: Object.fromEntries(
			Object.entries(baseline.rows).map(([family, rows]) => [family, rows.map(object)])
		)
	};
	const dates = [...new Set(distinct.map((change) => change.effective_from ?? ''))];
	return dates.map((date) => {
		for (const change of distinct.filter((candidate) => candidate.effective_from === date)) {
			if (date <= from)
				refuse('predates_baseline', change, `${date} is not after the baseline start ${from}.`);
			if (change.old_value === null && change.new_value === null)
				refuse('empty_change', change, 'it changes nothing.');
			if (change.field_path === WHOLE_ROW) applyRow(working, change);
			else applyField(working, change);
		}
		return {
			effective_from: date,
			change_ids: due.filter((change) => change.effective_from === date).map((change) => change.id),
			// a baseline that ended before this date (the seeded window's last version) hands on no end
			snapshot: frozen(working, {
				from: date,
				to: typeof range.to === 'string' && range.to >= date ? range.to : null
			})
		};
	});
};

/** Whether a written snapshot carries a change: its new value at its path, or its row present or removed. */
export const carries = (snapshot: Snapshot, change: StatutoryChange): boolean =>
	change.field_path === WHOLE_ROW
		? (valueAt(snapshot, change) !== null) === (change.new_value !== null)
		: stableJson(valueAt(snapshot, change)) === stableJson(change.new_value);
