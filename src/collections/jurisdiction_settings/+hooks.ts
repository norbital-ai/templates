import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { readRange, type StoredRange } from '../payroll_runs/lib/effective.js';
import { dateKey } from '../../lib/iso-day.js';
import { describeVersion, halfOpenOverlap, stableJson } from '../../lib/jurisdiction_settings.js';
import type { Hooks, WorkspaceRow } from './$types.js';

/** The two columns a sealed version may still take: the void, once. */
const VOID_COLUMNS = ['voided_at', 'void_reason'] as const;
/** Operational configuration, not law: the holiday source may change under a sealed version. */
const OPERATIONAL = ['holiday_source'] as const;
/** Columns the runtime carries on every write and no rule reads. */
const CARRIED = ['id', 'row_version'] as const;

/**
 * Whether an edit to a sealed version's range only ends it earlier: the same start, and an end at
 * or before the stored one. Sealing a successor ends its predecessor this way; nothing else moves
 * a sealed range.
 */
function onlyShortens(stored: StoredRange | null, next: StoredRange | null): boolean {
	if (stored == null || next == null) return false;
	if (dateKey(stored.start) !== dateKey(next.start)) return false;
	if (next.end == null) return stored.end == null;
	if (dateKey(next.end) < dateKey(next.start)) return false;
	return stored.end == null || dateKey(next.end) <= dateKey(stored.end);
}

/** What the batch says about each version's range, so a predecessor ended in the same write counts. */
type Prepared = { readonly ranges: ReadonlyMap<string, StoredRange> };

export default {
	mutate: {
		prepare: ({ inputs }): Effect.Effect<Prepared> =>
			Effect.sync(() => {
				const ranges = new Map<string, StoredRange>();
				for (const input of inputs) {
					if (input.id == null || !('effective_range' in input)) continue;
					const range = readRange(input.effective_range);
					if (range != null) ranges.set(input.id, range);
				}
				return { ranges };
			}),
		perRecord: {
			before: {
				description:
					'Validates the payroll scope; freezes every column of a sealed version except a one-time void; never unseals; requires a reason to void a version a paid payroll run cites; refuses sealing a version whose range overlaps another sealed unvoided version of its code unless that version is ended in the same write.',
				handler: ({ input, existing, prepared, relationships, api }) =>
					Effect.gen(function* () {
						const row = { ...existing, ...input };
						if (existing != null && existing.sealed_at != null) {
							// A nested row under a sealed version is a child write by another door.
							if (relationships.length > 0)
								refuse(
									`${describeVersion(existing)} is sealed, so nothing can be added under it. Enact a new version instead.`
								);
							if (input.sealed_at === null)
								refuse(
									`${describeVersion(existing)} is never unsealed. Void it and seal a corrected version instead.`
								);
							for (const column of Object.keys(input)) {
								if ((CARRIED as readonly string[]).includes(column)) continue;
								if ((VOID_COLUMNS as readonly string[]).includes(column)) continue;
								if ((OPERATIONAL as readonly string[]).includes(column)) continue;
								if (
									stableJson(input[column as keyof typeof input]) ===
									stableJson(existing[column as keyof typeof existing])
								)
									continue;
								if (
									column === 'effective_range' &&
									onlyShortens(
										readRange(existing.effective_range),
										readRange(input.effective_range)
									)
								)
									continue;
								refuse(
									`${describeVersion(existing)} is sealed, so ${column} cannot change. ` +
										'Enact a new version of the settings instead; a wrong seal is voided.'
								);
							}
							if (existing.voided_at != null && input.voided_at === null)
								refuse(
									`${describeVersion(existing)} is voided; a void is one action, never undone.`
								);
							if (
								existing.voided_at != null &&
								input.void_reason !== undefined &&
								input.void_reason !== existing.void_reason
							)
								refuse(`${describeVersion(existing)} is voided; its reason is part of the record.`);
							if (existing.voided_at == null && input.voided_at != null) {
								const paid = yield* api.db.payroll_runs.findFirst({
									where: { settings_id: { eq: existing.id }, lifecycle: { eq: 'PAID' } },
									columns: { id: true, period: true }
								});
								if (paid != null && String(row.void_reason ?? '').trim() === '')
									refuse(
										`${describeVersion(existing)} priced the paid ${paid.period} payroll run, so voiding it states a reason.`
									);
							}
							return input;
						}
						// A draft, or a create: the whole row is checked.
						if (row.voided_at != null)
							refuse('Only a sealed version can be voided; delete a draft instead.');
						if (row.currency == null || !String(row.jurisdiction_code ?? '').trim())
							refuse('Settings require a currency and payroll jurisdiction.');
						for (const [region, wage] of Object.entries(row.minimum_wages ?? {}))
							if (!(Number(wage) > 0))
								refuse(`The minimum wage of region ${region} must be a positive amount.`);
						if (row.sealed_at == null) return input;
						// Sealing. The database exclusion holds the overlap too; the sentence is why it
						// happens here, and the batch is read so a predecessor ended in the same write counts.
						const range = readRange(row.effective_range);
						if (range == null) refuse('A sealed version states the period it governs.');
						const siblings = yield* api.db.jurisdiction_settings.findMany({
							where: {
								code: { eq: String(row.code) },
								sealed_at: { isNotNull: true },
								voided_at: { isNull: true },
								approval_id: { isNull: true }
							},
							columns: { id: true, name: true, code: true, sealed_at: true, effective_range: true },
							limit: 500
						});
						for (const sibling of siblings) {
							if (existing != null && sibling.id === existing.id) continue;
							const other = prepared.ranges.get(sibling.id) ?? readRange(sibling.effective_range);
							if (other != null && halfOpenOverlap(range, other))
								refuse(
									`Sealed ${String(row.code)} versions cannot overlap: ${sibling.name} already governs ` +
										// The bound is a stored instant; the operator set a day and reads a day back.
										`${dateKey(other.start)} to ${other.end == null ? 'open' : dateKey(other.end)}. ` +
										'Seal from the Settings timeline, which ' +
										'ends the previous version the day before this one begins.'
								);
						}
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'A sealed version is history and is never deleted, only voided; a draft may be deleted with its children.',
				handler: ({ existing }: { readonly existing: WorkspaceRow<'jurisdiction_settings'> }) => {
					if (existing.sealed_at != null)
						refuse(
							`${describeVersion(existing)} is sealed and cannot be deleted. Void it instead.`
						);
				}
			}
		}
	}
} satisfies Hooks<Prepared>;
