import { Clock, Effect } from 'effect';
import type { Hooks, HookApi, WorkspaceRow } from './$types.js';

const ASSIGNMENT_ERROR =
	'Worker must satisfy at least one site-location job requirement with all required active certifications before assignment.';

type ComplianceTarget = Partial<
	Pick<WorkspaceRow<'job_assignments'>, 'site_location_id' | 'worker_id'>
>;

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Refuses a new job assignment unless the worker holds active permits to work covering every certification required by a job at that site location.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						yield* validateJobAssignmentCompliance(
							{ site_location_id: input.site_location_id, worker_id: input.worker_id },
							api
						);
						return input;
					})
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Re-checks the worker against the site location whenever either is changed, so an assignment cannot be moved onto work the worker is not certified for.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const record = { ...existing, ...input };
						yield* validateJobAssignmentCompliance(
							{ site_location_id: record.site_location_id, worker_id: record.worker_id },
							api
						);
						return input;
					})
			}
		}
	}
} satisfies Hooks;

function validateJobAssignmentCompliance(
	incoming: ComplianceTarget,
	api: HookApi
): Effect.Effect<void, Error> {
	return Effect.gen(function* () {
		const siteLocationId = incoming.site_location_id;
		const workerId = incoming.worker_id;
		if (siteLocationId == null || workerId == null) {
			return yield* Effect.fail(new Error(ASSIGNMENT_ERROR));
		}

		const now = new Date(yield* Clock.currentTimeMillis).toISOString();
		const workerPermitLinks = yield* api.db.query.permits_to_work_workers.findMany({
			where: { worker_id: { eq: workerId } },
			limit: 250
		});
		const permitIds = [...new Set(workerPermitLinks.map((link) => link.permits_to_work_id))];
		const permits =
			permitIds.length === 0
				? []
				: yield* api.db.query.permits_to_work.findMany({
						where: { id: { in: permitIds } },
						limit: 250
					});
		const permitCertificationLinks =
			permitIds.length === 0
				? []
				: yield* api.db.query.permits_to_work_certification_types.findMany({
						where: { permits_to_work_id: { in: permitIds } },
						limit: 250
					});
		const certificationIdsByPermit = new Map<string, string[]>();
		for (const link of permitCertificationLinks) {
			const ids = certificationIdsByPermit.get(link.permits_to_work_id) ?? [];
			ids.push(link.certification_type_id);
			certificationIdsByPermit.set(link.permits_to_work_id, ids);
		}

		const coveredCertificationIds = new Set<string>();
		for (const permit of permits) {
			if (permit.status !== 'active') continue;
			if (permit.validity_range?.start != null && permit.validity_range.start > now) continue;
			if (permit.validity_range?.end != null && permit.validity_range.end < now) continue;
			for (const certificationId of certificationIdsByPermit.get(permit.id) ?? []) {
				coveredCertificationIds.add(certificationId);
			}
		}

		const siteJobLinks = yield* api.db.query.jobs_site_locations.findMany({
			where: { site_location_id: { eq: siteLocationId } },
			limit: 250
		});
		const jobIds = [...new Set(siteJobLinks.map((link) => link.job_id))];
		const jobCertificationLinks =
			jobIds.length === 0
				? []
				: yield* api.db.query.jobs_certification_types.findMany({
						where: { job_id: { in: jobIds } },
						limit: 250
					});

		if (jobIds.length === 0) {
			return yield* Effect.fail(new Error(ASSIGNMENT_ERROR));
		}
		const certificationIdsByJob = new Map<string, string[]>();
		for (const link of jobCertificationLinks) {
			const ids = certificationIdsByJob.get(link.job_id) ?? [];
			ids.push(link.certification_type_id);
			certificationIdsByJob.set(link.job_id, ids);
		}

		const hasRequiredCertification = jobIds.some((jobId) => {
			const requiredCertificationIds = certificationIdsByJob.get(jobId) ?? [];
			if (requiredCertificationIds.length === 0) return false;
			return requiredCertificationIds.every((certificationId) =>
				coveredCertificationIds.has(certificationId)
			);
		});

		if (!hasRequiredCertification) {
			return yield* Effect.fail(new Error(ASSIGNMENT_ERROR));
		}
	});
}
