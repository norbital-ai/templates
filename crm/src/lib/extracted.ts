/**
 * Structured values `update_requirements` extracts from filed activities and documents: a job's scope of work and decisions, and a
 * customer's profile. Every list item records whether a person wrote it (`manual`) or the extraction did (`generated`), and the
 * activity or document IDs it cites. A person's edit marks the item manual; extraction replaces only generated items.
 */
import type { ValueOf } from '@norbital-ai/bolt';

const text = { kind: 'text' } as const;
const lines = { kind: 'text', many: true } as const;
const provenance = {
	origin: { kind: 'enum', values: ['generated', 'manual'], optional: true, hidden: true },
	sources: { kind: 'text', many: true, optional: true, hidden: true }
} as const;

/** What each extracted list item holds, without its provenance. */
const ITEM_FIELDS = {
	definitions: { term: text, meaning: text },
	implementation_scope: {
		feature: text,
		included: lines,
		dependencies: { ...lines, optional: true }
	},
	data_migration: { data: text, included: lines, format: text },
	milestones: {
		timeline: text,
		due_on: { kind: 'date', optional: true },
		milestone: text,
		client_review: { kind: 'text', optional: true }
	},
	uat_tests: { ref: text, name: text, objective: text, expected_result: text },
	fees: { item: text, includes: text, fee: text },
	decisions: { decision: text, decided_on: { kind: 'date', optional: true } },
	preferences: { topic: text, preference: text }
} as const;

const stored = <const F>(fields: F) =>
	({
		kind: 'json',
		optional: true,
		shape: { kind: 'object', many: true, fields: { ...fields, ...provenance } }
	}) as const;
/** What the model answers for a list: items with the sources they cite. */
const answered = <const F>(fields: F) =>
	({ kind: 'object', many: true, fields: { ...fields, sources: lines } }) as const;

/** What was decided on a job, outside its scope of work. */
export const DECISIONS_FIELD = stored(ITEM_FIELDS.decisions);
/** The scope-of-work lists stored on a job. */
export const SOW_FIELDS = {
	definitions: stored(ITEM_FIELDS.definitions),
	implementation_scope: stored(ITEM_FIELDS.implementation_scope),
	data_migration: stored(ITEM_FIELDS.data_migration),
	milestones: stored(ITEM_FIELDS.milestones),
	uat_tests: stored(ITEM_FIELDS.uat_tests),
	fees: stored(ITEM_FIELDS.fees)
} as const;
export const PREFERENCES_FIELD = stored(ITEM_FIELDS.preferences);

/** The job extraction's answers: two calls, so neither answer grows past the model's step budget. */
export const SCOPE_ANSWER = {
	kind: 'object',
	fields: {
		overview: text,
		definitions: answered(ITEM_FIELDS.definitions),
		implementation_scope: answered(ITEM_FIELDS.implementation_scope),
		data_migration: answered(ITEM_FIELDS.data_migration)
	}
} as const;
export const PLAN_ANSWER = {
	kind: 'object',
	fields: {
		milestones: answered(ITEM_FIELDS.milestones),
		uat_tests: answered(ITEM_FIELDS.uat_tests),
		fees: answered(ITEM_FIELDS.fees),
		decisions: answered(ITEM_FIELDS.decisions)
	}
} as const;
/** The customer-profile extraction's answer. */
export const PROFILE_ANSWER = {
	kind: 'object',
	fields: {
		industry: text,
		description: text,
		preferences: answered(ITEM_FIELDS.preferences)
	}
} as const;

export type SowContent = { readonly overview?: string | null } & {
	readonly [S in keyof typeof SOW_FIELDS]?: ValueOf<(typeof SOW_FIELDS)[S]>;
};

type Item = {
	readonly origin?: 'generated' | 'manual' | null;
	readonly sources?: readonly string[] | null;
};
/** An item's content, independent of key order, provenance and absent values. */
const content = (item: object) => {
	const fields: Readonly<Record<string, unknown>> = { ...item };
	return JSON.stringify(
		Object.entries(fields)
			.filter(([key, value]) => key !== 'origin' && key !== 'sources' && value != null)
			.sort(([a], [b]) => (a < b ? -1 : 1))
	);
};

/** A person's write: items not stored unchanged before become manual. */
export const markManual = <T extends Item>(
	next: readonly T[] | null,
	before: readonly T[] | null | undefined
): readonly T[] | null => {
	if (next == null) return next;
	const kept = new Map((before ?? []).map((item) => [content(item), item]));
	return next.map((item) =>
		kept.get(content(item))?.origin === 'generated' ? item : { ...item, origin: 'manual' as const }
	);
};

/**
 * Fresh extraction merged over what is stored: manual items stay, taking the place of a generated item with the same
 * key; sources outside the evidence are removed. Empty is `null`.
 */
export const mergeGenerated = <T extends Item>(
	stored: readonly T[] | null | undefined,
	generated: readonly NoInfer<T>[],
	key: (item: T) => string,
	cited: ReadonlySet<string>
): T[] | null => {
	const norm = (item: T) => key(item).trim().toLowerCase();
	const manual = new Map(
		(stored ?? []).filter((item) => item.origin === 'manual').map((item) => [norm(item), item])
	);
	const merged: T[] = [];
	for (const item of generated) {
		const held = manual.get(norm(item));
		if (held !== undefined) {
			merged.push(held);
			manual.delete(norm(item));
		} else
			merged.push({
				...item,
				origin: 'generated' as const,
				sources: (item.sources ?? []).filter((source) => cited.has(source))
			});
	}
	merged.push(...manual.values());
	return merged.length === 0 ? null : merged;
};

/** A scalar field a person wrote is listed in `manual_fields`; clearing it hands it back to extraction. */
export const manualFields = <F extends string>(
	edited: readonly {
		field: F;
		next: string | null | undefined;
		before: string | null | undefined;
	}[],
	before: readonly F[] | null | undefined
): F[] => {
	const result = new Set(before ?? []);
	for (const { field, next, before: was } of edited) {
		if (next === undefined || next === was) continue;
		if (next?.trim()) result.add(field);
		else result.delete(field);
	}
	return [...result];
};
