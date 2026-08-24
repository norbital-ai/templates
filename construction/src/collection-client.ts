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
function isWorkspaceClient(candidate: object): candidate is CollectionClient<WorkspaceCollections> {
	const db = Reflect.get(candidate, 'db');
	const collections = Reflect.get(candidate, 'collections');
	const records = Reflect.get(candidate, 'records');
	return (
		db !== null &&
		typeof db === 'object' &&
		collections !== null &&
		typeof collections === 'object' &&
		records !== null &&
		typeof records === 'object' &&
		typeof Reflect.get(records, 'findMany') === 'function'
	);
}

if (!isWorkspaceClient(client)) throw new Error('Workspace collection client is unavailable.');
export const collectionClient = client;
