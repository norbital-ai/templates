import type { Id } from '@norbital-ai/bolt';
import { input_schema } from '@norbital-ai/bolt';
import { Context, Effect, Layer, Schema } from 'effect';
import { TestWorkspace, type TestOptions } from '@norbital-ai/bolt-cli/test';

/** Each caller owns this workspace's scope. */
export const workspace = Effect.fnUntraced(function* (options: TestOptions) {
	const services = yield* Layer.build(TestWorkspace.layer({ ...options }));
	return Context.get(services, TestWorkspace);
});

export type T = Effect.Success<ReturnType<typeof workspace>>;

/** A declared fixture or returned record ID passes the same UUID boundary as a host record reference. */
export function fixtureId<const C extends string>(model: C, value: string): Id<C> {
	const codec = input_schema({ kind: 'ref', to: model });
	const decoded = Schema.decodeUnknownSync(codec)(value);
	const branded = Schema.declare<Id<C>>(
		(input): input is Id<C> => typeof input === 'string' && Schema.is(Schema.toType(codec))(input)
	);
	return Schema.decodeUnknownSync(branded)(decoded);
}

/** Finds a committed record by model name and returns its branded ID and revision. */
export function recordOf<const C extends string>(
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
