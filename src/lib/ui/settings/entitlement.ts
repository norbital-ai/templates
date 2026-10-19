import type { Json } from '@norbital-ai/ui';
import { Schema } from 'effect';
import { asObject } from '../records/json_object.js';

/** Clearing an optional input removes only that key; undisplayed settings retain their stored values. */
export function setEntitlement(value: unknown, key: string, next: unknown): Json {
	const updated = { ...(asObject(value) ?? {}) };
	if (next === null || next === '') delete updated[key];
	else updated[key] = Schema.decodeUnknownSync(Schema.Json)(next);
	return Object.keys(updated).length === 0 ? null : updated;
}

const windowSettings = [
	{ name: 'window_months', window: 'ROLLING' },
	{ name: 'service_year_offset_months', window: 'SERVICE_YEAR' },
	{ name: 'window_key', window: 'EVENT' }
] as const;

export function entitlementWindowFields(
	window: Json | undefined,
	errors: ReadonlyMap<string, string> = new Map()
): readonly ('window_months' | 'service_year_offset_months' | 'window_key')[] {
	return windowSettings
		.filter((field) => field.window === window || entitlementHasError(errors, [field.name]))
		.map((field) => field.name);
}

/** A refused nested value stays reachable even when its optional group would normally be closed. */
export function entitlementHasError(
	errors: ReadonlyMap<string, string>,
	fields: readonly string[]
): boolean {
	return [...errors.keys()].some((path) =>
		fields.some(
			(field) => path === `entitlement.${field}` || path.startsWith(`entitlement.${field}.`)
		)
	);
}
