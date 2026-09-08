import { refuse, type Api } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';
import { describeVersion } from './jurisdiction_settings.js';

/**
 * The seal, enforced structurally on every downstream row.
 *
 * Each family catalogue under `jurisdiction_settings`, and contribution bands through their
 * scheme, calls this from its `mutate.before` and `delete.before`. It
 * reads the root as the workspace, so no policy can bypass it: a row whose version is sealed
 * refuses to be created, changed or deleted, in one sentence naming the version. A row that moves
 * between versions is checked against both.
 */
type SealReadApi = Readonly<{
	readonly db: Pick<Api<WorkspaceSchema, unknown>['db'], 'jurisdiction_settings'>;
}>;

function refuseUnlessDraft(
	api: SealReadApi,
	settingsId: unknown,
	what: string
): Effect.Effect<void> {
	// A row nested under the root in the same write reaches its hook before the runtime stamps
	// the parent key. Its parent is the root being written, whose own hook refuses nested rows
	// under a seal; a top-level row without a parent fails the column's NOT NULL instead.
	if (settingsId == null || settingsId === '') return Effect.void;
	return Effect.map(
		api.db.jurisdiction_settings.findFirst({
			where: { id: { eq: String(settingsId) } },
			columns: { id: true, code: true, name: true, sealed_at: true }
		}),
		(version) => {
			if (version == null)
				refuse(`${what} names a jurisdiction settings version that does not exist.`);
			if (version.sealed_at != null)
				refuse(
					`${what} belongs to ${describeVersion(version)}, which is sealed, so it cannot be ` +
						'created, changed or deleted. Enact a new version of the settings instead.'
				);
		}
	);
}

/** Both versions a write may touch: the one the row is stored under and the one it names. */
export function refuseUnlessDraftOnBoth(
	api: SealReadApi,
	storedSettingsId: unknown,
	inputSettingsId: unknown,
	what: string
): Effect.Effect<void> {
	const targets = [...new Set([storedSettingsId, inputSettingsId].filter((id) => id != null))];
	return Effect.forEach(targets, (id) => refuseUnlessDraft(api, id, what)).pipe(Effect.asVoid);
}
