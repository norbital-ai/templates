import { Effect, Schema } from 'effect';
import type { DynamicAnswer, Id } from '@norbital-ai/bolt';
import type { ReadFailed } from '@norbital-ai/bolt/errors';
import { dynamicRead, type DynamicRead, type ReadRequestJson } from '@norbital-ai/bolt/protocol';
import { inputSchema } from '@norbital-ai/std/kind';
import { JsonObject } from './contracts.js';
import { jsonValues, Refusal } from './foundation.js';

export interface Reader {
	(request: DynamicRead): Effect.Effect<DynamicAnswer, ReadFailed>;
}
export const queryRows = Effect.fn('payroll.queryRows')(function* (
	read: Reader,
	request: ReadRequestJson
) {
	const pages = yield* read(dynamicRead(request));
	const result: Record<string, readonly JsonObject[]> = {};
	for (const [name, page] of Object.entries(pages)) {
		if (page.next != null)
			return yield* Effect.fail(
				new Refusal({
					message: `${name}: the declared read exceeds its bounded scope; calculation cannot use an incomplete page.`
				})
			);
		result[name] = Schema.decodeUnknownSync(Schema.Array(JsonObject))(jsonValues(page.rows));
	}
	return result;
});
export function idOf<C extends string>(model: C, value: unknown): Id<C> {
	const codec = inputSchema({ kind: 'id', of: model });
	return Schema.decodeUnknownSync(
		Schema.declare<Id<C>>(
			(candidate): candidate is Id<C> =>
				typeof candidate === 'string' && Schema.is(codec)(candidate)
		)
	)(value);
}
export const valueText = (row: JsonObject, key: string): string => {
	const value = row[key];
	if (typeof value !== 'string') throw new Refusal({ message: `${key}: missing text fact.` });
	return value;
};
export const objectValue = (value: unknown): JsonObject =>
	Schema.decodeUnknownSync(JsonObject)(jsonValues(value));
/** Automation reads may page; guarded write callbacks use queryRows and keep their fixed two-read budget. */
export const queryAllRows = Effect.fn('payroll.queryAllRows')(function* (
	read: Reader,
	request: ReadRequestJson,
	ceiling = 100000
) {
	const result: Record<string, JsonObject[]> = {};
	let pending: ReadRequestJson = request;
	for (let pageIndex = 0; Object.keys(pending).length > 0; pageIndex++) {
		if (pageIndex >= 100)
			throw new Refusal({
				message: 'The explicit automation history read exceeded its page bound.'
			});
		const pages = yield* read(dynamicRead(pending)),
			next: Record<string, ReadRequestJson[string]> = {};
		for (const [name, page] of Object.entries(pages)) {
			const rows = Schema.decodeUnknownSync(Schema.Array(JsonObject))(jsonValues(page.rows)),
				existing = (result[name] ??= []);
			existing.push(...rows);
			if (existing.length > ceiling)
				throw new Refusal({
					message: `${name}: the scoped history exceeds ${ceiling} rows. Narrow its employee/date scope before calculation.`
				});
			result[name] = existing;
			if (page.next != null) {
				const spec = request[name];
				if (spec === undefined) throw new Refusal({ message: 'Unexpected paged read layer.' });
				next[name] = { ...spec, after: page.next };
			}
		}
		pending = next;
	}
	return result;
});
