/**
 * Sealing a draft settings version: the rows one write carries.
 *
 * The predecessor — the sealed, live version that starts before the draft — ends the day before the
 * draft begins; the draft seals with its end the day before the next sealed version, open where there
 * is none. One batch, because the collection reads the batch to see the predecessor ended: two writes
 * would leave a shortened predecessor and an unsealed draft if the seal refused.
 */

import type { Id, Instant } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { addDays } from '../lib/payroll/run/dates.js';
import { governed } from './jurisdiction_settings.js';

type VersionRow = {
	readonly id: Id<'jurisdiction_settings'>;
	readonly effective_range: unknown;
	readonly sealed_at: string | null;
	readonly voided_at: string | null;
};

/** One update of the seal's batch: `{ target, set }`, as `ctx.act('jurisdiction_settings.update', …)` takes it. */
export type SealWrite = {
	readonly target: Id<'jurisdiction_settings'>;
	readonly set: {
		readonly effective_range: { from: PlainDate; to: PlainDate | null };
		readonly sealed_at?: Instant;
	};
};

/** The sealed, live neighbours a draft slots between, by start day. */
export function sealNeighbours<T extends VersionRow>(
	draft: T,
	lineage: readonly T[]
): { readonly before: T | undefined; readonly after: T | undefined } {
	const start = governed(draft.effective_range)?.from ?? '';
	const live = lineage
		.filter((row) => row.id !== draft.id && row.sealed_at != null && row.voided_at == null)
		.map((row) => ({ row, start: governed(row.effective_range)?.from ?? '' }))
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
	sealedAt: Instant
): readonly SealWrite[] {
	const start = governed(draft.effective_range)?.from ?? '';
	const { before, after } = sealNeighbours(draft, lineage);
	const predecessor =
		before == null
			? []
			: [
					{
						target: before.id,
						set: {
							effective_range: {
								from: PlainDate(governed(before.effective_range)!.from),
								to: PlainDate(addDays(start, -1))
							}
						}
					}
				];
	const successorStart = after == null ? null : governed(after.effective_range)!.from;
	return [
		...predecessor,
		{
			target: draft.id,
			set: {
				effective_range: {
					from: PlainDate(start),
					to: successorStart == null ? null : PlainDate(addDays(successorStart, -1))
				},
				sealed_at: sealedAt
			}
		}
	];
}
