import { automation, type Id, type StartInput } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { siteKey } from '../lib/site-key.js';

type Row = StartInput<'job_assignments_import_work_orders'>['rows'][number];

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
/** One sheet row, keyed by the lower-cased header (`csv.ts`, `xlsx.ts`). */
const WORK_ORDER_ROW = {
	kind: 'object',
	fields: {
		/** The location's formatted address, or an existing site code. */
		site: { kind: 'text' },
		/** The six-digit postal code, when the sheet keeps it in its own column. */
		postal_code: { kind: 'text', optional: true },
		/** Optional unit within the location; an embedded #05-12 is also accepted. */
		unit_number: { kind: 'text', optional: true },
		/** Both coordinates are required when the row creates a new site. */
		latitude: { kind: 'number', optional: true },
		longitude: { kind: 'number', optional: true },
		/** `YYYY-MM-DD`, or the day serial an xlsx stores for a typed date. */
		scheduled_for: { kind: 'date' },
		title: { kind: 'text' },
		nature: { kind: 'text', optional: true },
		description: { kind: 'text', optional: true },
		/** The contractor's email or phone number; the job links the member it names, else none. */
		assignee_contact: { kind: 'text', optional: true },
		/** The dispatch system's own reference, unique across assignments. */
		external_ref: { kind: 'text', optional: true }
	}
} as const;

export default automation('job_assignments_import_work_orders', {
	description:
		'Creates job assignments from a work-order sheet, matching existing sites and skipping filed rows. The complete sheet is checked before sites and jobs commit together.',
	policies: ['field_ops_controller'],
	input: { rows: { kind: 'list', min: 1, max: 5000, of: WORK_ORDER_ROW } },
	output: {
		kind: 'object',
		fields: { created: { kind: 'int' }, sites: { kind: 'int' }, skipped: { kind: 'int' } }
	},
	run: function* ({ rows }, ctx) {
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
		// the sites the sheet names, the work already filed on them, and any job already holding a sheet reference
		const MATCHED = { or: [{ site_key: { in: keys } }, { site_code: { in: codes } }] } as const;
		const { sites, job_assignments: work } = yield* ctx.query({
			sites: { where: MATCHED, fields: ['site_code', 'site_key'] },
			job_assignments: {
				where: { or: [{ site_id: { is: MATCHED } }, { external_ref: { in: [...refs] } }] },
				fields: ['site_id', 'scheduled_for', 'title', 'external_ref']
			}
		});
		const byCode = new Map(
			sites.rows.flatMap((s) => (s.site_code == null ? [] : [[s.site_code, s.id] as const]))
		);
		const byKey = new Map(sites.rows.map((s) => [s.site_key, s.id] as const));
		const siteOf = (row: Row) =>
			byCode.get(row.site?.trim() ?? '') ?? byKey.get(siteKey(addressOf(row), unitOf(row)));
		const filed = new Set([
			...work.rows.flatMap((job) => (job.external_ref == null ? [] : [job.external_ref])),
			...work.rows.map((job) => sameWork(String(job.site_id), String(job.scheduled_for), job.title))
		]);
		const job = (row: Row) => {
			const contact = row.assignee_contact?.trim() ?? '';
			return {
				title: row.title?.trim() ?? '',
				nature: (row.nature?.trim() ?? '') || null,
				scheduled_for: row.scheduled_for,
				description: row.description?.trim() ?? '',
				...(contact === '' ? {} : { assignee_contact: contact }),
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
			yield* new Refusal({
				message: `The sheet could not be imported:\n${problems.map((p) => `• ${p}`).join('\n')}`
			});
		const newSites = [...fresh.values()].map((site) => ({
			address: site.address,
			unit_number: site.unit_number,
			location: site.location,
			job_assignments: site.jobs
		}));
		// Fresh sites carry their own jobs; the other jobs name existing sites. Both settle together.
		if (newSites.length > 0 && onSites.length > 0)
			yield* ctx.act.many([
				{ callable: 'sites.create', input: newSites },
				{ callable: 'job_assignments.create', input: onSites }
			]);
		else if (newSites.length > 0) yield* ctx.act('sites.create', newSites);
		else if (onSites.length > 0) yield* ctx.act('job_assignments.create', onSites);
		return { created: rows.length - skipped, sites: fresh.size, skipped };
	}
});
