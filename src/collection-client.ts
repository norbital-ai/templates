import { client, type WorkspaceCollections } from '$bolt/client';
import type { CollectionClient } from '@norbital-ai/std/collection';

/**
 * The workspace's typed collection client.
 *
 * The generated `$bolt/client` declares `client` with a dynamic `db` surface, while the runtime
 * proxy the artifact mounts actually serves one operations object per declared collection plus the
 * `collections` catalog and `records` accessor the collection surfaces read. This module is the
 * template's typed view of that same object: the shape is verified at runtime the same way
 * `@norbital-ai/ui`'s own `resolveCollectionClient` verifies it, then exposed against the
 * generated `WorkspaceCollections` registry so surfaces get fully typed rows and field names.
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
