import { Schema } from 'effect';
import type { Json } from '@norbital-ai/ui';

/** A JSON object value, or null when the field holds anything else. */
export const asObject = (entry: unknown): Record<string, Json> | null =>
	Schema.is(Schema.Record(Schema.String, Schema.Json))(entry) ? entry : null;

/** A JSON list (`Array.isArray` narrows no readonly list). */
export const isJsonList = (value: Json | undefined): value is readonly Json[] =>
	Array.isArray(value);

/** A JSON object: neither a scalar nor a list. */
export const isJsonRecord: (value: Json | undefined) => value is { readonly [key: string]: Json } =
	Schema.is(Schema.Record(Schema.String, Schema.Json));

/** A finite number member, else null for the input. */
export const numberOf = (entry: Record<string, Json>, key: string): number | null => {
	const held = entry[key];
	return Schema.is(Schema.Number)(held) && Number.isFinite(held) ? held : null;
};
