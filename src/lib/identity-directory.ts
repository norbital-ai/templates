import { Effect } from 'effect';

/**
 * The people directory, for host-side handlers.
 *
 * `bolt_auth_user` is a runtime-owned collection: `withSystemCollections` merges it into every
 * workspace definition, and the runtime's `bolt.system-collections` policy grants `read` on it to any
 * authenticated subject with the field mask `['norbital_id', 'name']`. So an id and a display name are
 * readable from a hook, a pipeline or a remote — and the address, status and team are not merely
 * unselected, they cannot be read through that grant at all.
 *
 * What is missing is only the *type*. `BeforeApi['db']['query']` is generated as
 * `{ [N in TableName<S>]: … } & { approval_request: … }`, and `TableName<S>` is the authored
 * collections; the runtime object behind it is a `Proxy` that answers any string by name. So the
 * directory exists at runtime and is invisible to TypeScript, and this module is the single place
 * that says so — the same adaptation `src/lib/workspace-client.ts` performs for the browser client,
 * at the same authoring boundary, rather than a cast repeated at each of the three call sites.
 *
 * **This is a gap in `@norbital-ai/bolt` and should be closed there.** `approval_request` is already
 * spliced onto `db.query` as a named exception for exactly this reason; `bolt_auth_user`, typed as
 * `DirectoryUser`, belongs beside it. Delete this module the day it is.
 */

/** A person, as much of one as the field mask returns. */
export interface DirectoryUser {
	readonly norbital_id: string;
	readonly name: string;
}

/** The subset of the runtime collection query this module uses. */
interface DirectoryQuery {
	readonly findMany: (input?: {
		readonly where?: Readonly<Record<string, unknown>>;
		readonly columns?: Readonly<Record<string, boolean>>;
		readonly orderBy?: Readonly<Record<string, 'asc' | 'desc'>>;
		readonly limit?: number;
	}) => Effect.Effect<ReadonlyArray<DirectoryUser>>;
}

/** Any authored handler's `api`, narrowed to the one member this needs. */
interface HandlerApi {
	readonly db: { readonly query: unknown };
}

const DIRECTORY_LIMIT = 5_000;

const directoryQuery = (api: HandlerApi): DirectoryQuery =>
	(api.db.query as Readonly<Record<string, DirectoryQuery>>).bolt_auth_user;

/**
 * The named people behind a set of ids.
 *
 * An id with no row is simply absent from the result — that is what makes this usable as an existence
 * check as well as a name lookup, and why callers read the map rather than trusting the ids they were
 * handed.
 */
export const usersById = (
	api: HandlerApi,
	ids: ReadonlyArray<string>
): Effect.Effect<ReadonlyMap<string, DirectoryUser>> =>
	Effect.gen(function* () {
		if (ids.length === 0) return new Map<string, DirectoryUser>();
		const rows = yield* directoryQuery(api).findMany({
			where: { norbital_id: { in: [...new Set(ids)] } },
			columns: { norbital_id: true, name: true },
			limit: DIRECTORY_LIMIT
		});
		return new Map(rows.map((row) => [row.norbital_id, row]));
	});

/**
 * Every person in the workspace, keyed by case-folded display name.
 *
 * A name is not unique the way an address is, so a name claimed by two people resolves to neither:
 * the entry is dropped and the caller reports the name as unresolvable rather than silently
 * dispatching work to whichever row the database returned first. The address that *would* be unique
 * is outside the field mask, so it is not available to disambiguate with.
 */
export const usersByName = (api: HandlerApi): Effect.Effect<ReadonlyMap<string, DirectoryUser>> =>
	Effect.gen(function* () {
		const rows = yield* directoryQuery(api).findMany({
			columns: { norbital_id: true, name: true },
			orderBy: { name: 'asc' },
			limit: DIRECTORY_LIMIT
		});
		const byName = new Map<string, DirectoryUser>();
		const ambiguous = new Set<string>();
		for (const row of rows) {
			const key = row.name.trim().toLowerCase();
			if (byName.has(key)) ambiguous.add(key);
			byName.set(key, row);
		}
		for (const key of ambiguous) byName.delete(key);
		return byName;
	});
