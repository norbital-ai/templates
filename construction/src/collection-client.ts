import { client, type WorkspaceCollections } from '$bolt/client';
import { resolveCollectionClient } from '@norbital-ai/ui/collection-runtime';

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
const resolved = resolveCollectionClient<WorkspaceCollections>(client);
if (!resolved) throw new Error('Workspace collection client is unavailable.');
// Exported from the narrowed binding, not re-exported from the nullable one: `export { x }` carries
// a binding's *declared* type, so the guard above proved something the consumers never saw and every
// surface received `CollectionClient | undefined`.
export const collectionClient = resolved;
