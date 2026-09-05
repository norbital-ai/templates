import {
	refuse,
	type CollectionMutationValues,
	type MutateBeforeContext,
	type MutateEditContext
} from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { currentInstantIso } from '../../lib/clock.js';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { Api, Hooks, WorkspaceRow } from './$types.js';

const ASSIGNMENT_ERROR =
	'Worker must satisfy at least one site-location job requirement with all required active certifications before assignment.';

type ComplianceTarget = Partial<
	Pick<WorkspaceRow<'job_assignments'>, 'site_location_id' | 'worker_id'>
>;

type BeforeContext = MutateBeforeContext<Hooks>;
type EditContext = MutateEditContext<Hooks>;
type AssignmentWrite = CollectionMutationValues<WorkspaceSchema, 'job_assignments'>;

/** A create states the whole record and has no `existing`. */
const beforeCreate = ({ input, api }: BeforeContext): Effect.Effect<AssignmentWrite> =>
	Effect.map(
		validateJobAssignmentCompliance(
			{ site_location_id: input.site_location_id, worker_id: input.worker_id },
			api
		),
		() => input
	);

/** An edit lands on a stored row; `existing` is what tells the two apart. */
const beforeUpdate = ({
	input,
	existing,
	api
}: EditContext): Effect.Effect<Partial<AssignmentWrite>> => {
	const record = { ...existing, ...input };
	return Effect.map(
		validateJobAssignmentCompliance(
			{ site_location_id: record.site_location_id, worker_id: record.worker_id },
			api
		),
		() => input
	);
};

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses a new job assignment unless the worker holds active permits to work covering every certification required by a job at that site location. Re-checks the worker against the site location whenever either is changed, so an assignment cannot be moved onto work the worker is not certified for.',
				handler: (context) =>
					context.existing === undefined
						? beforeCreate(context)
						: beforeUpdate({ ...context, existing: context.existing })
			}
		}
	}
} satisfies Hooks;

function validateJobAssignmentCompliance(
	incoming: ComplianceTarget,
	api: Api
): Effect.Effect<void, never> {
	return Effect.gen(function* () {
		const siteLocationId = incoming.site_location_id;
		const workerId = incoming.worker_id;
		if (siteLocationId == null || workerId == null) {
			refuse(ASSIGNMENT_ERROR);
		}

		const now = yield* currentInstantIso;
		const workerPermitLinks = yield* api.db.permits_to_work_workers.findMany({
			where: { worker_id: { eq: workerId } },
			limit: 250
		});
		const permitIds = [...new Set(workerPermitLinks.map((link) => link.permits_to_work_id))];
		const permits =
			permitIds.length === 0
				? []
				: yield* api.db.permits_to_work.findMany({
						where: { id: { in: permitIds } },
						limit: 250
					});
		const permitCertificationLinks =
			permitIds.length === 0
				? []
				: yield* api.db.permits_to_work_certification_types.findMany({
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

		const siteJobLinks = yield* api.db.jobs_site_locations.findMany({
			where: { site_location_id: { eq: siteLocationId } },
			limit: 250
		});
		const jobIds = [...new Set(siteJobLinks.map((link) => link.job_id))];
		const jobCertificationLinks =
			jobIds.length === 0
				? []
				: yield* api.db.jobs_certification_types.findMany({
						where: { job_id: { in: jobIds } },
						limit: 250
					});

		if (jobIds.length === 0) {
			refuse(ASSIGNMENT_ERROR);
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
			refuse(ASSIGNMENT_ERROR);
		}
	});
}
