import { Effect, Schema } from 'effect';
import { id_of, type Id, type WorkspaceQuery } from '@norbital-ai/bolt';
import type { ReadFailed } from '@norbital-ai/bolt/errors';
import { dynamic_read, type DynamicRead, type ReadRequestJson } from '@norbital-ai/bolt/protocol';
import { JsonObject } from './contracts.js';
import { isJsonObject, jsonValues, Refusal } from './foundation.js';

/** What `ctx.query(dynamic_read(…))` answers. */
type DynamicAnswer = Effect.Success<ReturnType<WorkspaceQuery['query']>>;
/** A field read's page; a dynamic answer may also be a search or an aggregate, which no calculation asks for. */
const rowsOf = (name: string, page: DynamicAnswer[string]) => {
	if (!('rows' in page)) throw new Refusal({ message: `${name}: the read answered no rows.` });
	return page;
};
export interface Reader {
	(request: DynamicRead): Effect.Effect<DynamicAnswer, ReadFailed>;
}
export const queryRows = Effect.fn('payroll.queryRows')(function* (
	read: Reader,
	request: ReadRequestJson
) {
	const pages = yield* read(dynamic_read(request));
	const result: Record<string, readonly JsonObject[]> = {};
	for (const [name, answer] of Object.entries(pages)) {
		const page = rowsOf(name, answer);
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
export function idOf<C extends Parameters<typeof id_of>[0]>(model: C, value: unknown): Id<C> {
	return Schema.decodeUnknownSync(id_of(model))(value);
}
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
		const pages = yield* read(dynamic_read(pending)),
			next: Record<string, ReadRequestJson[string]> = {};
		for (const [name, answer] of Object.entries(pages)) {
			const page = rowsOf(name, answer);
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
				if (!isJsonObject(spec)) throw new Refusal({ message: 'Unexpected paged read layer.' });
				next[name] = { ...spec, after: page.next };
			}
		}
		pending = next;
	}
	return result;
});

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
