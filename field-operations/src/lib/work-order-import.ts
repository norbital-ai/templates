import type { ActionCtx, Id, InputOf, PlainDate } from '@norbital-ai/bolt';
import { siteKey } from './site-key.js';

/** One sheet row, keyed by the lower-cased header (`csv.ts`, `xlsx.ts`). */
export const WORK_ORDER_ROW = {
	kind: 'object',
	fields: {
		/** The site's address, or a site code. An address no site carries files a new site. */
		site: { kind: 'text' },
		/** The six-digit postal code, when the sheet keeps it in its own column. */
		postal_code: { kind: 'text', optional: true },
		/** `YYYY-MM-DD`, or the day serial an xlsx stores for a typed date. */
		scheduled_for: { kind: 'text' },
		title: { kind: 'text' },
		nature: { kind: 'text', optional: true },
		description: { kind: 'text', optional: true },
		/** The contractor's member id; the relationship refuses an id that is no member. */
		assignee_user_id: { kind: 'text', optional: true },
		/** The dispatch system's own reference, unique across assignments. */
		external_ref: { kind: 'text', optional: true }
	}
} as const;
type Row = InputOf<typeof WORK_ORDER_ROW.fields>;
type Ctx = Pick<ActionCtx<'job_assignments'>, 'read' | 'act' | 'refuse'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: string | null | undefined) => (value ?? '').trim();

/** The address a row names, with its postal code folded in when the sheet keeps it apart. */
export const addressOf = (row: Row) => {
	const site = text(row.site);
	const postal = text(row.postal_code);
	return postal === '' || site.includes(postal) ? site : `${site}, Singapore ${postal}`;
};
/** The row's day: a `YYYY-MM-DD`, or an xlsx day serial. */
export const scheduledDay = (row: Row) => {
	const value = text(row.scheduled_for);
	return /^\d{1,6}$/.test(value)
		? new Date(Date.UTC(1899, 11, 30) + Number.parseInt(value, 10) * 86_400_000)
				.toISOString()
				.slice(0, 10)
		: value;
};
const isDay = (day: string) => {
	const at = Date.parse(`${day}T00:00:00Z`);
	return DAY.test(day) && !Number.isNaN(at) && new Date(at).toISOString().startsWith(day);
};
/** A job with no dispatch reference is the same job when it is the same work, day and site. */
const sameWork = (siteId: string, day: string, title: string) =>
	`${siteId}|${day}|${title.trim().replace(/\s+/g, ' ').toLowerCase()}`;

/**
 * The work-order import: the whole sheet is checked before anything is written; sites resolve by code or address key;
 * addresses the workspace lacks are filed as new sites carrying their jobs (the sites transform stamps them); a row
 * already filed is skipped.
 */
export async function importWorkOrders(rows: readonly Row[], ctx: Ctx) {
	const problems: string[] = [];
	const refs = new Set<string>();
	for (const [index, row] of rows.entries()) {
		const where = `Row ${index + 1}: ${row.title} at ${row.site} on ${row.scheduled_for}`;
		if (text(row.title) === '') problems.push(`${where}: title is empty.`);
		if (!isDay(scheduledDay(row)))
			problems.push(`${where}: scheduled_for must be a calendar day (YYYY-MM-DD).`);
		if (text(row.assignee_user_id) !== '' && !UUID.test(text(row.assignee_user_id)))
			problems.push(`${where}: assignee_user_id must be a user id.`);
		if (siteKey(addressOf(row)) === '') problems.push(`${where}: site has no address.`);
		const ref = text(row.external_ref);
		if (ref !== '') {
			if (refs.has(ref)) problems.push(`${where}: external_ref ${ref} is repeated.`);
			refs.add(ref);
		}
	}
	if (problems.length > 0)
		ctx.refuse(`The sheet could not be imported:\n${problems.map((p) => `• ${p}`).join('\n')}`);

	const keys = [...new Set(rows.map((row) => siteKey(addressOf(row))))];
	const codes = [...new Set(rows.map((row) => text(row.site)))];
	const [sites, filedRefs] = await Promise.all([
		ctx.read('sites', {
			where: { or: [{ site_key: { in: keys } }, { site_code: { in: codes } }] },
			select: { site_code: true, site_key: true },
			all: true
		}),
		refs.size === 0
			? { rows: [] }
			: ctx.read('job_assignments', {
					where: { external_ref: { in: [...refs] } },
					select: { external_ref: true },
					all: true
				})
	]);
	const byCode = new Map(
		sites.rows.flatMap((s) => (s.site_code == null ? [] : [[s.site_code, s.id] as const]))
	);
	const byKey = new Map(sites.rows.map((s) => [s.site_key, s.id] as const));
	const siteOf = (row: Row) => byCode.get(text(row.site)) ?? byKey.get(siteKey(addressOf(row)));
	const known = [...new Set(sites.rows.map((s) => s.id))];
	const work =
		known.length === 0
			? { rows: [] }
			: await ctx.read('job_assignments', {
					where: { site_id: { in: known } },
					select: { site_id: true, scheduled_for: true, title: true },
					all: true
				});
	const filed = new Set([
		...filedRefs.rows.flatMap((job) => (job.external_ref == null ? [] : [job.external_ref])),
		...work.rows.map((job) => sameWork(String(job.site_id), String(job.scheduled_for), job.title))
	]);

	const job = (row: Row) => ({
		title: text(row.title),
		nature: text(row.nature) || null,
		scheduled_for: scheduledDay(row) as PlainDate & string,
		description: text(row.description),
		...(text(row.assignee_user_id) === ''
			? {}
			: { assignee_user_id: text(row.assignee_user_id) as Id<'sys_user'> }),
		...(text(row.external_ref) === '' ? {} : { external_ref: text(row.external_ref) })
	});
	const onSites: (ReturnType<typeof job> & { site_id: Id<'sites'> })[] = [];
	const fresh = new Map<string, { name: string; jobs: ReturnType<typeof job>[] }>();
	let skipped = 0;
	for (const row of rows) {
		const siteId = siteOf(row);
		const key = siteKey(addressOf(row));
		const identity =
			text(row.external_ref) || sameWork(siteId ?? `new:${key}`, scheduledDay(row), row.title);
		if (filed.has(identity)) {
			skipped += 1;
			continue;
		}
		filed.add(identity);
		if (siteId !== undefined) onSites.push({ ...job(row), site_id: siteId });
		else {
			// one new site per address, spelled as the sheet first did
			const site = fresh.get(key) ?? { name: addressOf(row), jobs: [] };
			site.jobs.push(job(row));
			fresh.set(key, site);
		}
	}
	if (fresh.size > 0)
		await ctx.act(
			'sites.create',
			[...fresh.values()].map((site) => ({
				name: site.name,
				job_assignments: { create: site.jobs }
			}))
		);
	if (onSites.length > 0) await ctx.act('job_assignments.create', onSites);
	return { created: rows.length - skipped, sites: fresh.size, skipped };
}
