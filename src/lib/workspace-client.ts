import { client as runtimeClient } from '$bolt/client';
import type { Client, WorkspaceCollections } from '$bolt/client';
import type {
	CollectionPageQuery as RuntimePageQuery,
	RemoteQuery as RuntimeRemoteQuery
} from '@norbital-ai/bolt/client-runtime';
import type {
	CollectionDbClient,
	CollectionGroupedResult,
	CollectionOperations,
	CollectionPageQuery,
	CollectionRow,
	RemoteQuery
} from '@norbital-ai/std/collection';
import type { Effect } from 'effect';

/**
 * The per-collection database proxy the browser runtime actually carries.
 *
 * The generated `Client` interface only declares the records-style `db.findMany(collection, limit)`
 * surface, while `createWorkspaceApiProxy` builds a proxy whose string properties are per-collection
 * operation objects (`findMany`, `findFirst`, `count`, `create`, `update`, `delete`). This is the
 * shape `CollectionDbClient` requires, so the runtime client is adapted to it once here, at the
 * authoring boundary — the same boundary the UI collection surfaces adapt themselves.
 */
interface RuntimeCollection<TRow extends object> {
	readonly findMany: (input?: object, options?: object) => RuntimePageQuery<TRow[]>;
	readonly findFirst: (input?: object) => RuntimeRemoteQuery<TRow | undefined>;
	readonly count: (input?: object, options?: object) => RuntimeRemoteQuery<number>;
	readonly create: (input: object) => Promise<TRow>;
	readonly update: (recordId: string, input: object) => Promise<TRow>;
	readonly delete: (recordId: string) => Promise<void>;
}

type WorkspaceCollectionName = keyof WorkspaceCollections & string;

/** The runtime reports failures as `unknown`; the collection contract names them `Error`. */
function queryError(error: unknown): Error | undefined {
	if (error instanceof Error) return error;
	return error === undefined ? undefined : new Error(String(error));
}

/** One page from the runtime proxy, restated on the collection contract's read surface. */
function pageOf<TRow extends object>(page: RuntimePageQuery<TRow[]>): CollectionPageQuery<TRow> {
	return {
		get current() {
			return page.current;
		},
		get nextCursor() {
			return page.nextCursor;
		},
		get loading() {
			return page.loading;
		},
		get error() {
			return queryError(page.error);
		},
		refresh: page.refresh
	};
}

/** One settled remote query from the runtime proxy, restated on the collection contract's surface. */
function remoteOf<T>(query: RuntimeRemoteQuery<T>): RemoteQuery<T> {
	return {
		get current() {
			return query.current;
		},
		get loading() {
			return query.loading;
		},
		get error() {
			return queryError(query.error);
		},
		refresh: query.refresh
	};
}

function groupRows<TRow extends object>(
	rows: readonly TRow[],
	by: keyof TRow & string
): CollectionGroupedResult<TRow> {
	const groups: Record<string, TRow[]> = {};
	for (const row of rows) {
		const lane = String(Reflect.get(row, by) ?? '');
		(groups[lane] ??= []).push(row);
	}
	return groups;
}

/**
 * The board has no server-side grouping command on the client path, so `findGrouped` fetches the
 * matching page and groups it by the requested field locally — the same read the table takes,
 * re-persisted by lane.
 */
function groupedQueryOf<TRow extends object>(
	page: RuntimePageQuery<TRow[]>,
	by: keyof TRow & string
): RemoteQuery<CollectionGroupedResult<TRow>> {
	return {
		get current() {
			const rows = page.current;
			return rows === undefined ? undefined : groupRows(rows, by);
		},
		get loading() {
			return page.loading;
		},
		get error() {
			return queryError(page.error);
		},
		refresh: page.refresh
	};
}

function collectionOperations<N extends WorkspaceCollectionName>(
	name: N
): CollectionOperations<WorkspaceCollections[N]> {
	const runtime = (
		runtimeClient as unknown as {
			readonly db: Readonly<
				Record<string, RuntimeCollection<CollectionRow<WorkspaceCollections[N]>>>
			>;
		}
	).db[name];
	return {
		findMany: (query, options) => pageOf(runtime.findMany(query, options)),
		findFirst: (query) => remoteOf(runtime.findFirst(query)),
		count: (query, options) => remoteOf(runtime.count(query, options)),
		findGrouped: (query, options) =>
			groupedQueryOf(runtime.findMany(query, options), query.group.by),
		create: (input) => runtime.create(input),
		update: (recordId, input) => runtime.update(recordId, input),
		delete: (recordId) => runtime.delete(recordId)
	};
}

/**
 * The declared handler contract allows an `Effect` result, but the browser remote only ever delivers
 * the settled output: the Effect runs on the host and the wire carries its value, never the effect
 * itself. Stripping the effect member is what the runtime truth is.
 */
type RemoteValue<Query> = Query extends { readonly current: infer Value } ? Value : never;
type SettledRemoteValue<Query> = Exclude<
	RemoteValue<Query>,
	Effect.Effect<unknown, unknown, never>
>;

/** The generated invoke surface, with the settled output the wire actually carries. */
type WorkspaceInvoke = {
	readonly [K in keyof Client['invoke']]: (
		input: Parameters<Client['invoke'][K]>[0]
	) => RemoteQuery<SettledRemoteValue<ReturnType<Client['invoke'][K]>>>;
};

export interface WorkspaceClient {
	readonly db: CollectionDbClient<WorkspaceCollections>['db'];
	readonly invoke: WorkspaceInvoke;
}

/**
 * The generated client's runtime object, with `db` and `invoke` re-typed to what the proxy and the
 * wire actually carry so apps and collection surfaces stay fully typed.
 */
export const client: WorkspaceClient = {
	...runtimeClient,
	db: {
		job_assignments: collectionOperations('job_assignments'),
		jobs: collectionOperations('jobs'),
		photo_evidence: collectionOperations('photo_evidence'),
		sites: collectionOperations('sites'),
		suspicious_activity_logs: collectionOperations('suspicious_activity_logs'),
		variation_requests: collectionOperations('variation_requests'),
		// `team`, `team_members` and `user` were platform tables until identity became runtime-owned.
		// A person is a row in `bolt_auth_user` whose `team_id` points at the one `bolt_team` row they
		// belong to, and the system read policy grants that row masked to an id and a name — a
		// directory, not a membership list.
		//
		// It is also where an assignment's assignee is described. `contractor_profiles` used to sit
		// here restating a subset of these same people under a company name; the row it added carried
		// nothing this directory does not, and the app that had to fetch one could fail to find it.
		bolt_auth_user: collectionOperations('bolt_auth_user')
	},
	invoke: runtimeClient.invoke as unknown as WorkspaceInvoke
};
