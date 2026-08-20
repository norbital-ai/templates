import type { CollectionHooks } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';

type AssignmentIdentity = {
	job_id?: string | null;
	contractor_profile_id?: string | null;
};

type AssignmentStatus = 'dispatched' | 'in_progress' | 'completed' | 'suspect';
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

/**
 * Everything one dispatch needs to know about the world, read once for the whole batch.
 *
 * The rule below is written for one assignment and asks five questions about it: does the job exist,
 * does the contractor exist, is the job already taken, is the source message already used, and where
 * is the site. Asked per record that is five round trips a row; asked here it is five for the batch.
 *
 * `repeatedJobIds` and `repeatedSourceMessageIds` are the one thing a per-record hook genuinely
 * cannot see: two rows in the same call claiming the same job. They are derived from the inputs, not
 * read — `prepare` still decides nothing — and the refusal itself is written once, below.
 */
export interface AssignmentCreateBatchLookup {
	readonly jobs: ReadonlyMap<string, { readonly site_id: string | null }>;
	readonly contractorIds: ReadonlySet<string>;
	readonly occupiedJobIds: ReadonlySet<string>;
	readonly occupiedSourceMessageIds: ReadonlySet<string>;
	readonly sites: ReadonlyMap<string, LocationLike>;
	readonly repeatedJobIds: ReadonlySet<string>;
	readonly repeatedSourceMessageIds: ReadonlySet<string>;
}

/** Which job ids and source-message ids this call claims more than once. Data, not a decision. */
export function repeatedWithinBatch<T extends AssignmentCreateInput>(
	inputs: readonly T[]
): { readonly jobIds: ReadonlySet<string>; readonly sourceMessageIds: ReadonlySet<string> } {
	const count = (values: ReadonlyArray<string>): ReadonlySet<string> => {
		const seen = new Set<string>();
		const repeated = new Set<string>();
		for (const value of values) {
			if (seen.has(value)) repeated.add(value);
			seen.add(value);
		}
		return repeated;
	};
	return {
		jobIds: count(inputs.flatMap((input) => (input.job_id ? [input.job_id] : []))),
		sourceMessageIds: count(
			inputs.flatMap((input) => (input.source_message_id ? [input.source_message_id] : []))
		)
	};
}

/**
 * One dispatch, decided.
 *
 * This is the whole of the create rule, and it is written once. It used to be written twice — a
 * `batchHandler` beside the per-record `handler`, only the second of which the runtime ever called —
 * and the two had already drifted: only the batch copy refused a job claimed twice inside one call.
 *
 * That refusal is kept here, and it now refuses *every* row claiming a repeated job rather than
 * sparing the first. The outcome is the same either way, because a batch is one transaction and a
 * refusal fails all of it; the difference is only which row the message names.
 */
export function assignmentCreateValues<T extends AssignmentCreateInput>(
	input: T,
	lookup: AssignmentCreateBatchLookup,
	now: () => Date = () => new Date()
): T & { readonly dispatched_at: Date | string; readonly status: AssignmentStatus } {
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
	if (lookup.occupiedJobIds.has(jobId) || lookup.repeatedJobIds.has(jobId)) {
		throw new Error('This job already has an assignment.');
	}
	const sourceMessageId = input.source_message_id;
	if (
		sourceMessageId &&
		(lookup.occupiedSourceMessageIds.has(sourceMessageId) ||
			lookup.repeatedSourceMessageIds.has(sourceMessageId))
	) {
		throw new Error('A job assignment with this source_message_id already exists.');
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
}

/**
 * `Hooks` with what `prepare` returns filled in.
 *
 * The generated `Hooks` alias fixes that parameter at `void`, so a collection that prepares anything
 * has to name the type itself. Once `bolt sync` emits `Hooks<Prepared = void>` this becomes
 * `satisfies Hooks<AssignmentCreateBatchLookup>`.
 */
type JobAssignmentHooks = CollectionHooks<
	WorkspaceSchema,
	'job_assignments',
	AssignmentCreateBatchLookup
>;

export default {
	create: {
		prepare: ({ inputs, api }) =>
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
				const repeated = repeatedWithinBatch(inputs);
				return {
					jobs: new Map(jobs.map((job) => [job.norbital_id, job])),
					contractorIds: new Set(contractors.map((contractor) => contractor.norbital_id)),
					occupiedJobIds: new Set(occupiedJobs.map((assignment) => assignment.job_id)),
					occupiedSourceMessageIds: new Set(
						occupiedSources.flatMap((assignment) =>
							assignment.source_message_id ? [assignment.source_message_id] : []
						)
					),
					sites: new Map(sites.map((site) => [site.norbital_id, site.location])),
					repeatedJobIds: repeated.jobIds,
					repeatedSourceMessageIds: repeated.sourceMessageIds
				};
			}),
		perRecord: {
			before: {
				description:
					'Dispatches a contractor to an unassigned job, stamps the dispatch time, and marks the assignment suspect when the reported location sits outside the site tolerance.',
				handler: ({ input, prepared }) => assignmentCreateValues(input, prepared)
			},
			after: {
				description:
					'Moves a job from unassigned to assigned as soon as its first contractor is dispatched.',
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
		}
	},
	update: {
		perRecord: {
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
	}
} satisfies JobAssignmentHooks;

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
