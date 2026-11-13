import { isJsonObject, type JsonObject } from '../../payroll_engine/foundation.js';

/** A field's name as people read it. */
export const fieldLabel = (name: string) =>
	name
		.replace(/_id$/, '')
		.replaceAll('_', ' ')
		.replace(/^\w/, (first) => first.toUpperCase());

type Names = ReadonlyMap<string, string>;

const shown = (name: string, value: JsonObject[string], names: Names): string => {
	if (name === 'rate' && isJsonObject(value))
		return `: ${String(value.amount)} ${String(value.unit).toLowerCase()}`;
	// a period reads as its days; another record by the keys it holds; a reference by the name of what it points at
	if (isJsonObject(value))
		return 'from' in value
			? `: ${String(value.from)} – ${String(value.to ?? '')}`
			: ` (${Object.keys(value).join(', ')})`;
	if (Array.isArray(value)) return `: ${value.join(', ')}`;
	if (!name.endsWith('_id')) return `: ${String(value)}`;
	const named = names.get(String(value));
	return named === undefined ? '' : `: ${named}`;
};

/** What one dated row changed: each field it sets with its value, then each it takes away. */
export const changeSummary = (
	row: JsonObject,
	fields: readonly string[],
	removed: string,
	names: Names
): string =>
	[
		...fields.flatMap((name) => {
			const value = row[name];
			return value == null ? [] : [`${fieldLabel(name)}${shown(name, value, names)}`];
		}),
		...(Array.isArray(row.clears) ? row.clears : []).map(
			(name) => `${fieldLabel(String(name))}: ${removed}`
		)
	].join(' · ');

/** A folded state for people: each reference as the name of what it points at, left out where it has none. */
export const named = (state: JsonObject, names: Names): JsonObject =>
	Object.fromEntries(
		Object.entries(state).flatMap(([name, value]) => {
			if (!name.endsWith('_id')) return [[name, value]];
			const held = names.get(String(value));
			return held === undefined ? [] : [[name.replace(/_id$/, ''), held]];
		})
	);
