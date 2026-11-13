import { DateTime, Duration } from 'effect';
import { isDynObject, jsonObject, Refusal, stableJson } from './foundation.js';
import type { DynObject, Json, JsonObject } from './foundation.js';

/** What a dated change may move: a sealed version's terms and facts. An entity move is a transfer, with its loans. */
const ROOTS = new Set([
	'engagement',
	'terms',
	'payroll',
	'events',
	'family',
	'employee_extension_data'
]);
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);

export type ContractChange = {
	readonly field_path: string;
	readonly old_value: Json | null;
	readonly new_value: Json | null;
};

export const changeable = (path: string): boolean => {
	const parts = path.split('.');
	return ROOTS.has(parts[0] ?? '') && parts.every((part) => part !== '' && !UNSAFE.has(part));
};

const same = (left: unknown, right: unknown) =>
	stableJson(left ?? null) === stableJson(right ?? null);

/** What stands at a path after a change. A list holds facts: `old_value` names the item replaced, `new_value` the item that stands. */
const settled = (held: unknown, change: ContractChange): unknown => {
	const { field_path: path, old_value: old, new_value: next } = change;
	if (Array.isArray(held) || (held == null && isDynObject(next))) {
		const items: readonly unknown[] = Array.isArray(held) ? held : [];
		const kept = old === null ? items : items.filter((item) => !same(item, old));
		if (old !== null && kept.length === items.length)
			throw new Refusal({ message: `${path}: the contract moved under this change.` });
		return next === null ? kept : [...kept, next];
	}
	if (!same(held, old))
		throw new Refusal({ message: `${path}: the contract moved under this change.` });
	return next;
};

const placed = (held: unknown, path: readonly string[], change: ContractChange): unknown => {
	const [head, ...rest] = path;
	if (head === undefined) return settled(held, change);
	const base = isDynObject(held) ? held : {};
	return { ...base, [head]: placed(base[head], rest, change) };
};

/** A contract with one change applied. It refuses where the value moved since the change was filed. */
export const withChange = (contract: DynObject, change: ContractChange): DynObject => ({
	...contract,
	...(placed(contract, change.field_path.split('.'), change) as DynObject)
});

/** A contract version as the chain reads it: `employee_id`, `status`, `effective_range`, `entity_id`. */
type ChainVersion = Readonly<Record<string, unknown>>;

/**
 * An exit is read from the contract chain: a sealed version with a last day, and no draft or sealed version of the same
 * person starting after it under the same jurisdiction lineage. `lineage` names each entity's `settings_code`.
 */
export const isExit = (
	version: ChainVersion,
	chain: readonly ChainVersion[],
	lineage: ReadonlyMap<string, string>
): boolean => {
	const to = isDynObject(version.effective_range) ? version.effective_range.to : null;
	if (version.status !== 'SEALED' || typeof to !== 'string') return false;
	const code = lineage.get(String(version.entity_id));
	return !chain.some(
		(other) =>
			other.employee_id === version.employee_id &&
			(other.status === 'DRAFT' || other.status === 'SEALED') &&
			isDynObject(other.effective_range) &&
			String(other.effective_range.from) > to &&
			lineage.get(String(other.entity_id)) === code
	);
};

const rangeOf = (version: ChainVersion) => {
	const range = isDynObject(version.effective_range) ? version.effective_range : {};
	return { from: String(range.from), to: typeof range.to === 'string' ? range.to : null };
};

/**
 * The settings version a contract answers to on a day. A contract names no version: its entity's `settings_code` is the
 * lineage, and the day picks the sealed version in force; a day before the lineage's first version answers to that one.
 */
export const versionOn = <V extends ChainVersion>(
	versions: readonly V[],
	code: unknown,
	day: string
): V | undefined => {
	const lineage = versions
		.filter((version) => version.code === code)
		.toSorted((left, right) => rangeOf(left).from.localeCompare(rangeOf(right).from));
	const first = lineage[0];
	return (
		lineage.find((version) => {
			const { from, to } = rangeOf(version);
			return from <= day && (to === null || day <= to);
		}) ?? (first !== undefined && day < rangeOf(first).from ? first : undefined)
	);
};

/** When a person's service began, and when their current unbroken stint did, as expressions read them. */
export type Starts = {
	readonly service_started_on: string;
	readonly employment_started_on: string;
};

