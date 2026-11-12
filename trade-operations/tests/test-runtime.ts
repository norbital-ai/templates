import type { Id, ModelName, ReadAnswer, ReadRequest, ReadRequestBase } from '@norbital-ai/bolt';
import { Context, Effect, Layer, Predicate, Schema } from 'effect';
import {
	TestWorkspace,
	type Caller,
	type Kit,
	type TestOptions,
	type TestPorts
} from '@norbital-ai/bolt-cli/test';
import type { EngineManifest } from '@norbital-ai/bolt/engine';
import { input_schema, type Kind } from '@norbital-ai/std/kind';
import { Decimal } from '@norbital-ai/std/decimal';
import { expect } from '@effect/vitest';
expect.addEqualityTesters([
	(left: unknown, right: unknown) =>
		left instanceof Decimal && right instanceof Decimal
			? left.toString() === right.toString()
			: undefined
]);
/** Each caller owns this workspace's scope and every engine service it acquired. */
export const workspace = Effect.fnUntraced(function* <P extends TestPorts = never>(
	options: TestOptions<P>
) {
	const services = yield* Layer.build(TestWorkspace.layer({ ...options }));
	const t = Context.get(services, TestWorkspace);
	/** A caller whose reads answer the request's own typed tree, checked against the running manifest. */
	const typed = (who: Caller) => ({
		...who,
		query: <const R extends ReadRequestBase>(request: ReadRequest<R>) =>
			who
				.query(request)
				.pipe(Effect.flatMap(Schema.decodeUnknownEffect(answer<R>(t.manifest, request))))
	});
	/** A row as it now stands, the target a write names: its id at its stored revision. */
	const at = Effect.fnUntraced(function* <C extends ModelName>(model: C, id: Id<C>) {
		const revision = yield* t.db.value(Schema.Int, {
			text: `SELECT revision FROM ${model} WHERE id = $1`,
			params: [id]
		});
		return { id, revision };
	});
	return {
		...t,
		at,
		as: (who: Parameters<Kit['as']>[0]) => Effect.map(t.as(who), typed),
		visitor: (...args: Parameters<Kit['visitor']>) => Effect.map(t.visitor(...args), typed)
	};
});
export type Typed = Effect.Success<ReturnType<Effect.Success<ReturnType<typeof workspace>>['as']>>;
const OPTIONS = new Set([
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
/**
 * The request's answer as the running manifest shapes it: each root a page of rows, each named field by its kind's own
 * codec (a ref's id, a system column), a ref layer in place of its key (the row or `null`) and a many-layer as its rows.
 * Only a value this schema admits takes the request's static answer type.
 */
const answer = <R extends ReadRequestBase>(m: EngineManifest, request: R) => {
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
			...Object.entries(m.models[model]?.fields ?? {}).map(([name, kind]): [string, Schema.Top] => [
				name,
				value(kind)
			]),
			...Object.entries(m.relationships).flatMap(([key, spec]): [string, Schema.Top][] =>
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
		for (const [name, value] of own) {
			if (named !== undefined && !named.has(name)) continue;
			columns[name] = named === undefined ? Schema.optionalKey(value) : value;
		}
		for (const [name, value] of Object.entries(system)) if (named?.has(name)) columns[name] = value;
		for (const [relation, child] of Object.entries(layer)) {
			if (OPTIONS.has(relation)) continue;
			const own = m.relationships[`${model}.${relation}`];
			const target = own?.to;
			if (typeof target === 'string') {
				columns[relation] =
					own?.optional === true ? Schema.NullOr(row(target, child)) : row(target, child);
				continue;
			}
			const many = Object.entries(m.relationships).find(
				([key, spec]) => spec.to === model && spec.inverse === relation && key.includes('.')
			);
			if (many === undefined) throw new Error(`${model}.${relation}: no relation`);
			columns[relation] = Schema.Array(row(many[0].slice(0, many[0].indexOf('.')), child));
		}
		return Schema.StructWithRest(Schema.Struct(columns), [
			Schema.Record(Schema.String, Schema.Unknown)
		]);
	};
	const page = (model: string, node: unknown) =>
		Schema.Struct({
			rows: Schema.Array(row(model, node)),
			next: Schema.optionalKey(Schema.NullOr(Schema.String)),
			total: Schema.optionalKey(Schema.Number)
		});
	const whole = Schema.Struct(
		Object.fromEntries(Object.entries(request).map(([root, node]) => [root, page(root, node)]))
	);
	return Schema.declare<ReadAnswer<R>>((input): input is ReadAnswer<R> => Schema.is(whole)(input));
};
export type T = Effect.Success<ReturnType<typeof workspace>>;
/** Named integration slots use the catalogue's text identity; other fixture references use UUIDs. */
export const fixtureId = <C extends string>(model: C, value: string) =>
	Schema.decodeUnknownSync(
		Schema.declare<Id<C>>((input): input is Id<C> =>
			Schema.is(
				input_schema(model === 'sys_integration' ? { kind: 'text' } : { kind: 'ref', to: model })
			)(input)
		)
	)(value);
/** Native caller decimals retain the exact text previously asserted at the wire edge. */
export const decimalText = (expected: string) => ({
	asymmetricMatch: (value: unknown) => value instanceof Decimal && value.toString() === expected,
	toString: () => `Decimal(${expected})`,
	getExpectedType: () => 'Decimal'
});
export function firstRow<A>(rows: readonly A[]) {
	const row = rows[0];
	if (row === undefined) throw new Error('Fixture row required');
	return row;
}
