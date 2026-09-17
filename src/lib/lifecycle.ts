import { refuse } from '@norbital-ai/bolt/authoring';

/**
 * A document's status move, checked against its transition map.
 *
 * Every document collection polices the same shape — a terminal state is immutable, a move must be
 * one the map allows — so the sentence is written once here and each transform supplies its map.
 */
export function assertTransition<Status extends string>(
	transitions: Readonly<Record<Status, readonly Status[]>>,
	from: Status,
	to: Status
): void {
	const allowed = transitions[from];
	if (!allowed.includes(to)) {
		refuse(`Invalid status transition: ${from} → ${to}. Allowed: ${allowed.join(', ')}.`);
	}
}

/** A reason a status move must carry, from the input or already on the record. */
export function requireReason(reason: string | null | undefined, what: string): void {
	if (!reason || reason.trim() === '') refuse(`A ${what} reason is required.`);
}

/** Rows bucketed by a key, for the lookups a per-input rule makes after one batched read. */
export function groupBy<Row>(
	rows: readonly Row[],
	key: (row: Row) => string
): ReadonlyMap<string, Row[]> {
	const groups = new Map<string, Row[]>();
	for (const row of rows) {
		const group = groups.get(key(row)) ?? [];
		group.push(row);
		groups.set(key(row), group);
	}
	return groups;
}

/** The ids a batch names, deduplicated and without the blanks. */
export function uniqueIds(ids: readonly (string | null | undefined)[]): string[] {
	return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
}

/** One input of a transform batch beside the stored row it lands on, if any. */
type BatchEntry<Create, Update, Stored> =
	| { readonly kind: 'create'; readonly input: Create }
	| { readonly kind: 'update'; readonly input: Update; readonly stored: Stored };

/**
 * Pairs each input of a transform batch with its stored row.
 *
 * The engine decodes an input against the create selection exactly when it has no stored row, so
 * `existing[i]` is the discriminator; naming the two input types here, once, lets every rule read
 * the columns its own selection admits without re-deriving which selection applied.
 */
export function batchEntries<Create, Update, Stored>(
	inputs: ReadonlyArray<Create | Update>,
	existing: ReadonlyArray<Stored | undefined>
): BatchEntry<Create, Update, Stored>[] {
	return inputs.map((input, i) => {
		const stored = existing[i];
		return stored === undefined
			? { kind: 'create', input: input as Create }
			: { kind: 'update', input: input as Update, stored };
	});
}
