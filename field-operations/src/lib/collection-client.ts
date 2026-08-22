import { client, type WorkspaceCollections } from '$bolt/client';
import type { CollectionClient } from '@norbital-ai/std/collection';

/**
 * The workspace's typed collection client.
 *
 * The generated `$bolt/client` declares `client` as the mutable client plus the `invoke` and
 * `system` handles, and that intersection defeats generic inference on every collection surface it
 * is handed to — the row type then falls back to `object`, and a `Field`/`Column` `name` becomes
 * `never`. The runtime proxy the artifact mounts serves exactly one `CollectionClient` worth of
 * shape (per-collection db plus `collections` and `records`), so this module exposes the typed view
 * of that same object: the shape is verified at runtime the same way `@norbital-ai/ui`'s own
 * `resolveCollectionClient` verifies it, then typed against the generated `WorkspaceCollections`
 * registry so surfaces get fully typed rows and field names.
 */
function resolveWorkspaceClient(candidate: object): CollectionClient<WorkspaceCollections> {
	const collections = Reflect.get(candidate, 'collections');
	const records = Reflect.get(candidate, 'records');
	if (collections == null || typeof collections !== 'object') {
		throw new Error('Workspace collection client is unavailable: missing collections catalog.');
	}
	if (records == null || typeof records !== 'object') {
		throw new Error('Workspace collection client is unavailable: missing records accessor.');
	}
	return candidate as CollectionClient<WorkspaceCollections>;
}

export const collectionClient = resolveWorkspaceClient(client);
