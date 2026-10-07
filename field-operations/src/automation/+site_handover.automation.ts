import { automation } from '@norbital-ai/bolt';
import * as Predicate from '../lib/guards.js';

const SCHEMA = 'norbital.field_operations.interoperability.v2';

/**
 * The handover bundle for the selected sites: per site, one JSON file with the site, its dispatched jobs, variation
 * requests (held ones included, `approval_request_id`) and photo evidence, and a CSV per table, left on its run. It
 * reads as its starter (`runAs: 'trigger'`). `location` keeps the downstream contract's `{ geometry, formatted_address }`
 * shape.
 */
const site_handover = automation({
	description:
		'Bundles each selected site with its dispatched jobs, variation requests and photo evidence into one JSON file plus a CSV per table, for handover to another system.',
	input: { ids: { kind: 'list', of: { kind: 'id', of: 'sites' }, min: 1 } },
	output: {
		kind: 'object',
		fields: { files: { kind: 'file', accept: ['*/*'], max: '20MiB', multiple: true } }
	},
	runAs: 'trigger'
});
export default site_handover;

type Point = { readonly lat: number; readonly lng: number } | null;
const geolocation = (point: Point, address: string | null) =>
	point == null
		? null
		: {
				geometry: { lat: point.lat, lon: point.lng },
				formatted_address: address,
				type: 'Point',
				srid: 4326
			};
/** RFC 4180; an object cell is its JSON. */
const csv = (rows: readonly { readonly [k: string]: unknown }[]) => {
	const head = Object.keys(rows[0] ?? {});
	const cell = (v: unknown) => {
		const s = v == null ? '' : Predicate.isObjectOrArray(v) ? JSON.stringify(v) : String(v);
		return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
	};
	return [head, ...rows.map((row) => head.map((k) => row[k]))]
		.map((r) => r.map(cell).join(','))
		.join('\r\n');
};

site_handover.run(async ({ ids }, ctx) => {
	const put = (text: string, name: string, mime: string) =>
		ctx.files.put(new TextEncoder().encode(text), { name, mime, for: 'site_handover' });
	const { rows: sites } = await ctx.read('sites', { where: { id: { in: ids } }, all: true });
	const { rows: jobs } = await ctx.read('job_assignments', {
		where: { site_id: { in: ids } },
		all: true
	});
	const jobIds = jobs.map((job) => job.id);
	const { rows: variations } = jobIds.length
		? await ctx.read('variation_requests', {
				where: { job_assignment_id: { in: jobIds } },
				all: true
			})
		: { rows: [] };
	const variationIds = variations.map((v) => v.id);
	const { rows: photos } = jobIds.length
		? await ctx.read('photo_evidence', {
				where: {
					or: [
						{ job_assignment_id: { in: jobIds } },
						...(variationIds.length ? [{ variation_request_id: { in: variationIds } }] : [])
					]
				},
				// a read returns a file field only when selected: the bundle carries each photo
				select: {
					job_assignment_id: true,
					variation_request_id: true,
					photo: true,
					sha256: true,
					flags: true,
					matched_evidence_ids: true
				},
				all: true
			})
		: { rows: [] };
	const files = [];
	for (const site of sites) {
		const siteJobs = jobs.filter((job) => job.site_id === site.id);
		const jobSet = new Set<string>(siteJobs.map((job) => job.id));
		const siteVariations = variations.filter((v) => jobSet.has(v.job_assignment_id));
		const variationSet = new Set<string>(siteVariations.map((v) => v.id));
		const sitePhotos = photos.filter(
			(p) =>
				(p.job_assignment_id != null && jobSet.has(p.job_assignment_id)) ||
				(p.variation_request_id != null && variationSet.has(p.variation_request_id))
		);
		const code = (site.name || site.id).replace(/[^a-z0-9_-]/gi, '_');
		const jobRows = siteJobs.map((job) => ({
			record_id: job.id,
			site_id: job.site_id,
			external_ref: job.external_ref,
			title: job.title,
			nature: job.nature,
			scheduled_for: job.scheduled_for,
			description: job.description,
			assignee_user_id: job.assignee_user_id,
			dispatched_at: job.dispatched_at,
			status: job.status,
			completed_at: job.completed_at,
			amount_charged: job.amount_charged,
			summary: job.summary,
			location: geolocation(job.location, job.location_address)
		}));
		const variationRows = siteVariations.map((v) => ({
			record_id: v.id,
			job_assignment_id: v.job_assignment_id,
			requested_at: v.requested_at,
			title: v.title,
			description: v.description,
			amount: v.amount,
			approval_request_id: v.approval_id
		}));
		const photoRows = sitePhotos.map((p) => ({
			record_id: p.id,
			job_assignment_id: p.job_assignment_id,
			variation_request_id: p.variation_request_id,
			photo: p.photo,
			sha256: p.sha256,
			flags: p.flags,
			matched_evidence_ids: p.matched_evidence_ids
		}));
		const bundle = {
			schema: SCHEMA,
			site: { ...site, location: geolocation(site.location, site.address) },
			job_assignments: jobRows,
			variation_requests: variationRows,
			photo_evidence: photoRows
		};
		files.push(
			await put(JSON.stringify(bundle), `field_ops_${code}.json`, 'application/json'),
			await put(csv(jobRows), `field_ops_${code}_job_assignments.csv`, 'text/csv'),
			await put(csv(variationRows), `field_ops_${code}_variations.csv`, 'text/csv'),
			await put(
				csv(
					photoRows.map((p) => ({
						...p,
						flags: p.flags.join('|'),
						matched_evidence_ids: p.matched_evidence_ids.join('|')
					}))
				),
				`field_ops_${code}_photo_evidence.csv`,
				'text/csv'
			)
		);
	}
	return { files };
});
