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
	const db = Object.fromEntries(
		Object.entries(tables).map(([name, rows]) => [
			name,
			{
				findFirst: ({ where } = {}) =>
					Effect.succeed(rows.find((row) => matches(row, where)) ?? null),
				findMany: ({ where } = {}) => Effect.succeed(rows.filter((row) => matches(row, where)))
			}
		])
	);
	return { db };
}
