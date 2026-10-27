import { automation, type StartOutput } from '@norbital-ai/bolt';
import * as Predicate from 'effect/Predicate';
import { Decimal } from '@norbital-ai/std/decimal';
const SCHEMA = 'norbital.field_operations.interoperability.v2';
type Point = {
	readonly lat: number;
	readonly lng: number;
} | null;
const geolocation = (point: Point, address: string | null) =>
	point == null
		? null
		: {
				geometry: { lat: point.lat, lon: point.lng },
				formatted_address: address,
				type: 'Point',
				srid: 4326
			};
/** RFC 4180; a decimal cell is its digits, any other object cell its JSON. */
const csv = (
	rows: readonly {
		readonly [k: string]: unknown;
	}[]
) => {
	const head = Object.keys(rows[0] ?? {});
	const cell = (v: unknown) => {
		const s =
			v == null
				? ''
				: v instanceof Decimal
					? v.toString()
					: Predicate.isObjectOrArray(v)
						? JSON.stringify(v)
						: String(v);
		return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
	};
	return [head, ...rows.map((row) => head.map((k) => row[k]))]
		.map((r) => r.map(cell).join(','))
		.join('\r\n');
};
/**
 * The handover bundle for the selected sites: per site, one JSON file with the site, its dispatched jobs and photo
 * evidence, and a CSV per table, left on its run. It
 * reads as its starter (`runAs: 'trigger'`). `location` keeps the downstream contract's `{ geometry, formatted_address }`
 * shape.
 */
export default automation('site_handover', {
	description:
		'Bundles each selected site with its dispatched jobs and photo evidence into one JSON file plus a CSV per table, for handover to another system.',
	input: { ids: { kind: 'list', of: { kind: 'id', of: 'sites' }, min: 1 } },
	output: {
		kind: 'object',
		fields: { files: { kind: 'file', accept: ['*/*'], max: '20MiB', multiple: true } }
	},
	runAs: 'trigger',
	run: function* ({ ids }, ctx) {
		const put = (text: string, name: string, mime: string) =>
			ctx.files.put(new TextEncoder().encode(text), { name, mime, for: 'site_handover' });
		// one read: the sites, their jobs and those jobs' photos
		const ON_SITES = { site_id: { in: ids } } as const;
		const {
			sites: { rows: sites },
			job_assignments: { rows: jobs },
			photo_evidence: { rows: photos }
		} = yield* ctx.query({
			sites: { where: { id: { in: ids } } },
			job_assignments: { where: ON_SITES },
			photo_evidence: {
				where: { job_assignment_id: { is: ON_SITES } },
				// a read returns a file field only when named: the bundle carries each photo
				fields: ['job_assignment_id', 'photo', 'sha256', 'flags', 'matched_evidence_ids']
			}
		});
		const files: StartOutput<'site_handover'>['files'][number][] = [];
		for (const site of sites) {
			const siteJobs = jobs.filter((job) => job.site_id === site.id);
			const jobSet = new Set<string>(siteJobs.map((job) => job.id));
			const sitePhotos = photos.filter(
				(p) => p.job_assignment_id != null && jobSet.has(p.job_assignment_id)
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
			const photoRows = sitePhotos.map((p) => ({
				record_id: p.id,
				job_assignment_id: p.job_assignment_id,
				photo: p.photo,
				sha256: p.sha256,
				flags: p.flags,
				matched_evidence_ids: p.matched_evidence_ids
			}));
			const bundle = {
				schema: SCHEMA,
				site: { ...site, location: geolocation(site.location, site.address) },
				job_assignments: jobRows,
				photo_evidence: photoRows
			};
			files.push(
				yield* put(JSON.stringify(bundle), `field_ops_${code}.json`, 'application/json'),
				yield* put(csv(jobRows), `field_ops_${code}_job_assignments.csv`, 'text/csv'),
				yield* put(
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
	}
});
