import type { Hooks } from './$types.js';
import {
	contractorSatisfiesCertificationRequirements,
	missingCertificationIds
} from '../../lib/certification-eligibility.js';
import { coordinatesOf, exceedsSiteTolerance, type LocationLike } from '../../lib/haversine.js';
import { photoEvidenceIsSuspicious } from '../photo_evidence/lib/photo-integrity.js';

type AssignmentIdentity = {
	job_id?: string | null;
	contractor_profile_id?: string | null;
};

type AssignmentStatus = 'dispatched' | 'in_progress' | 'completed' | 'suspect';
type AssignmentUpdateBefore = NonNullable<NonNullable<Hooks['update']>['before']>;
type AssignmentUpdateApi = Parameters<AssignmentUpdateBefore['handler']>[0]['api'];

async function assignmentHasGeotaggedPhoto(
	api: AssignmentUpdateApi,
	assignmentId: string
): Promise<boolean> {
	const [directEvidence, variations] = await Promise.all([
		api.db.query.photo_evidence.findMany({
			where: { job_assignment_id: { eq: assignmentId } },
			columns: { flags: true },
			limit: 1000
		}),
		api.db.query.variation_requests.findMany({
			where: { job_assignment_id: { eq: assignmentId } },
			columns: { norbital_id: true },
			limit: 1000
		})
	]);
	const variationIds = variations.map((variation) => variation.norbital_id);
	const variationEvidence =
		variationIds.length === 0
			? []
			: await api.db.query.photo_evidence.findMany({
					where: { variation_request_id: { in: variationIds } },
					columns: { flags: true },
					limit: 1000
				});
	return [...directEvidence, ...variationEvidence].some(
		(evidence) => !evidence.flags.includes('missing_geolocation')
	);
}

async function assignmentHasPendingSiteIdentity(
	api: AssignmentUpdateApi,
	assignmentId: string
): Promise<boolean> {
	const [directEvidence, variations] = await Promise.all([
		api.db.query.photo_evidence.findMany({
			where: { job_assignment_id: { eq: assignmentId } },
			columns: { site_identity_status: true },
			limit: 1000
		}),
		api.db.query.variation_requests.findMany({
			where: { job_assignment_id: { eq: assignmentId } },
			columns: { norbital_id: true },
			limit: 1000
		})
	]);
	const variationIds = variations.map((variation) => variation.norbital_id);
	const variationEvidence =
		variationIds.length === 0
			? []
			: await api.db.query.photo_evidence.findMany({
					where: { variation_request_id: { in: variationIds } },
					columns: { site_identity_status: true },
					limit: 1000
				});
	return [...directEvidence, ...variationEvidence].some(
		(evidence) =>
			evidence.site_identity_status === 'pending' || evidence.site_identity_status === 'failed'
	);
}

function requireId(value: string | null | undefined, message: string): string {
	if (!value) throw new Error(message);
	return value;
}

function requireFound<T>(value: T, message: string): NonNullable<T> {
	if (value == null) throw new Error(message);
	return value;
}

function assertAbsent(value: unknown, message: string): void {
	if (value != null) throw new Error(message);
}

function assignmentStatus(value: string | null | undefined): AssignmentStatus {
	switch (value) {
		case 'dispatched':
		case 'in_progress':
		case 'completed':
		case 'suspect':
			return value;
		case undefined:
		case null:
			return 'dispatched';
		default:
			throw new Error(`Unsupported assignment status: ${value}.`);
	}
}

export function applySuspectOneWay(
	current: AssignmentStatus,
	forceSuspect: boolean
): AssignmentStatus {
	if (current === 'suspect' || forceSuspect) return 'suspect';
	return current;
}

export function assignmentStatusForLocation(
	status: AssignmentStatus,
	assignmentLocation: LocationLike,
	siteLocation: LocationLike
): AssignmentStatus {
	return applySuspectOneWay(
		status,
		exceedsSiteTolerance(coordinatesOf(assignmentLocation), coordinatesOf(siteLocation))
	);
}

