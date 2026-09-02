/**
 * Turns a sync workbook reader into an Effect failure the import toast can catch.
 *
 * `rosterImportPayload` / `attendanceImportPayload` refuse with `WorkbookImportError`.
 * Called bare inside `Effect.gen`, that throw is a defect — `Effect.catch` never sees
 * it, so the operator gets an empty toaster and no `collections.import` POST. The
 * verify script already uses `Effect.try` + `toError` for the same readers; the
 * browser path must do the same.
 */
import { toError } from '@norbital-ai/std';
import { Effect, Schema } from 'effect';
import type { WorkbookGrids } from '../workbook-rows.js';

const ImportValues = Schema.Record(Schema.String, Schema.Json);
type ImportValues = typeof ImportValues.Type;

export function importPayloadFromGrids(
	buildPayload: (grids: WorkbookGrids) => object,
	grids: WorkbookGrids
): Effect.Effect<ImportValues, Error> {
	return Effect.try({
		try: () =>
			Schema.decodeUnknownSync(ImportValues)(
				JSON.parse(JSON.stringify({ ...buildPayload(grids) }))
			),
		catch: toError
	});
}
