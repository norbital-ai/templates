import { Schema } from 'effect';

/** Bolt `json` field values (recursive JSON). */
type Json = Schema.Json;
const isJson = Schema.is(Schema.Json);

/** JSON-round-trip row extracts so branded instants/decimals/ids satisfy `json` output typing. */
export const jsonRows = <const T extends readonly unknown[]>(rows: T): readonly Json[] => {
	// repository-health:allow CLONE -- digest output is typed `json`; round-trip strips branded values the schema admits only after serialization.
	const parsed: unknown = JSON.parse(JSON.stringify(rows));
	if (!Array.isArray(parsed) || !parsed.every(isJson)) {
		throw new Error('Digest rows did not round-trip as JSON.');
	}
	return parsed;
};

/**
 * The four 06:00 digests share one output: when the extract was taken, how many rows it holds, and the rows (the first
 * 25 in the digest's order), as today's JSON extract.
 */
export const digestOutput = {
	kind: 'object',
	fields: {
		generated_at: { kind: 'instant' },
		count: { kind: 'int' },
		rows: { kind: 'list', of: { kind: 'json' } }
	}
} as const;

export const DAILY_0600 = { cron: '0 6 * * *' } as const;
