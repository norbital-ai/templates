import type { Effect } from 'effect';
import type { RemoteQuery } from '@norbital-ai/bolt/client-runtime';
import type { CollectionDbClient } from '@norbital-ai/std/collection';
import type { WorkspaceCollections } from '$bolt/client';
import { client as runtimeClient } from '$bolt/client';

export type WorkspaceDb = CollectionDbClient<WorkspaceCollections>['db'];

/**
 * The runtime client's `db` is a per-collection proxy — `db.<collection>.findMany|findFirst|count|
 * create|update|delete` — which is also the contract the design system types its props with
 * (`CollectionDbClient`). Only the generated `Client` declaration disagrees, typing `db` as a
 * generic `findMany(collection, limit)` that matches neither the runtime nor the design system.
 *
 * This is the single boundary where the two shapes meet: the runtime proxy is presented under the
 * `std` collection contract, and every app, renderer and representation in this workspace reads
 * the typed view below rather than the generated declaration.
 */
export const client: CollectionDbClient<WorkspaceCollections> & {
	readonly invoke: WorkspaceInvoke;
} = {
	...runtimeClient,
	db: runtimeClient.db as unknown as WorkspaceDb,
	invoke: runtimeClient.invoke as unknown as WorkspaceInvoke
};

/**
 * The generated invoke type resolves each remote's value through `Awaited<ReturnType<handler>>`,
 * and a handler's declared return includes `Effect.Effect<Output> | Promise<Output> | Output` —
 * so the value type carries a thenable `Effect` member the runtime never produces (the browser
 * proxy resolves the command's JSON response). Stripping that member keeps remote results
 * readable without any runtime change; inputs stay exactly as generated.
 */
type RuntimeInvoke = (typeof runtimeClient)['invoke'];
export type WorkspaceInvoke = {
	readonly [K in keyof RuntimeInvoke]: RuntimeInvoke[K] extends (
		input: infer Input
	) => RemoteQuery<infer Value>
		? (input: Input) => RemoteQuery<Exclude<Value, Effect.Effect<unknown, unknown, never>>>
		: never;
};
