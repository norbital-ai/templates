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
