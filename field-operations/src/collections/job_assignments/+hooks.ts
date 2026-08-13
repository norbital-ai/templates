import type { Hooks } from './$types.js';
import { coordinatesOf, exceedsSiteTolerance, type LocationLike } from '../../lib/haversine.js';
import { prepareAssignmentCreateBatch } from './lib/create-batch.js';

type AssignmentIdentity = {
	job_id?: string | null;
	contractor_profile_id?: string | null;
};

type AssignmentStatus = 'dispatched' | 'in_progress' | 'completed' | 'suspect';
type AssignmentUpdateBefore = NonNullable<NonNullable<Hooks['update']>['before']>;
const ASSIGNMENT_BATCH_LIMIT = 5_000;

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
				'Dispatches a contractor to an unassigned job, stamps the dispatch time, and marks the assignment suspect when the reported location sits outside the site tolerance.',
			batchHandler: async ({ inputs, api }) => {
				const jobIds = [
					...new Set(inputs.flatMap((input) => (input.job_id ? [input.job_id] : [])))
				];
				const contractorIds = [
					...new Set(
						inputs.flatMap((input) =>
							input.contractor_profile_id ? [input.contractor_profile_id] : []
						)
					)
				];
				const sourceMessageIds = [
					...new Set(
						inputs.flatMap((input) => (input.source_message_id ? [input.source_message_id] : []))
					)
				];
				const [jobs, contractors, occupiedJobs, occupiedSources] = await Promise.all([
					jobIds.length
						? api.db.query.jobs.findMany({
								where: { norbital_id: { in: jobIds } },
								columns: { norbital_id: true, site_id: true },
								limit: ASSIGNMENT_BATCH_LIMIT
							})
						: [],
					contractorIds.length
						? api.db.query.contractor_profiles.findMany({
								where: { norbital_id: { in: contractorIds } },
								columns: { norbital_id: true },
								limit: ASSIGNMENT_BATCH_LIMIT
							})
						: [],
					jobIds.length
						? api.db.query.job_assignments.findMany({
								where: { job_id: { in: jobIds } },
								columns: { job_id: true },
								limit: ASSIGNMENT_BATCH_LIMIT
							})
						: [],
					sourceMessageIds.length
						? api.db.query.job_assignments.findMany({
								where: { source_message_id: { in: sourceMessageIds } },
								columns: { source_message_id: true },
								limit: ASSIGNMENT_BATCH_LIMIT
							})
						: []
				]);
				const locatedJobIds = new Set(
					inputs.flatMap((input) => (input.job_id && input.location ? [input.job_id] : []))
				);
				const siteIds = [
					...new Set(
						jobs.flatMap((job) =>
							locatedJobIds.has(job.norbital_id) && job.site_id ? [job.site_id] : []
						)
					)
				];
				const sites = siteIds.length
					? await api.db.query.sites.findMany({
							where: { norbital_id: { in: siteIds } },
							columns: { norbital_id: true, location: true },
							limit: ASSIGNMENT_BATCH_LIMIT
						})
					: [];
				return prepareAssignmentCreateBatch(inputs, {
					jobs: new Map(jobs.map((job) => [job.norbital_id, job])),
					contractorIds: new Set(contractors.map((contractor) => contractor.norbital_id)),
					occupiedJobIds: new Set(occupiedJobs.map((assignment) => assignment.job_id)),
					occupiedSourceMessageIds: new Set(
						occupiedSources.flatMap((assignment) =>
							assignment.source_message_id ? [assignment.source_message_id] : []
						)
					),
					sites: new Map(sites.map((site) => [site.norbital_id, site.location]))
				});
			},
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
			batchHandler: async ({ records, api }) => {
				const jobIds = [...new Set(records.map((record) => record.job_id))];
				const jobs = await api.db.query.jobs.findMany({
					where: { norbital_id: { in: jobIds } },
					columns: { norbital_id: true, status: true },
					limit: ASSIGNMENT_BATCH_LIMIT
				});
				const jobsById = new Map(jobs.map((job) => [job.norbital_id, job]));
				await api.db.mutate(
					'jobs',
					records.flatMap((record) =>
						jobsById.get(record.job_id)?.status === 'unassigned'
							? [{ norbital_id: record.job_id, status: 'assigned' as const }]
							: []
					)
				);
			},
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
				'Holds an assignment on its original job and contractor, stamps completion, and preserves a prior judgement or a contradictory reported assignment location.',
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
				if (location == null || jobId == null) {
					return {
						...withCompletion,
						status: applySuspectOneWay(baseStatus, preserveSuspect)
					};
				}

				const job = await api.db.query.jobs.findFirst({
					where: { norbital_id: { eq: jobId } }
				});
				if (job == null) {
					return {
						...withCompletion,
						status: applySuspectOneWay(baseStatus, preserveSuspect)
					};
				}

				const site = await api.db.query.sites.findFirst({
					where: { norbital_id: { eq: job.site_id } }
				});
				if (site?.location == null) {
					return {
						...withCompletion,
						status: applySuspectOneWay(baseStatus, preserveSuspect)
					};
				}

				const forceSuspect =
					preserveSuspect ||
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
