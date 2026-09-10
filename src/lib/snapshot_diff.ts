import { stableJson } from './jurisdiction_settings.js';

/**
 * Snapshot diff: what one jurisdiction settings version changes against another.
 *
 * Pure over rows, so the Settings Changes tab and the unit tests read the same computation. Rows
 * are matched by `code`; a collection whose rows carry none (work_catalogue holds one regime row)
 * is matched as a single row. Only leaves become lines — `bands[3].award.employer: 2,374.75 → 2,478`
 * — so an operator reads the value that moved rather than two JSON blobs. Provenance columns
 * (`id`, `settings_id`, the audit stamps) are not part of identity and never diff.
 */

export type LeafChange = Readonly<{
	path: string;
	previous: string | number | boolean | null;
	proposed: string | number | boolean | null;
}>;

type RowDiff = Readonly<{
	code: string;
	name: string;
	state: 'ADDED' | 'REMOVED' | 'CHANGED';
	changes: readonly LeafChange[];
}>;

export type CollectionDiff = Readonly<{
	collection: string;
	rows: readonly RowDiff[];
}>;

/** Columns that say which row this is, not what the snapshot states. */
const PROVENANCE = new Set([
	'id',
	'settings_id',
	'approval_id',
	'created_at',
	'updated_at',
	'row_version'
]);

/** Root scalars worth comparing; name and source lists are identity and provenance, not the law. */
const ROOT_DIFF_FIELDS = ['currency', 'tax_year_start_month', 'minimum_wages'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value != null && typeof value === 'object' && !Array.isArray(value);

const asRecord = (row: object): Record<string, unknown> => row as Record<string, unknown>;

const stripped = (row: object): Record<string, unknown> =>
	Object.fromEntries(Object.entries(asRecord(row)).filter(([key]) => !PROVENANCE.has(key)));

const display = (value: unknown): string | number | boolean | null => {
	if (value == null) return null;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
		return value;
	return JSON.stringify(value) ?? String(value);
};

const walk = (previous: unknown, proposed: unknown, path: string, into: LeafChange[]): void => {
	if (stableJson(previous) === stableJson(proposed)) return;
	if (Array.isArray(previous) && Array.isArray(proposed)) {
		const length = Math.max(previous.length, proposed.length);
		for (let index = 0; index < length; index += 1)
			walk(previous[index], proposed[index], `${path}[${index}]`, into);
		return;
	}
	if (isRecord(previous) && isRecord(proposed)) {
		const keys = [...new Set([...Object.keys(previous), ...Object.keys(proposed)])].sort();
		for (const key of keys)
			walk(previous[key], proposed[key], path === '' ? key : `${path}.${key}`, into);
		return;
	}
	into.push({ path, previous: display(previous), proposed: display(proposed) });
};

/** The root scalars that differ between two versions, one leaf per moved value. */
export function diffSettingsRoot(
	previous: object | null | undefined,
	proposed: object | null | undefined
): readonly LeafChange[] {
	const changes: LeafChange[] = [];
	if (previous == null || proposed == null) return changes;
	for (const field of ROOT_DIFF_FIELDS)
		walk(asRecord(previous)[field], asRecord(proposed)[field], field, changes);
	return changes;
}

/**
 * The changed, added and removed rows of one collection between two snapshots, or null when the
 * collection is identical. Rows are keyed by `code`, or treated as a single row where none exists.
 */
export function diffCollection(
	collection: string,
	previous: readonly object[],
	proposed: readonly object[]
): CollectionDiff | null {
	const single =
		previous.length === 1 &&
		proposed.length === 1 &&
		asRecord(previous[0]!).code == null &&
		asRecord(proposed[0]!).code == null;
	const keyOf = (row: object): string =>
		single ? 'regime' : String(asRecord(row).code ?? asRecord(row).id ?? '');
	const nameOf = (row: object): string => String(asRecord(row).name ?? asRecord(row).code ?? '');

	const before = new Map(previous.map((row) => [keyOf(row), row]));
	const after = new Map(proposed.map((row) => [keyOf(row), row]));
	const rows: RowDiff[] = [];

	for (const [key, row] of after) {
		const old = before.get(key);
		if (old === undefined) {
			rows.push({ code: key, name: nameOf(row), state: 'ADDED', changes: [] });
			continue;
		}
		const changes: LeafChange[] = [];
		walk(stripped(old), stripped(row), '', changes);
		if (changes.length > 0) rows.push({ code: key, name: nameOf(row), state: 'CHANGED', changes });
	}
	for (const [key, row] of before)
		if (!after.has(key)) rows.push({ code: key, name: nameOf(row), state: 'REMOVED', changes: [] });

	rows.sort((left, right) => left.code.localeCompare(right.code));
	return rows.length === 0 ? null : { collection, rows };
}
