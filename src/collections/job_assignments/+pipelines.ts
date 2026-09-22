import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import { getErrorMessage } from '@norbital-ai/std/error';
import { Effect, Schema } from 'effect';
import type { Pipelines } from './$types.js';

const text = Schema.String.check(Schema.isPattern(/^\s*\S[\s\S]*$/));
const optionalText = Schema.optional(Schema.NullOr(Schema.String));

const rowSchema = Schema.Struct({
	/** A site's name or site code; a name no site carries files a new site. */
	site: text,
	scheduled_for: text,
	title: text,
	nature: optionalText,
	description: optionalText,
	/**
	 * The contractor's `user.id`, when the sheet already dispatches the work. Authored code holds no
	 * query over the identity table; the relationship's foreign key is the existence check.
	 */
	assignee_user_id: optionalText,
	/** The dispatch system's own reference, unique across assignments. */
	external_ref: optionalText
});

const importInputSchema = Schema.Struct({ rows: Schema.NonEmptyArray(rowSchema) });
const decodeImportInput = Schema.decodeUnknownEffect(importInputSchema);

type ImportRow = Schema.Schema.Type<typeof rowSchema>;

const QUERY_LIMIT = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const key = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const blank = (value: string | null | undefined) => (value ?? '').trim() === '';
const label = (row: ImportRow, index: number) =>
	`Row ${index + 1}: ${row.title} at ${row.site} on ${row.scheduled_for}`;

export default {
	import: {
		description:
			'Creates job assignments from a sheet of work orders — site, day, title, and optionally nature, description, assignee and dispatch reference. A site is matched by its name or code; a name no site carries is filed as a new site. The whole sheet is checked before anything is written.',
		input: Schema.toStandardSchemaV1(importInputSchema),
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const { rows } = yield* decodeImportInput(input).pipe(
					Effect.catch((error) => Effect.sync(() => refuse(getErrorMessage(error))))
				);
				const refs = rows.flatMap((row) =>
					blank(row.external_ref) ? [] : [row.external_ref!.trim()]
				);
				const [sites, taken] = yield* Effect.all(
					[
						api.db.sites.findMany({
							columns: { id: true, name: true, site_code: true },
							limit: QUERY_LIMIT
						}),
						refs.length === 0
							? Effect.succeed([])
							: api.db.job_assignments.findMany({
									where: { external_ref: { in: refs } },
									columns: { external_ref: true },
									limit: QUERY_LIMIT
								})
					],
					{ concurrency: 'unbounded' }
				);
				const siteIdByKey = new Map<string, string>();
				for (const site of sites) {
					siteIdByKey.set(key(site.name), site.id);
					if (site.site_code != null) siteIdByKey.set(key(site.site_code), site.id);
				}
				const takenRefs = new Set(taken.map((row) => row.external_ref));

				const problems: string[] = [];
				const seenRefs = new Set<string>();
				for (const [index, row] of rows.entries()) {
					const where = label(row, index);
					if (!isCalendarDate(row.scheduled_for.trim()))
						problems.push(`${where}: scheduled_for must be a calendar day (YYYY-MM-DD).`);
					if (!blank(row.assignee_user_id) && !UUID.test(row.assignee_user_id!.trim()))
						problems.push(`${where}: assignee_user_id must be a user id.`);
					if (!blank(row.external_ref)) {
						const ref = row.external_ref!.trim();
						if (takenRefs.has(ref) || seenRefs.has(ref))
							problems.push(`${where}: external_ref ${ref} is already filed.`);
						seenRefs.add(ref);
					}
				}
				if (problems.length > 0)
					refuse(
						`The sheet could not be imported:\n${problems.map((problem) => `• ${problem}`).join('\n')}`
					);

				const newSiteNames = [
					...new Map(
						rows
							.filter((row) => !siteIdByKey.has(key(row.site)))
							.map((row) => [key(row.site), row.site.trim()])
					).values()
				];
				if (newSiteNames.length > 0) {
					const created = yield* api.collection.sites.createMany(
						newSiteNames.map((name) => ({ name }))
					);
					for (const site of created) siteIdByKey.set(key(site.name), site.id);
				}

				return rows.map((row) => ({
					site_id: siteIdByKey.get(key(row.site))!,
					title: row.title.trim(),
					nature: blank(row.nature) ? null : row.nature!.trim(),
					scheduled_for: `${row.scheduled_for.trim()}T00:00:00.000Z`,
					description: row.description?.trim() ?? '',
					...(blank(row.assignee_user_id)
						? {}
						: { assignee_user_id: row.assignee_user_id!.trim() }),
					...(blank(row.external_ref) ? {} : { external_ref: row.external_ref!.trim() })
				}));
			})
	}
} satisfies Pipelines;
