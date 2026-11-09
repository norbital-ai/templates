import { isDynObject, Refusal, stableJson } from './foundation.js';
import type { DynObject, Json } from './foundation.js';

/** What a dated change may move: a sealed version's terms and facts. An entity move is a transfer, with its loans. */
const ROOTS = new Set([
	'engagement',
	'terms',
	'payroll',
	'events',
	'dependents_count',
	'children',
	'only_child',
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
