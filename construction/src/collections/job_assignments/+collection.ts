import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { currentInstantIso } from '../../lib/clock.js';
import model from './+model.js';

const ASSIGNMENT_ERROR =
	'Worker must satisfy at least one site-location job requirement with all required active certifications before assignment.';

const columns = {
	assignment_code: true,
	job_id: true,
	worker_id: true,
	site_location_id: true,
	role: true,
	assignment_range: true,
	status: true,
	hours_per_day: true,
	required_certifications: true
} as const;

const input = { input: { columns } } as const;

const unique = (ids: ReadonlyArray<string>): string[] => [...new Set(ids)];

/**
 * Refuses an assignment unless the worker holds active permits to work covering every certification
 * required by a job at that site location. Re-checked whenever the worker or the site location
 * changes, so an assignment cannot be moved onto work the worker is not certified for.
 */
export default defineCollection({
	model,
	create: input,
	update: input,
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const targets = inputs.map((input, i) => ({
				workerId: input.worker_id ?? existing[i]?.worker_id ?? null,
				siteLocationId: input.site_location_id ?? existing[i]?.site_location_id ?? null
			}));
			for (const target of targets) {
				if (target.workerId == null || target.siteLocationId == null) refuse(ASSIGNMENT_ERROR);
			}
			const workerIds = unique(targets.flatMap((t) => (t.workerId == null ? [] : [t.workerId])));
			const siteLocationIds = unique(
				targets.flatMap((t) => (t.siteLocationId == null ? [] : [t.siteLocationId]))
			);

			// Wave 1: keyed by the inputs alone.
			const [now, workerPermitLinks, siteJobLinks] = yield* Effect.all(
				[
					currentInstantIso,
					db.permits_to_work_workers.findMany({
						where: { worker_id: { in: workerIds } },
						limit: 250
					}),
					db.jobs_site_locations.findMany({
						where: { site_location_id: { in: siteLocationIds } },
						limit: 250
					})
				],
				{ concurrency: 'unbounded' }
			);
			const permitIds = unique(workerPermitLinks.map((link) => link.permits_to_work_id));
			const jobIds = unique(siteJobLinks.map((link) => link.job_id));

			// Wave 2: keyed by wave 1's ids.
			const [permits, permitCertificationLinks, jobCertificationLinks] = yield* Effect.all(
				[
					permitIds.length === 0
						? Effect.succeed([])
						: db.permits_to_work.findMany({ where: { id: { in: permitIds } }, limit: 250 }),
					permitIds.length === 0
						? Effect.succeed([])
						: db.permits_to_work_certification_types.findMany({
								where: { permits_to_work_id: { in: permitIds } },
								limit: 250
							}),
					jobIds.length === 0
						? Effect.succeed([])
						: db.jobs_certification_types.findMany({
								where: { job_id: { in: jobIds } },
								limit: 250
							})
				],
				{ concurrency: 'unbounded' }
			);

			const permitById = new Map(permits.map((permit) => [permit.id, permit]));
			const certificationIdsByPermit = new Map<string, string[]>();
			for (const link of permitCertificationLinks) {
				const ids = certificationIdsByPermit.get(link.permits_to_work_id) ?? [];
				ids.push(link.certification_type_id);
				certificationIdsByPermit.set(link.permits_to_work_id, ids);
			}
			const certificationIdsByJob = new Map<string, string[]>();
			for (const link of jobCertificationLinks) {
				const ids = certificationIdsByJob.get(link.job_id) ?? [];
				ids.push(link.certification_type_id);
				certificationIdsByJob.set(link.job_id, ids);
			}

			for (const { workerId, siteLocationId } of targets) {
				const covered = new Set<string>();
				for (const link of workerPermitLinks) {
					if (link.worker_id !== workerId) continue;
					const permit = permitById.get(link.permits_to_work_id);
					if (permit === undefined || permit.status !== 'active') continue;
					if (permit.validity_range?.start != null && permit.validity_range.start > now) continue;
					if (permit.validity_range?.end != null && permit.validity_range.end < now) continue;
					for (const id of certificationIdsByPermit.get(permit.id) ?? []) covered.add(id);
				}
				const siteJobIds = siteJobLinks
					.filter((link) => link.site_location_id === siteLocationId)
					.map((link) => link.job_id);
				const qualified = siteJobIds.some((jobId) => {
					const required = certificationIdsByJob.get(jobId) ?? [];
					return required.length > 0 && required.every((id) => covered.has(id));
				});
				if (!qualified) refuse(ASSIGNMENT_ERROR);
			}
			return inputs;
		})
});
