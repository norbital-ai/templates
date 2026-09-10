import { Effect, Schema } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { dedupeHolidayRows, type HolidayImportRow } from '../../lib/holiday-rows.js';
import { formatNamedList } from '../../lib/period.js';
import type { Pipelines } from './$types.js';

const LIMIT = 20_000;

/**
 * Two documents come through this door: the holidays spreadsheet, and a publication decision for
 * rows a person selected in the table. Both answer with the rows to write, which is what an import
 * pipeline is — so the bulk publish needs no write of its own in the browser.
 *
 * The sheet names entities, not ids, and one file may carry every entity at once: a payroll team
 * keeps one annual calendar spreadsheet, not one per company. Resolving a name to an entity is
 * done here rather than in the browser because only the server holds the list to resolve against —
 * the same reason and the same shape as the roster import's own entity column.
 */
const importSchema = Schema.Union([
	Schema.Struct({
		rows: Schema.Array(
			Schema.Struct({
				legal_entity: Schema.String,
				date: Schema.String,
				name: Schema.String,
				original_date: Schema.NullOr(Schema.String),
				source: Schema.NullOr(Schema.String)
			})
		)
	}),
	Schema.Struct({ publish: Schema.Array(Schema.String), published: Schema.Boolean })
]);

export default {
	import: {
		description:
			'Loads holidays from the holidays spreadsheet — one row per entity and day, and one file may carry every entity; a day the entity already has is skipped, never duplicated or overwritten, and imported rows arrive unpublished — or publishes and unpublishes the holidays a person selected. An unmatched entity, a duplicated day and a day already on file are each reported by name.',
		input: importSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const payload = Schema.decodeUnknownSync(importSchema)(input);
				if ('publish' in payload) {
					const publishedAt = payload.published ? new Date().toISOString() : null;
					return payload.publish.map((id) => ({ id, published_at: publishedAt }));
				}
				const companies = yield* api.db.companies.findMany({
					columns: { id: true, name: true, registration_number: true },
					limit: LIMIT
				});
				if (companies.length >= LIMIT) refuse('Too many entities to resolve this file against.');
				const byName = new Map<string, string[]>();
				for (const company of companies)
					for (const key of [company.name, company.registration_number])
						if (key != null && key.trim() !== '') {
							const wanted = key.trim().toLowerCase();
							byName.set(wanted, [...(byName.get(wanted) ?? []), company.id]);
						}
				// Every unmatched name at once. Refusing on the first one makes an operator fix a
				// forty-entity file one typo per upload.
				const unmatched = [
					...new Set(
						payload.rows
							.map((row) => row.legal_entity.trim())
							.filter((name) => (byName.get(name.toLowerCase()) ?? []).length !== 1)
					)
				];
				if (unmatched.length > 0)
					refuse(
						`These rows name an entity this workspace cannot resolve:\n${formatNamedList(unmatched)}\n` +
							`Known entities:\n${formatNamedList(companies.map((company) => company.name))}`
					);
				const rows: HolidayImportRow[] = payload.rows.map((row) => ({
					company_id: byName.get(row.legal_entity.trim().toLowerCase())![0]!,
					date: row.date,
					name: row.name,
					original_date: row.original_date,
					source: row.source
				}));
				const { inserts, reconciliation } = yield* dedupeHolidayRows(api, rows);
				if (reconciliation.length > 0)
					yield* Effect.logInfo(
						`[holiday-import] ${reconciliation.length} row(s) not written: ` +
							reconciliation
								.map((skip) => `${skip.company_id} ${skip.date} ${skip.name} (${skip.reason})`)
								.join('; ')
					);
				return inserts.map((row) => ({
					company_id: row.company_id,
					date: row.date,
					name: row.name,
					original_date: row.original_date,
					source: row.source ?? 'spreadsheet'
				}));
			})
	}
} satisfies Pipelines;
