/**
 * Sealing a draft settings version: the rows one write carries.
 *
 * The predecessor — the sealed, live version that starts before the draft — ends where the draft
 * begins; the draft seals with its end at the next sealed version's start, open where there is
 * none. One batch, because the collection reads the batch to see the predecessor ended: two
 * writes would leave a shortened predecessor and an unsealed draft if the seal refused.
 */

import { readRange, type StoredRange } from '../collections/payroll_runs/lib/effective.js';

type VersionRow = {
	readonly id: string;
	readonly effective_range: unknown;
	readonly sealed_at: string | null;
	readonly voided_at: string | null;
};

type SealWrite = {
	readonly id: string;
	readonly effective_range: StoredRange;
	readonly sealed_at?: string;
};

/** The sealed, live neighbours a draft slots between, by start day. */
export function sealNeighbours<T extends VersionRow>(
	draft: T,
	lineage: readonly T[]
): { readonly before?: T; readonly after?: T } {
	const start = readRange(draft.effective_range)?.start ?? '';
	const live = lineage
		.filter((row) => row.id !== draft.id && row.sealed_at != null && row.voided_at == null)
		.map((row) => ({ row, start: readRange(row.effective_range)?.start ?? '' }))
		.filter((entry) => entry.start !== '');
	const before = live
		.filter((entry) => entry.start < start)
		.toSorted((a, b) => (a.start < b.start ? 1 : -1))[0]?.row;
	const after = live
		.filter((entry) => entry.start > start)
		.toSorted((a, b) => (a.start < b.start ? -1 : 1))[0]?.row;
	return { before, after };
}

export function sealWrites<T extends VersionRow>(
	draft: T,
	lineage: readonly T[],
	sealedAt: string
): readonly SealWrite[] {
	const start = readRange(draft.effective_range)?.start ?? '';
	const { before, after } = sealNeighbours(draft, lineage);
	const predecessor =
		before == null
			? []
			: [
					{
						id: before.id,
						effective_range: { start: readRange(before.effective_range)!.start, end: start }
					}
				];
	const successorStart = after == null ? null : readRange(after.effective_range)!.start;
	return [
		...predecessor,
		{ id: draft.id, effective_range: { start, end: successorStart }, sealed_at: sealedAt }
	];
}
