import { Effect } from 'effect';
import type { Hooks } from './$types.js';

type AssignmentIdentity = {
	job_id?: string | null;
	contractor_profile_id?: string | null;
};

type AssignmentStatus = 'dispatched' | 'in_progress' | 'completed' | 'suspect';
type AssignmentUpdateBefore = NonNullable<NonNullable<Hooks['update']>['before']>;
const ASSIGNMENT_BATCH_LIMIT = 5_000;
const SITE_LOCATION_TOLERANCE_M = 500;

type LocationLike =
	| {
			geometry?: { lat?: number | null; lon?: number | null } | null;
	  }
	| null
	| undefined;

function coordinatesOf(location: LocationLike): { lat: number; lon: number } | null {
	const lat = location?.geometry?.lat;
	const lon = location?.geometry?.lon;
	if (lat == null || lon == null) return null;
	return { lat, lon };
}

function haversineMeters(
	lat1: number | null | undefined,
	lon1: number | null | undefined,
	lat2: number | null | undefined,
	lon2: number | null | undefined
): number | null {
	if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
	const R = 6371000;
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function exceedsSiteTolerance(
	left: { lat: number; lon: number } | null | undefined,
	right: { lat: number; lon: number } | null | undefined,
	maxDistanceM = SITE_LOCATION_TOLERANCE_M
): boolean {
	const distanceM = haversineMeters(left?.lat, left?.lon, right?.lat, right?.lon);
	return distanceM != null && distanceM > maxDistanceM;
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

export interface AssignmentCreateInput {
	readonly job_id?: string | null;
	readonly contractor_profile_id?: string | null;
	readonly source_message_id?: string | null;
	readonly dispatched_at?: Date | string | null;
	readonly status?: string | null;
	readonly location?: LocationLike;
}

export interface AssignmentCreateBatchLookup {
	readonly jobs: ReadonlyMap<string, { readonly site_id: string | null }>;
	readonly contractorIds: ReadonlySet<string>;
	readonly occupiedJobIds: ReadonlySet<string>;
	readonly occupiedSourceMessageIds: ReadonlySet<string>;
	readonly sites: ReadonlyMap<string, LocationLike>;
}

export function prepareAssignmentCreateBatch<T extends AssignmentCreateInput>(
	inputs: readonly T[],
	lookup: AssignmentCreateBatchLookup,
	now: () => Date = () => new Date()
): Array<
	T & {
		readonly dispatched_at: Date | string;
		readonly status: AssignmentStatus;
	}
> {
	const batchJobIds = new Set<string>();
	const batchSourceMessageIds = new Set<string>();
	return inputs.map((input) => {
		const jobId = requireId(input.job_id, 'Job assignment must reference a job.');
		const contractorId = requireId(
			input.contractor_profile_id,
			'Job assignment must reference a contractor profile.'
		);
		const job = lookup.jobs.get(jobId);
		if (!job) throw new Error('Referenced job does not exist.');
		if (!lookup.contractorIds.has(contractorId)) {
			throw new Error('Referenced contractor profile does not exist.');
		}
		if (lookup.occupiedJobIds.has(jobId) || batchJobIds.has(jobId)) {
			throw new Error('This job already has an assignment.');
		}
		batchJobIds.add(jobId);
		const sourceMessageId = input.source_message_id;
		if (sourceMessageId) {
			if (
				lookup.occupiedSourceMessageIds.has(sourceMessageId) ||
				batchSourceMessageIds.has(sourceMessageId)
			) {
				throw new Error('A job assignment with this source_message_id already exists.');
			}
			batchSourceMessageIds.add(sourceMessageId);
		}

		const siteLocation = job.site_id ? lookup.sites.get(job.site_id) : null;
		return {
			...input,
			dispatched_at: input.dispatched_at ?? now(),
			status: assignmentStatusForLocation(
				assignmentStatus(input.status),
				input.location,
				siteLocation
			)
		};
	});
}

export default {
	create: {
		before: {
			description:
				'Dispatches a contractor to an unassigned job, stamps the dispatch time, and marks the assignment suspect when the reported location sits outside the site tolerance.',
			batchHandler: ({ inputs, api }) =>
				Effect.gen(function* () {
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
					const [jobs, contractors, occupiedJobs, occupiedSources] = yield* Effect.all(
						[
							jobIds.length
								? api.db.query.jobs.findMany({
										where: { norbital_id: { in: jobIds } },
										columns: { norbital_id: true, site_id: true },
										limit: ASSIGNMENT_BATCH_LIMIT
									})
								: Effect.succeed([]),
							contractorIds.length
								? api.db.query.contractor_profiles.findMany({
										where: { norbital_id: { in: contractorIds } },
										columns: { norbital_id: true },
										limit: ASSIGNMENT_BATCH_LIMIT
									})
								: Effect.succeed([]),
							jobIds.length
								? api.db.query.job_assignments.findMany({
										where: { job_id: { in: jobIds } },
										columns: { job_id: true },
										limit: ASSIGNMENT_BATCH_LIMIT
									})
								: Effect.succeed([]),
							sourceMessageIds.length
								? api.db.query.job_assignments.findMany({
										where: { source_message_id: { in: sourceMessageIds } },
										columns: { source_message_id: true },
										limit: ASSIGNMENT_BATCH_LIMIT
									})
								: Effect.succeed([])
						],
						{ concurrency: 'unbounded' }
					);
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
						? yield* api.db.query.sites.findMany({
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
				}),
			handler: ({ input, api }) =>
				Effect.gen(function* () {
					const jobId = requireId(input.job_id, 'Job assignment must reference a job.');
					const contractorId = requireId(
						input.contractor_profile_id,
						'Job assignment must reference a contractor profile.'
					);

					const [foundJob, foundContractor, existingAssignment, existingSource] = yield* Effect.all(
						[
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
								: Effect.succeed(undefined)
						],
						{ concurrency: 'unbounded' }
					);

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
							: yield* api.db.query.sites.findFirst({
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
				})
		},
		after: {
			description:
				'Moves a job from unassigned to assigned as soon as its first contractor is dispatched.',
			batchHandler: ({ records, api }) =>
				Effect.gen(function* () {
					const jobIds = [...new Set(records.map((record) => record.job_id))];
					const jobs = yield* api.db.query.jobs.findMany({
						where: { norbital_id: { in: jobIds } },
						columns: { norbital_id: true, status: true },
						limit: ASSIGNMENT_BATCH_LIMIT
					});
					const jobsById = new Map(jobs.map((job) => [job.norbital_id, job]));
					yield* api.db.jobs.mutate(
						records.flatMap((record) =>
							jobsById.get(record.job_id)?.status === 'unassigned'
								? [{ norbital_id: record.job_id, status: 'assigned' as const }]
								: []
						)
					);
				}),
			handler: ({ record, api }) =>
				Effect.gen(function* () {
					const job = yield* api.db.query.jobs.findFirst({
						where: { norbital_id: { eq: record.job_id } }
					});
					if (job?.status === 'unassigned') {
						yield* api.db.jobs.mutate([{ norbital_id: record.job_id, status: 'assigned' }]);
					}
				})
		}
	},
	update: {
		before: {
			description:
				'Holds an assignment on its original job and contractor, stamps completion, and preserves a prior judgement or a contradictory reported assignment location.',
			handler: ({ input, existing, api }) =>
				Effect.gen(function* () {
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

					const job = yield* api.db.query.jobs.findFirst({
						where: { norbital_id: { eq: jobId } }
					});
					if (job == null) {
						return {
							...withCompletion,
							status: applySuspectOneWay(baseStatus, preserveSuspect)
						};
					}

					const site = yield* api.db.query.sites.findFirst({
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
				})
		},
		after: {
			description:
				'Carries assignment progress onto its job, and never rewinds progress already recorded when the assignment is flagged suspect.',
			handler: ({ record, api }) =>
				Effect.gen(function* () {
					const status = record.status;
					if (status == null) return;
					// Suspect is an integrity overlay — never rewind job progression already recorded.
					if (status === 'suspect') {
						const job = yield* api.db.query.jobs.findFirst({
							where: { norbital_id: { eq: record.job_id } },
							columns: { status: true }
						});
						if (job?.status === 'unassigned') {
							yield* api.db.jobs.mutate([{ norbital_id: record.job_id, status: 'assigned' }]);
						}
						return;
					}
					const jobStatus = mapAssignmentStatusToJobStatus(
						status as 'dispatched' | 'in_progress' | 'completed' | 'suspect'
					);
					yield* api.db.jobs.mutate([{ norbital_id: record.job_id, status: jobStatus }]);
				})
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
