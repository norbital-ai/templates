/**
 * The workspace-shaped read API the verifier scripts hand to authored handlers.
 *
 * A handler only ever reads through `api.db.<table>.findFirst/findMany`, so a stub is that
 * shape over in-memory rows. Each script still owns its own `where` matcher — one script needs
 * comparison operators the other does not — and passes it in; the table wiring is one thing and
 * lives here.
 */
import { Effect } from 'effect';

/** @param tables rows by table name @param matches decides whether a row satisfies a `where` */
export function stubApi(tables, matches) {
	/** Ids a handler asked to delete, by table, so a check can assert what went. */
	const deleted = {};
	/** Rows a handler staged through `mutate`, by table, so a check can assert what it wrote. */
	const mutated = {};
	const db = Object.fromEntries(
		Object.entries(tables).map(([name, rows]) => {
			let live = [...rows];
			return [
				name,
				{
					findFirst: ({ where } = {}) =>
						Effect.succeed(live.find((row) => matches(row, where)) ?? null),
					findMany: ({ where } = {}) => Effect.succeed(live.filter((row) => matches(row, where))),
					delete: (ids) =>
						Effect.sync(() => {
							(deleted[name] ??= []).push(...ids);
							live = live.filter((row) => !ids.includes(row.id));
						}),
					mutate: (rows) =>
						Effect.sync(() => {
							(mutated[name] ??= []).push(...rows);
						})
				}
			];
		})
	);
	return { db, deleted, mutated };
}
