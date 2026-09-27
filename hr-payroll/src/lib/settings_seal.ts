import { refuse } from './refuse.js';
import { readAll, type Reads } from './reads.js';
import { describeVersion } from './jurisdiction_settings.js';

/**
 * The seal, enforced structurally on every downstream row.
 *
 * Each family catalogue under `jurisdiction_settings`, and contribution rules through their
 * scheme, checks this in its transform. It reads the root as the workspace, so no policy can
 * bypass it: a row whose version is sealed refuses to be created or changed, in one sentence
 * naming the version. A row that moves between versions is checked against both. Deleting a row
 * of a sealed version is refused by the delete grant (`lib/policy_grants.ts`), which reads the
 * same fact.
 */
export type SealedVersion = Readonly<{
	id: string;
	code: string;
	name: string | null;
	sealed_at: string | null;
}>;

/** One read for the whole batch: every version the inputs and their stored rows name. */
export async function versionsById(
	reads: Reads,
	settingsIds: ReadonlyArray<unknown>
): Promise<ReadonlyMap<string, SealedVersion>> {
	const ids = [...new Set(settingsIds.filter((id): id is string => id != null && id !== ''))];
	const rows = await readAll<SealedVersion>(reads, 'jurisdiction_settings', { id: { in: ids } });
	return new Map(rows.map((row) => [row.id, row]));
}

/** Refuses when the version is missing or sealed. A row with no parent yet passes. */
function refuseUnlessDraft(
	versions: ReadonlyMap<string, SealedVersion>,
	settingsId: unknown,
	what: string
): void {
	// A row nested under the root in the same write has no parent key yet. Its parent is the root
	// being written, whose own transform refuses nested rows under a seal; a top-level row without
	// a parent fails the column's NOT NULL instead.
	if (settingsId == null || settingsId === '') return;
	const version = versions.get(String(settingsId));
	if (version == null) refuse(`${what} names a jurisdiction settings version that does not exist.`);
	if (version.sealed_at != null)
		refuse(
			`${what} belongs to ${describeVersion(version)}, which is sealed, so it cannot be ` +
				'created, changed or deleted. Enact a new version of the settings instead.'
		);
}

/** Both versions a write may touch: the one the row is stored under and the one it names. */
export function refuseUnlessDraftOnBoth(
	versions: ReadonlyMap<string, SealedVersion>,
	storedSettingsId: unknown,
	inputSettingsId: unknown,
	what: string
): void {
	for (const id of new Set([storedSettingsId, inputSettingsId]))
		refuseUnlessDraft(versions, id, what);
}