export function assertAssignmentIdentityUnchanged(
	input: AssignmentIdentity,
	existing: Required<AssignmentIdentity>
): void {
	if (input.job_id != null && input.job_id !== existing.job_id) {
		throw new Error('A dispatched assignment cannot be moved to another job.');
	}
	if (
		input.contractor_profile_id != null &&
		input.contractor_profile_id !== existing.contractor_profile_id
	) {
		throw new Error('A dispatched assignment cannot be moved to another contractor.');
	}
}

export default {
	create: {
		before: {
			description:
				'Dispatches a contractor to a job only when the job has no assignment yet and the contractor holds every certification the job requires, stamps the dispatch time, and marks the assignment suspect when the reported location sits outside the site tolerance.',
			handler: async ({ input, api }) => {
				const jobId = requireId(input.job_id, 'Job assignment must reference a job.');
				const contractorId = requireId(
					input.contractor_profile_id,
					'Job assignment must reference a contractor profile.'
				);

				const [foundJob, foundContractor, existingAssignment, existingSource] = await Promise.all([
					api.db.query.jobs.findFirst({
						where: { norbital_id: { eq: jobId } }
					}),
					api.db.query.contractor_profiles.findFirst({
						where: { norbital_id: { eq: contractorId } }
					}),
					api.db.query.job_assignments.findFirst({
						where: { job_id: { eq: jobId } }
					}),
					input.source_message_id != null && input.source_message_id !== ''
						? api.db.query.job_assignments.findFirst({
								where: { source_message_id: { eq: input.source_message_id } }
							})
						: Promise.resolve(undefined)
				]);

				const job = requireFound(foundJob, 'Referenced job does not exist.');
				requireFound(foundContractor, 'Referenced contractor profile does not exist.');
				assertAbsent(existingAssignment, 'This job already has an assignment.');
				assertAbsent(
					existingSource,
					'A job assignment with this source_message_id already exists.'
				);
				const [requirements, holdings] = await Promise.all([
					api.db.query.job_certification_requirements.findMany({
						where: { job_id: { eq: jobId } },
						limit: 250
					}),
					api.db.query.contractor_certifications.findMany({
						where: { contractor_profile_id: { eq: contractorId } },
						limit: 250
					})
				]);
				if (!contractorSatisfiesCertificationRequirements(holdings, requirements)) {
					const missingIds = missingCertificationIds(holdings, requirements);
					const missingTypes = await api.db.query.certification_types.findMany({
						where: { norbital_id: { in: missingIds } },
						columns: { norbital_id: true, name: true },
						limit: missingIds.length
					});
					const missingNames = new Map(
						missingTypes.map((certification) => [certification.norbital_id, certification.name])
					);
					throw new Error(
						`Contractor is missing required certifications: ${missingIds
							.map((certificationId) => missingNames.get(certificationId) ?? '—')
							.join(', ')}.`
					);
				}

				const site =
					input.location == null
						? undefined
						: await api.db.query.sites.findFirst({
								where: { norbital_id: { eq: job.site_id } }
							});
				const status = assignmentStatusForLocation(
					assignmentStatus(input.status),
					input.location,
					site?.location
				);

				return {
					...input,
					dispatched_at: input.dispatched_at ?? new Date(),
					status
				};
			}
		},
		after: {
			description:
				'Moves a job from unassigned to assigned as soon as its first contractor is dispatched.',
			handler: async ({ record, api }) => {
				const job = await api.db.query.jobs.findFirst({
					where: { norbital_id: { eq: record.job_id } }
				});
				if (job?.status === 'unassigned') {
					await api.db.mutate('jobs', [{ norbital_id: record.job_id, status: 'assigned' }]);
				}
			}
		}
	},
	update: {
		before: {
			description:
				'Holds an assignment on its original job and contractor, stamps completion, and flags it when neither GPS metadata nor visual site identity can establish the location; cross-assignment photo reuse remains a one-way hard flag.',
			handler: async ({ input, existing, api }) => {
				assertAssignmentIdentityUnchanged(input, existing);
				const withCompletion =
					input.status === 'completed' && input.completed_at == null
						? { ...input, completed_at: new Date() }
						: input;
				const jobId = input.job_id ?? existing.job_id;
				const location = input.location ?? existing.location;
				const existingStatus = assignmentStatus(existing.status);
				const baseStatus = assignmentStatus(input.status ?? existing.status);
				const preserveSuspect = existingStatus === 'suspect';
				const completing = input.status === 'completed';
				const hasSiteIdentity =
					(input.site_identity_unverified ?? existing.site_identity_unverified) === false;
				const hasGeolocation =
					completing && existing.norbital_id != null
						? await assignmentHasGeotaggedPhoto(api, existing.norbital_id)
						: false;
				const hasPendingSiteIdentity =
					completing && existing.norbital_id != null
						? await assignmentHasPendingSiteIdentity(api, existing.norbital_id)
						: false;
				const completingWithoutLocationEvidence =
					completing &&
					!hasPendingSiteIdentity &&
					photoEvidenceIsSuspicious({
						hasGeolocation,
						hasSiteIdentity,
						hasCrossAssignmentDuplicate: false
					});

				if (location == null || jobId == null) {
					return {
						...withCompletion,
						status: applySuspectOneWay(
							baseStatus,
							preserveSuspect || completingWithoutLocationEvidence
						)
					};
				}

				const job = await api.db.query.jobs.findFirst({
					where: { norbital_id: { eq: jobId } }
				});
				if (job == null) {
					return {
						...withCompletion,
						status: applySuspectOneWay(
							baseStatus,
							preserveSuspect || completingWithoutLocationEvidence
						)
					};
				}

				const site = await api.db.query.sites.findFirst({
					where: { norbital_id: { eq: job.site_id } }
				});
				if (site?.location == null) {
					return {
						...withCompletion,
						status: applySuspectOneWay(
							baseStatus,
							preserveSuspect || completingWithoutLocationEvidence
						)
					};
				}

				const forceSuspect =
					preserveSuspect ||
					completingWithoutLocationEvidence ||
					exceedsSiteTolerance(coordinatesOf(location), coordinatesOf(site.location));
				return { ...withCompletion, status: applySuspectOneWay(baseStatus, forceSuspect) };
			}
		},
		after: {
			description:
				'Carries assignment progress onto its job, and never rewinds progress already recorded when the assignment is flagged suspect.',
			handler: async ({ record, api }) => {
				const status = record.status;
				if (status == null) return;
				// Suspect is an integrity overlay — never rewind job progression already recorded.
				if (status === 'suspect') {
					const job = await api.db.query.jobs.findFirst({
						where: { norbital_id: { eq: record.job_id } },
						columns: { status: true }
					});
					if (job?.status === 'unassigned') {
						await api.db.mutate('jobs', [{ norbital_id: record.job_id, status: 'assigned' }]);
					}
					return;
				}
				const jobStatus = mapAssignmentStatusToJobStatus(
					status as 'dispatched' | 'in_progress' | 'completed' | 'suspect'
				);
				await api.db.mutate('jobs', [{ norbital_id: record.job_id, status: jobStatus }]);
			}
		}
	}
} satisfies Hooks;

export function mapAssignmentStatusToJobStatus(
	status: 'dispatched' | 'in_progress' | 'completed' | 'suspect'
): 'assigned' | 'in_progress' | 'completed' {
	switch (status) {
		case 'completed':
			return 'completed';
		case 'in_progress':
			return 'in_progress';
		case 'suspect':
		case 'dispatched':
			return 'assigned';
		default: {
			const _exhaustive: never = status;
			return _exhaustive;
		}
	}
}
