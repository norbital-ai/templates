import { refuse } from '@norbital-ai/bolt/authoring';
import { getErrorMessage } from '@norbital-ai/std/error';
import { Effect, Schema } from 'effect';
import type { Api } from '$bolt/types.js';

/** The master-data columns every ERP feed lands the same way, whatever record it carries. */
interface ErpMasterRecord {
	readonly external_code: string;
	readonly code: string;
	readonly name: string;
	readonly active?: boolean | undefined;
}

/**
 * The columns an ERP master feed always maps.
 *
 * Identity, the human code and name, and the active flag are the same four columns whether the feed
 * carries items or vendors, so each `map` adds only the columns its own table has.
 */
export function erpMasterColumns(record: ErpMasterRecord): {
	readonly external_code: string;
	readonly code: string;
	readonly name: string;
	readonly active: boolean;
} {
	return {
		external_code: record.external_code,
		code: record.code,
		name: record.name,
		active: record.active ?? true
	};
}

/** What one mirror import needs to say about itself: the page it decodes and the row it lands. */
interface MirrorImport<Page, Record extends { readonly external_code: string }, Row> {
	readonly description: string;
	readonly input: Schema.Codec<Page, unknown>;
	/** The records inside a decoded page. */
	readonly records: (page: Page) => ReadonlyArray<Record>;
	/** The mirrored rows already on file for these codes — the one read the import makes. */
	readonly known: (
		api: Api,
		codes: ReadonlyArray<string>
	) => Effect.Effect<ReadonlyArray<{ readonly external_code: string }>>;
	readonly map: (record: Record) => Row;
}

/**
 * An `import` pipeline that mirrors one ERP master feed into its table.
 *
 * The platform hands the handler the delivered payload unvalidated — `input` is `unknown` and
 * nothing checks it against the declared `input` schema first — so the page is decoded here and a
 * malformed page fails the batch instead of writing part of it. A record already on file is
 * skipped rather than refused: the unique index on `external_code` would reject it anyway, and a
 * re-delivered page must be a skip, not a failed batch. Customers, items and vendors import the
 * same way, so the shape is owned here and each collection supplies only its schema and mapping.
 */
export function mirrorImport<Page, Record extends { readonly external_code: string }, Row>(
	spec: MirrorImport<Page, Record, Row>
): {
	readonly description: string;
	readonly input: Schema.Codec<Page, unknown>;
	readonly handler: (
		context: { readonly input: unknown },
		api: Api
	) => Effect.Effect<Row[], never, never>;
} {
	/** Built once, beside its schema: a decoder rebuilt per delivered page is per-page work. */
	const decode = Schema.decodeUnknownEffect(spec.input);
	return {
		description: spec.description,
		input: spec.input,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const page = yield* decode(input).pipe(
					Effect.catch((error) => Effect.sync(() => refuse(getErrorMessage(error))))
				);
				const records = spec.records(page);
				const onFile = yield* spec.known(
					api,
					records.map((record) => record.external_code)
				);
				const mirrored = new Set(onFile.map((row) => row.external_code));
				return records.filter((record) => !mirrored.has(record.external_code)).map(spec.map);
			})
	};
}
