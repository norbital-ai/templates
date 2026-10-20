import { Effect } from 'effect';
import type { ActionCtx, Id, InputOf } from '@norbital-ai/bolt';
import type { WORK_ORDER_ROW } from '../data/collection/job_assignments/+collection.js';
import { siteKey } from './site-key.js';
type Row = InputOf<typeof WORK_ORDER_ROW.fields>;
type Ctx = Pick<ActionCtx<'job_assignments'>, 'read' | 'act' | 'refuse'>;
const UNIT = /#[0-9]+-[0-9A-Z]+/i;
const unitOf = (row: Row) => row.unit_number?.trim() || UNIT.exec(row.site)?.[0] || null;
/** The address a row names, with a separately supplied postal code folded in. */
const addressOf = (row: Row) => {
	const site = row.site.replace(UNIT, '').replace(/\s+,/g, ',').trim();
	const postal = row.postal_code?.trim() ?? '';
	return postal === '' || site.includes(postal) ? site : `${site}, Singapore ${postal}`;
};
/** A job with no dispatch reference is the same job when it is the same work, day and site. */
const sameWork = (siteId: string, day: string, title: string) =>
	`${siteId}|${day}|${title.trim().replace(/\s+/g, ' ').toLowerCase()}`;
/**
 * The work-order import: the whole sheet is checked before anything is written; sites resolve by code or address key;
 * addresses the workspace lacks are filed as new sites carrying their jobs (the sites transform stamps them); a row
 * already filed is skipped.
 */
export const importWorkOrders = Effect.fnUntraced(function* (rows: readonly Row[], ctx: Ctx) {
	const problems: string[] = [];
	const refs = new Set<string>();
	for (const [index, row] of rows.entries()) {
		const where = `Row ${index + 1}: ${row.title} at ${row.site} on ${row.scheduled_for}`;
		if ((row.title?.trim() ?? '') === '') problems.push(`${where}: title is empty.`);
		if (addressOf(row) === '' || siteKey(addressOf(row), unitOf(row)) === '')
			problems.push(`${where}: site has no address.`);
		const ref = row.external_ref?.trim() ?? '';
		if (ref !== '') {
			if (refs.has(ref)) problems.push(`${where}: external_ref ${ref} is repeated.`);
			refs.add(ref);
		}
	}
	const keys = [...new Set(rows.map((row) => siteKey(addressOf(row), unitOf(row))))];
	const codes = [...new Set(rows.map((row) => row.site?.trim() ?? ''))];
	const { sites, work, filedRefs } = yield* ctx.read({
		sites: {
			collection: 'sites',
			where: { or: [{ site_key: { in: keys } }, { site_code: { in: codes } }] },
			select: { site_code: true, site_key: true },
			all: true
		},
		work: {
			collection: 'job_assignments',
			where: { site_id: { in: { member: 'sites', field: 'id' } } },
			select: { site_id: true, scheduled_for: true, title: true },
			all: true
		},
		...(refs.size === 0
			? {}
			: {
					filedRefs: {
						collection: 'job_assignments',
						where: { external_ref: { in: [...refs] } },
						select: { external_ref: true },
						all: true
					}
				})
	});
	const byCode = new Map(
		sites.rows.flatMap((s) => (s.site_code == null ? [] : [[s.site_code, s.id] as const]))
	);
	const byKey = new Map(sites.rows.map((s) => [s.site_key, s.id] as const));
	const siteOf = (row: Row) =>
		byCode.get(row.site?.trim() ?? '') ?? byKey.get(siteKey(addressOf(row), unitOf(row)));
	const filed = new Set([
		...(filedRefs?.rows ?? []).flatMap((job) =>
			job.external_ref == null ? [] : [job.external_ref]
		),
		...work.rows.map((job) => sameWork(String(job.site_id), String(job.scheduled_for), job.title))
	]);
	const job = (row: Row) => {
		const assignee = row.assignee_user_id;
		return {
			title: row.title?.trim() ?? '',
			nature: (row.nature?.trim() ?? '') || null,
			scheduled_for: row.scheduled_for,
			description: row.description?.trim() ?? '',
			...(assignee == null ? {} : { assignee_user_id: assignee }),
			...((row.external_ref?.trim() ?? '') === ''
				? {}
				: { external_ref: row.external_ref?.trim() ?? '' })
		};
	};
	const onSites: (ReturnType<typeof job> & {
		site_id: Id<'sites'>;
	})[] = [];
	const fresh = new Map<
		string,
		{
			address: string;
			unit_number: string | null;
			location: { lat: number; lng: number };
			jobs: ReturnType<typeof job>[];
		}
	>();
	let skipped = 0;
	for (const [index, row] of rows.entries()) {
		const siteId = siteOf(row);
		const key = siteKey(addressOf(row), unitOf(row));
		const identity =
			(row.external_ref?.trim() ?? '') ||
			sameWork(siteId ?? `new:${key}`, row.scheduled_for, row.title);
		if (filed.has(identity)) {
			skipped += 1;
			continue;
		}
		filed.add(identity);
		if (siteId !== undefined) onSites.push({ ...job(row), site_id: siteId });
		else {
			const { latitude, longitude } = row;
			if (
				latitude == null ||
				longitude == null ||
				!Number.isFinite(latitude) ||
				!Number.isFinite(longitude) ||
				latitude < -90 ||
				latitude > 90 ||
				longitude < -180 ||
				longitude > 180
			) {
				problems.push(
					`Row ${index + 1}: ${row.title} at ${row.site} on ${row.scheduled_for}: a new site needs latitude (-90 to 90) and longitude (-180 to 180).`
				);
				continue;
			}
			// one new site per location and unit, labelled as the sheet first did
			const site = fresh.get(key) ?? {
				address: addressOf(row),
				unit_number: unitOf(row),
				location: { lat: latitude, lng: longitude },
				jobs: []
			};
			site.jobs.push(job(row));
			fresh.set(key, site);
		}
	}
	if (problems.length > 0)
		yield* ctx.refuse(
			`The sheet could not be imported:\n${problems.map((p) => `• ${p}`).join('\n')}`
		);
	if (fresh.size > 0)
		yield* ctx.act(
			'sites.create',
			[...fresh.values()].map((site) => ({
				address: site.address,
				unit_number: site.unit_number,
				location: site.location,
				job_assignments: { create: site.jobs }
			}))
		);
	if (onSites.length > 0) yield* ctx.act('job_assignments.create', onSites);
	return { created: rows.length - skipped, sites: fresh.size, skipped };
});
