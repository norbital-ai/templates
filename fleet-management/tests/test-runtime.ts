import { id_of, type Id } from '@norbital-ai/bolt';
import { Context, Effect, Layer, Schema } from 'effect';
import { TestWorkspace, type TestOptions } from '@norbital-ai/bolt-cli/test';

type ModelTarget = Parameters<typeof id_of>[0];

/** Each caller owns this workspace's scope. */
export const workspace = Effect.fnUntraced(function* (options: TestOptions) {
	const services = yield* Layer.build(TestWorkspace.layer({ ...options }));
	return Context.get(services, TestWorkspace);
});

export type T = Effect.Success<ReturnType<typeof workspace>>;

/** Validates a fixture or returned record ID through the workspace's own `id_of` codec. */
export function fixtureId<const C extends ModelTarget>(model: C, value: string): Id<C> {
	return Schema.decodeUnknownSync(id_of(model))(value);
}

/** Finds a committed record by model name and returns its branded ID and revision. */
export function recordOf<const C extends ModelTarget>(
	records: readonly { readonly model: string; readonly id: string; readonly revision: number }[],
	model: C,
	index = 0
): { readonly id: Id<C>; readonly revision: number } {
	const matches = records.filter((r) => r.model === model);
	const hit = matches[index];
	if (hit === undefined) throw new Error(`Missing committed record ${model}[${index}]`);
	return { id: fixtureId(model, hit.id), revision: hit.revision };
}

/** Extracts rows from a TestWorkspace query answer for one model. */
export function rowsOf(
	answer: Readonly<Record<string, unknown>>,
	model: string
): readonly Readonly<Record<string, unknown>>[] {
	const entry = answer[model];
	if (entry !== null && typeof entry === 'object' && 'rows' in entry && Array.isArray(entry.rows)) {
		return entry.rows;
	}
	throw new Error(`Expected rows for model '${model}'`);
}
