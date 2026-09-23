import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import { getErrorMessage } from '@norbital-ai/std/error';
import { Effect, Schema } from 'effect';
import { siteKey } from '../../lib/site-key.mjs';
import type { Pipelines } from './$types.js';

const text = Schema.String.check(Schema.isPattern(/^\s*\S[\s\S]*$/));
const optionalText = Schema.optional(Schema.NullOr(Schema.String));

const rowSchema = Schema.Struct({
	/** The site's address, or a site code. An address no site carries files a new site. */
	site: text,
	/** The six-digit postal code, when the sheet keeps it in its own column. */
	postal_code: optionalText,
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

const blank = (value: string | null | undefined) => (value ?? '').trim() === '';
const label = (row: ImportRow, index: number) =>
	`Row ${index + 1}: ${row.title} at ${row.site} on ${row.scheduled_for}`;

/** The address a row names, with its postal code folded in when the sheet keeps it apart. */
const addressOf = (row: ImportRow) => {
	const site = row.site.trim();
	const postal = row.postal_code?.trim() ?? '';
	return postal === '' || site.includes(postal) ? site : `${site}, Singapore ${postal}`;
};

/** A job with no dispatch reference is the same job when it is the same work, day and site. */
const sameWork = (siteId: string, day: string, title: string) =>
	`${siteId}|${day}|${title.trim().replace(/\s+/g, ' ').toLowerCase()}`;
const dayOf = (instant: Date | string) => new Date(instant).toISOString().slice(0, 10);

export default {
	import: {
		description:
			'Creates job assignments from a sheet of work orders — site address (or code) and optional postal code, day, title, and optionally nature, description, assignee and dispatch reference. A site is matched by its code or by its address key (postal code and unit); an address no site carries is filed as a new site. A row already filed — the same dispatch reference, or the same title on the same day at the same site — is skipped, so importing a sheet twice files nothing twice.',
		input: Schema.toStandardSchemaV1(importInputSchema),
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const { rows } = yield* decodeImportInput(input).pipe(
					Effect.catch((error) => Effect.sync(() => refuse(getErrorMessage(error))))
				);

				const problems: string[] = [];
				const seenRefs = new Set<string>();
				for (const [index, row] of rows.entries()) {
					const where = label(row, index);
					if (!isCalendarDate(row.scheduled_for.trim()))
						problems.push(`${where}: scheduled_for must be a calendar day (YYYY-MM-DD).`);
					if (!blank(row.assignee_user_id) && !UUID.test(row.assignee_user_id!.trim()))
						problems.push(`${where}: assignee_user_id must be a user id.`);
					if (siteKey(addressOf(row)) === '') problems.push(`${where}: site has no address.`);
					if (!blank(row.external_ref)) {
						const ref = row.external_ref!.trim();
						if (seenRefs.has(ref)) problems.push(`${where}: external_ref ${ref} is repeated.`);
						seenRefs.add(ref);
					}
				}
				if (problems.length > 0)
					refuse(
						`The sheet could not be imported:\n${problems.map((problem) => `• ${problem}`).join('\n')}`
					);

				const keys = [...new Set(rows.map((row) => siteKey(addressOf(row))))];
				const codes = [...new Set(rows.map((row) => row.site.trim()))];
				const refs = [...seenRefs];
				const [sites, filedRefs] = yield* Effect.all(
					[
						api.db.sites.findMany({
							where: { OR: [{ site_key: { in: keys } }, { site_code: { in: codes } }] },
							columns: { id: true, site_code: true, site_key: true },
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
				const siteIdByCode = new Map(
					sites.flatMap((site) => (site.site_code == null ? [] : [[site.site_code, site.id]]))
				);
				const siteIdByKey = new Map(sites.map((site) => [site.site_key, site.id]));
				const siteIdOf = (row: ImportRow) =>
					siteIdByCode.get(row.site.trim()) ?? siteIdByKey.get(siteKey(addressOf(row)));

				// One new site per address the workspace does not carry yet, spelled as the sheet first did.
				const newSites = new Map<string, string>();
				for (const row of rows) {
					const address = addressOf(row);
					if (siteIdOf(row) === undefined && !newSites.has(siteKey(address)))
						newSites.set(siteKey(address), address);
				}
				if (newSites.size > 0) {
					const created = yield* api.collection.sites.createMany(
						[...newSites.values()].map((name) => ({ name }))
					);
					for (const site of created)
						siteIdByKey.set(siteKey(site.name, site.location?.formatted_address), site.id);
				}

				const existingSiteIds = [...new Set(sites.map((site) => site.id))];
				const filedWork =
					existingSiteIds.length === 0
						? []
						: yield* api.db.job_assignments.findMany({
								where: { site_id: { in: existingSiteIds } },
								columns: { site_id: true, scheduled_for: true, title: true },
								limit: QUERY_LIMIT
							});
				const filed = new Set([
					...filedRefs.flatMap((job) => (job.external_ref == null ? [] : [job.external_ref])),
					...filedWork.map((job) => sameWork(job.site_id, dayOf(job.scheduled_for), job.title))
				]);

				return rows.flatMap((row) => {
					const siteId = siteIdOf(row)!;
					const day = row.scheduled_for.trim();
					const identity = blank(row.external_ref)
						? sameWork(siteId, day, row.title)
						: row.external_ref!.trim();
					if (filed.has(identity)) return [];
					filed.add(identity);
					return [
						{
							site_id: siteId,
							title: row.title.trim(),
							nature: blank(row.nature) ? null : row.nature!.trim(),
							scheduled_for: `${day}T00:00:00.000Z`,
							description: row.description?.trim() ?? '',
							...(blank(row.assignee_user_id)
								? {}
								: { assignee_user_id: row.assignee_user_id!.trim() }),
							...(blank(row.external_ref) ? {} : { external_ref: row.external_ref!.trim() })
						}
					];
				});
			})
	}
} satisfies Pipelines;
