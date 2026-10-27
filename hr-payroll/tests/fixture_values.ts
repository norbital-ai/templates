import { createHash } from 'node:crypto';
import type { Id } from '@norbital-ai/bolt';
import { inputSchema } from '@norbital-ai/std/kind';
import { Schema } from 'effect';
import settings from '../src/data/model/jurisdiction_settings/+model.js';
import { SNAPSHOT_MODELS } from '../src/lib/payroll_engine/statutory_snapshot.js';

const uuid = inputSchema({ kind: 'id', of: 'entity' });

/** Scenario labels name real seeded UUIDs; public law UUIDs retain their exact values. */
export function fixtureId(label: string): string {
	if (Schema.is(uuid)(label)) return label;
	const hash = createHash('sha256').update(`hr-payroll:test:${label}`).digest('hex');
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** The canonical kind codec validates the UUID; the declaration adds only its model's nominal brand. */
export function nativeId<C extends string>(collection: C, value: unknown): Id<C> {
	const codec = inputSchema({ kind: 'id', of: collection });
	const decoded = Schema.decodeUnknownSync(codec)(value);
	const branded = Schema.declare<Id<C>>(
		(candidate): candidate is Id<C> =>
			Schema.is(Schema.String)(candidate) && Schema.is(codec)(candidate)
	);
	return Schema.decodeUnknownSync(branded)(decoded);
}

/** Only the canonical declaration supplies omitted values; authored nulls and overrides remain exact. */
export function fixtureRows(table: string, rows: readonly Record<string, unknown>[]) {
	const fields =
		table === 'jurisdiction_settings'
			? settings.spec.fields
			: Object.entries(SNAPSHOT_MODELS).find(([name]) => name === table)?.[1].fields;
	const declared: Readonly<Record<string, object>> = fields ?? {};
	const defaults = Object.fromEntries(
		Object.entries(declared).flatMap(([name, field]): [string, unknown][] =>
			'default' in field ? [[name, field.default]] : []
		)
	);
	return rows.map((row) => ({ ...structuredClone(defaults), ...row }));
}
