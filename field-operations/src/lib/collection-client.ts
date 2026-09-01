import { client, type WorkspaceCollections } from '$bolt/client';
import { resolveCollectionClient } from '@norbital-ai/ui/collection-runtime';

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
const resolved = resolveCollectionClient<WorkspaceCollections>(client);
if (!resolved) throw new Error('Workspace collection client is unavailable.');
// Exported from the narrowed binding, not re-exported from the nullable one: `export { x }` carries
// a binding's *declared* type, so the guard above proved something the consumers never saw and every
// surface received `CollectionClient | undefined`.
export const collectionClient = resolved;