/**
 * When the person's service began, which anchors their service windows, and when the current unbroken stint under the
 * contract's jurisdiction lineage began. With `cumulative` (the profile's `cumulative_service`) every sealed stint counts,
 * rehires included: the latest stint's start, less the days of the earlier ones; without it, only the current stint. The
 * contract's `service_started_on` wins where it is earlier: service credited from elsewhere.
 */
export const startsOf = (
	contract: ChainVersion,
	chain: readonly ChainVersion[],
	lineage: ReadonlyMap<string, string>,
	cumulative: boolean
): Starts => {
	const code = lineage.get(String(contract.entity_id));
	const stints: { from: string; to: string | null }[] = [];
	for (const range of [
		contract,
		...chain.filter(
			(other) =>
				other.id !== contract.id &&
				other.employee_id === contract.employee_id &&
				other.status === 'SEALED' &&
				code !== undefined &&
				lineage.get(String(other.entity_id)) === code &&
				rangeOf(other).from < rangeOf(contract).from
		)
	]
		.map(rangeOf)
		.toSorted((left, right) => left.from.localeCompare(right.from))) {
		const last = stints.at(-1);
		// a version from the day after the last one ends continues its stint; a gap starts a new one
		if (
			last !== undefined &&
			(last.to === null ||
				DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(last.to), { days: 1 })) >=
					range.from)
		)
			last.to = range.to;
		else stints.push(range);
	}
	const current = stints.at(-1)?.from ?? rangeOf(contract).from;
	const earlier = cumulative
		? stints.slice(0, -1).reduce(
				(total, stint) =>
					// only the newest stint is open
					total +
					Duration.toDays(
						DateTime.distance(DateTime.makeUnsafe(stint.from), DateTime.makeUnsafe(stint.to!))
					) +
					1,
				0
			)
		: 0;
	const worked = DateTime.formatIsoDate(
		DateTime.add(DateTime.makeUnsafe(current), { days: -earlier })
	);
	const credited = contract.service_started_on;
	return {
		service_started_on: typeof credited === 'string' && credited < worked ? credited : worked,
		employment_started_on: current
	};
};

/**
 * A chain read with `entity_id` expanded to `{ id, settings_code }`, and optionally `employee_id` to
 * `{ id, cumulative_service }`: the rows back on plain ids, the lineage of each entity they name, and the people whose
 * service counts every stint, as `startsOf` takes them.
 */
export const chainOf = (rows: readonly JsonObject[]) => ({
	chain: rows.map((row) => {
		const { entity_id: entity, employee_id: person } = row;
		return jsonObject({
			...row,
			...(isDynObject(entity) ? { entity_id: entity.id } : {}),
			...(isDynObject(person) ? { employee_id: person.id } : {})
		});
	}),
	lineage: new Map(
		rows.flatMap((row) => {
			const entity = row.entity_id;
			return isDynObject(entity)
				? [[String(entity.id), String(entity.settings_code)] as const]
				: [];
		})
	),
	cumulative: new Set(
		rows.flatMap((row) => {
			const person = row.employee_id;
			return isDynObject(person) && person.cumulative_service === true ? [String(person.id)] : [];
		})
	)
});

/** The changes that turn one value into another: a leaf each, and a list item by item. */
export const changesBetween = (
	before: unknown,
	after: unknown,
	path: string
): readonly ContractChange[] => {
	if (same(before, after)) return [];
	if (isDynObject(after) && (before == null || isDynObject(before))) {
		const held = before ?? {};
		return [...new Set([...Object.keys(held), ...Object.keys(after)])].flatMap((key) =>
			changesBetween(held[key], after[key], `${path}.${key}`)
		);
	}
	if (Array.isArray(after) && (before == null || Array.isArray(before))) {
		const held: readonly Json[] = before ?? [];
		const missing = (items: readonly Json[], item: Json) =>
			!items.some((other) => same(other, item));
		return [
			...held
				.filter((item) => missing(after, item))
				.map((item) => ({ field_path: path, old_value: item, new_value: null })),
			...after
				.filter((item) => missing(held, item))
				.map((item) => ({ field_path: path, old_value: null, new_value: item }))
		];
	}
	return [
		{ field_path: path, old_value: (before ?? null) as Json, new_value: (after ?? null) as Json }
	];
};
