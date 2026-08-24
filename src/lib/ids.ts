/**
 * The one place this workspace mints an identifier from the platform's generator.
 *
 * Deliberately free of any Effect import: these are the two situations that have no runtime to draw
 * an injected `Random` from — a renderer keying rows in a list it holds in memory, and a command
 * whose envelope requires an id it never stores. Both want an opaque unique string and nothing
 * more, so the ambient read lives here, named, instead of scattered through Effect-owned modules
 * where it would read as unmanaged nondeterminism.
 */

/** A fresh opaque identifier. Never a value the database is asked to keep. */
export function newLocalId(): string {
	return crypto.randomUUID();
}
