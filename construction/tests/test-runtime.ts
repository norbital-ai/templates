import {
	id_of,
	input_schema,
	type Id,
	type Kind,
	type ReadAnswer,
	type ReadRequest,
	type ReadRequestBase
} from '@norbital-ai/bolt';
import type { EngineManifest } from '@norbital-ai/bolt/engine';
import { Context, Effect, Layer, Predicate, Schema } from 'effect';
import { TestWorkspace, type Caller, type TestOptions } from '@norbital-ai/bolt-cli/test';

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

const READ_OPTIONS = new Set([
	'where',
	'fields',
	'order_by',
	'limit',
	'search',
	'aggregate',
	'output',
	'after',
	'as_of'
]);

/** Decodes a TestWorkspace query result against the running manifest into `ReadAnswer<R>`. */
export function queryTyped<const R extends ReadRequestBase>(
	who: Caller,
	manifest: EngineManifest,
	request: ReadRequest<R>
) {
	const value = (kind: Kind) => Schema.NullOr(Schema.toType(input_schema(kind)));
	const instant = Schema.toType(input_schema({ kind: 'instant' }));
	const system: Record<string, Schema.Top> = {
		id: Schema.String,
		revision: Schema.Int,
		created_at: instant,
		updated_at: instant,
		created_by: Schema.NullOr(Schema.String),
		updated_by: Schema.NullOr(Schema.String)
	};
	const row = (model: string, node: unknown): Schema.Top => {
		const layer = Predicate.isObject(node) ? node : {};
		const named = Array.isArray(layer['fields']) ? new Set(layer['fields'].map(String)) : undefined;
		const columns: Record<string, Schema.Top> = { id: Schema.String };
		const own: [string, Schema.Top][] = [
			...Object.entries(manifest.models[model]?.fields ?? {}).map(
				([name, kind]): [string, Schema.Top] => [name, value(kind)]
			),
			...Object.entries(manifest.relationships).flatMap(([key, spec]): [string, Schema.Top][] =>
				key.startsWith(`${model}.`) && typeof spec.to === 'string'
					? [
							[
								key.slice(model.length + 1),
								spec.optional === true ? Schema.NullOr(Schema.String) : Schema.String
							]
						]
					: []
			)
		];
		for (const [name, fieldSchema] of own) {
			if (named !== undefined && !named.has(name)) continue;
			columns[name] = named === undefined ? Schema.optionalKey(fieldSchema) : fieldSchema;
		}
		for (const [name, fieldSchema] of Object.entries(system)) {
			if (named?.has(name)) columns[name] = fieldSchema;
		}
		for (const [relation, child] of Object.entries(layer)) {
			if (READ_OPTIONS.has(relation)) continue;
			const rel = manifest.relationships[`${model}.${relation}`];
			const target = rel?.to;
			if (typeof target === 'string') {
				columns[relation] =
					rel?.optional === true ? Schema.NullOr(row(target, child)) : row(target, child);
				continue;
			}
			const many = Object.entries(manifest.relationships).find(
				([key, spec]) => spec.to === model && spec.inverse === relation && key.includes('.')
			);
			if (many === undefined) throw new Error(`${model}.${relation}: no relation`);
			columns[relation] = Schema.Array(row(many[0].slice(0, many[0].indexOf('.')), child));
		}
		return Schema.StructWithRest(Schema.Struct(columns), [
			Schema.Record(Schema.String, Schema.Unknown)
		]);
	};
	const whole = Schema.Struct(
		Object.fromEntries(
			Object.entries(request).map(([root, node]) => [
				root,
				Schema.Struct({
					rows: Schema.Array(row(root, node)),
					next: Schema.optionalKey(Schema.NullOr(Schema.String)),
					total: Schema.optionalKey(Schema.Number)
				})
			])
		)
	);
	const codec = Schema.declare<ReadAnswer<R>>((input): input is ReadAnswer<R> =>
		Schema.is(whole)(input)
	);
	return who.query(request).pipe(Effect.flatMap(Schema.decodeUnknownEffect(codec)));
}
