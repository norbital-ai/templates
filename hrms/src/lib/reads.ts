import { Effect, Predicate, Record as Records, Schema } from 'effect';
import {
	id_of,
	type Id,
	type ReadRequest,
	type ReadRequestBase,
	type WorkspaceQuery
} from '@norbital-ai/bolt';
import { JsonObject } from './contracts.js';
import { calculated, getErrorMessage, jsonValues, Refusal } from './foundation.js';

/** A server body's typed read: every request is a literal over model names, bounded by its `limit`. */
export type Reader = WorkspaceQuery['query'];
/**
 * One typed, bounded read, its rows as the calculation's plain objects, each typed as its read layer. A root that did
 * not fit its `limit` is refused: no calculation works on a cut page.
 */
export const queryRows = <const R extends ReadRequestBase>(read: Reader, request: ReadRequest<R>) =>
	read(request).pipe(
		Effect.flatMap((pages) =>
			Effect.try({
				try: () => {
					const copies = Schema.decodeUnknownSync(
						Schema.Record(Schema.String, Schema.Array(JsonObject))
					)(
						Records.map<keyof R & string, unknown, unknown>(pages, (page, name) => {
							if (!Predicate.hasProperty(page, 'rows'))
								throw new Refusal({ message: `${name}: the read answered no rows.` });
							if (Predicate.hasProperty(page, 'next') && page.next != null)
								throw new Refusal({
									message: `${name}: more rows than its read's limit; calculation cannot use an incomplete page.`
								});
							return jsonValues(page.rows);
						})
					);
					if (!calculated(copies, pages))
						throw new Refusal({ message: 'A decimal fact did not read as a number.' });
					return copies;
				},
				catch: (error) =>
					error instanceof Refusal ? error : new Refusal({ message: getErrorMessage(error) })
			})
		)
	);
export function idOf<C extends Parameters<typeof id_of>[0]>(model: C, value: unknown): Id<C> {
	return Schema.decodeUnknownSync(id_of(model))(value);
}
/** Ids of one model, each decoded: what a typed `in` filter takes. */
export const idsOf = <C extends Parameters<typeof id_of>[0]>(
	model: C,
	values: Iterable<unknown>
): Id<C>[] => [...new Set([...values].map(String))].map((value) => idOf(model, value));
export const valueText = (row: JsonObject, key: string): string => {
	const value = row[key];
	if (typeof value !== 'string') throw new Refusal({ message: `${key}: missing text fact.` });
	return value;
};
// a row's own object is decoded once however often a calculation asks for it
const objects = new WeakMap<object, JsonObject>();
export const objectValue = (value: unknown): JsonObject => {
	const held = typeof value === 'object' && value !== null ? objects.get(value) : undefined;
	if (held !== undefined) return held;
	const decoded = Schema.decodeUnknownSync(JsonObject)(jsonValues(value));
	if (typeof value === 'object' && value !== null) objects.set(value, decoded);
	objects.set(decoded, decoded);
	return decoded;
};
/** A registered rule's or effect's reads: one layer per model, its filter, its row limit and the fields it keeps. */
export const READS_SHAPE = {
	kind: 'record',
	of: {
		kind: 'object',
		fields: {
			where: {
				kind: 'json',
				optional: true
			},
			limit: {
				kind: 'number',
				optional: true,
				min: 1
			},
			fields: {
				kind: 'text',
				many: true,
				optional: true
			}
		}
	}
} as const;
