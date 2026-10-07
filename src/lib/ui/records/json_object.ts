import { Schema } from 'effect';
import type { Json } from '@norbital-ai/ui';

/** A JSON object value, or null when the field holds anything else. */
export const asObject = (entry: unknown): Record<string, Json> | null =>
	Schema.is(Schema.Record(Schema.String, Schema.Json))(entry) ? entry : null;

/** A string member, else empty for the input. */
export const textOf = (entry: Record<string, Json>, key: string): string => {
	const held = entry[key];
	return Schema.is(Schema.String)(held) ? held : '';
};

/** A finite number member, else null for the input. */
export const numberOf = (entry: Record<string, Json>, key: string): number | null => {
	const held = entry[key];
	return Schema.is(Schema.Number)(held) && Number.isFinite(held) ? held : null;
};
