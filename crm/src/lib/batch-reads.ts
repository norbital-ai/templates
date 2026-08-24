import { Effect } from 'effect';

/**
 * Rows keyed by id, for the ids a batch of inputs actually names.
 *
 * One query for the batch, or none at all when nothing in it names a row — which is what makes a
 * `prepare` cheaper than the per-record read it replaces.
 */
export function rowsById<Input, Row extends { readonly id: string }>(
	inputs: readonly Input[],
	pick: (input: Input) => string | null | undefined,
	read: (ids: readonly string[]) => Effect.Effect<readonly Row[]>
): Effect.Effect<ReadonlyMap<string, Row>> {
	const ids = [
		...new Set(
			inputs.flatMap((input) => {
				const id = pick(input);
				return id ? [id] : [];
			})
		)
	];
	if (ids.length === 0) return Effect.succeed(new Map<string, Row>());
	return Effect.map(read(ids), (rows) => new Map(rows.map((row) => [row.id, row])));
}
