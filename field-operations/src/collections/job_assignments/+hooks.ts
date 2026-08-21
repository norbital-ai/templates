import type { CollectionHooks } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';
import { usersById } from '../../lib/identity-directory.js';

type AssignmentIdentity = {
	job_id?: string | null;
	assignee_user_id?: string | null;
};

type AssignmentStatus = 'unassigned' | 'assigned' | 'completed';
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

/**
 * The three states, and the two spellings that used to mean one of them.
 *
 * `dispatched` and `in_progress` both meant somebody holds the work and nothing ever distinguished
 * them, so an import carrying either lands on `assigned`. `suspect` is refused rather than mapped:
 * it was never a stage of the work, and silently turning it into one would put a finding back into
 * the column this change exists to take it out of. A row carrying it belongs in
 * `suspicious_activity_logs`, and the caller has to say so.
 */
function assignmentStatus(value: string | null | undefined): AssignmentStatus {
	switch (value) {
		case 'unassigned':
		case 'assigned':
		case 'completed':
			return value;
		case 'dispatched':
		case 'in_progress':
			return 'assigned';
		case undefined:
		case null:
			return 'assigned';
		default:
			throw new Error(`Unsupported assignment status: ${value}.`);
	}
}

/**
 * Whether where the work was reported from warrants a suspicion.
 *
 * This replaces `applySuspectOneWay`, which forced `status: 'suspect'` and was one-way — a job that
 * drifted once could never be reported as assigned or completed again, because the finding had
 * consumed the column that says where the work got to. It answers a question now instead of
 * overwriting a state: the caller raises a `suspicious_activity_logs` row and leaves `status` alone.
 *
 * Distance only. Absent coordinates are not suspicious — a messaging service that strips metadata is
 * the ordinary case, and treating silence as evidence is how a workspace fills with findings nobody
 * can act on.
 */
export function locationIsSuspicious(
	assignmentLocation: LocationLike,
	siteLocation: LocationLike
): boolean {
	return exceedsSiteTolerance(coordinatesOf(assignmentLocation), coordinatesOf(siteLocation));
}

export function assertAssignmentIdentityUnchanged(
	input: AssignmentIdentity,
	existing: Required<AssignmentIdentity>
): void {
	if (input.job_id != null && input.job_id !== existing.job_id) {
		throw new Error('A dispatched assignment cannot be moved to another job.');
	}
	if (input.assignee_user_id != null && input.assignee_user_id !== existing.assignee_user_id) {
		throw new Error('A dispatched assignment cannot be moved to another assignee.');
	}
}

export interface AssignmentCreateInput {
	readonly job_id?: string | null;
	readonly assignee_user_id?: string | null;
	readonly source_message_id?: string | null;
	readonly dispatched_at?: Date | string | null;
	readonly status?: string | null;
	readonly location?: LocationLike;
}

/**
 * Everything one dispatch needs to know about the world, read once for the whole batch.
 *
 * The rule below is written for one assignment and asks five questions about it: does the job exist,
 * is the assignee a person this workspace knows, is the job already taken, is the source message
 * already used, and where is the site. Asked per record that is five round trips a row; asked here it
 * is five for the batch.
 *
 * `repeatedJobIds` and `repeatedSourceMessageIds` are the one thing a per-record hook genuinely
 * cannot see: two rows in the same call claiming the same job. They are derived from the inputs, not
 * read — `prepare` still decides nothing — and the refusal itself is written once, below.
 */
export interface AssignmentCreateBatchLookup {
	readonly jobs: ReadonlyMap<string, { readonly site_id: string | null }>;
	/**
	 * The assignee ids that name a real person.
	 *
	 * Read from `bolt_auth_user` rather than from a workspace collection: an assignee *is* a user, and
	 * the profile row that used to stand between the two is gone. The database enforces the same thing
	 * through the foreign key; this exists so the refusal names the problem instead of quoting a
	 * constraint.
	 */
	readonly assigneeUserIds: ReadonlySet<string>;
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
	const assigneeUserId = requireId(
		input.assignee_user_id,
		'Job assignment must reference the person it is dispatched to.'
	);
	const job = lookup.jobs.get(jobId);
	if (!job) throw new Error('Referenced job does not exist.');
	if (!lookup.assigneeUserIds.has(assigneeUserId)) {
		throw new Error('Referenced assignee is not a user of this workspace.');
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
		status: assignmentStatus(input.status),
		// Recorded on the prepared row rather than acted on here: this function returns values, and
		// raising a log is a write. The caller that performs the insert reads it.
		...(locationIsSuspicious(input.location, siteLocation) ? { bolt_location_suspicion: true } : {})
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
				const assigneeUserIds = [
					...new Set(
						inputs.flatMap((input) => (input.assignee_user_id ? [input.assignee_user_id] : []))
					)
				];
				const sourceMessageIds = [
					...new Set(
						inputs.flatMap((input) => (input.source_message_id ? [input.source_message_id] : []))
					)
				];
				const [jobs, assignees, occupiedJobs, occupiedSources] = yield* Effect.all(
					[
						jobIds.length
							? api.db.query.jobs.findMany({
									where: { norbital_id: { in: jobIds } },
									columns: { norbital_id: true, site_id: true },
									limit: ASSIGNMENT_BATCH_LIMIT
								})
							: Effect.succeed([]),
						usersById(api, assigneeUserIds),
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
					assigneeUserIds: new Set(assignees.keys()),
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
					'Dispatches a person to an unassigned job, stamps the dispatch time, and marks the assignment suspect when the reported location sits outside the site tolerance.',
				handler: ({ input, prepared }) => assignmentCreateValues(input, prepared)
			},
			after: {
				description:
					'Moves a job from unassigned to assigned as soon as its first assignee is dispatched.',
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
					'Holds an assignment on its original job and assignee, stamps completion, and preserves a prior judgement or a contradictory reported assignment location.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						assertAssignmentIdentityUnchanged(input, existing);
						const withCompletion =
							input.status === 'completed' && input.completed_at == null
								? { ...input, completed_at: new Date() }
								: input;
						const jobId = input.job_id ?? existing.job_id;
						const location = input.location ?? existing.location;
						const baseStatus = assignmentStatus(input.status ?? existing.status);
						if (location == null || jobId == null) {
							return {
								...withCompletion,
								status: baseStatus
							};
						}

						const job = yield* api.db.query.jobs.findFirst({
							where: { norbital_id: { eq: jobId } }
						});
						if (job == null) {
							return {
								...withCompletion,
								status: baseStatus
							};
						}

						const site = yield* api.db.query.sites.findFirst({
							where: { norbital_id: { eq: job.site_id } }
						});
						if (site?.location == null) {
							return {
								...withCompletion,
								status: baseStatus
							};
						}

						// The status is what the caller asked for. Whether the location warrants a suspicion is
						// a separate answer, and `after` raises it — a `before` hook returns the row's values
						// and an extra key it invented would be refused as an unknown column, so a finding
						// cannot ride out on the record it is about.
						return { ...withCompletion, status: baseStatus };
					})
			},
			after: {
				description:
					'Carries assignment progress onto its job, and raises a suspicion log when the reported location is too far from the assigned site.',
				handler: ({ record, api }) =>
					Effect.gen(function* () {
						const status = record.status;
						if (status == null) return;
						/**
						 * A location that does not match, recorded as a finding beside the work.
						 *
						 * This used to force `status: 'suspect'`, which is why the branch above it existed —
						 * having overwritten the state, the hook then had to reason about not rewinding job
						 * progress it had just erased. With the finding in its own collection, progression is
						 * one rule for every assignment and there is no overlay to special-case.
						 */
						const site = record.job_id
							? yield* api.db.query.jobs
									.findFirst({ where: { norbital_id: { eq: record.job_id } } })
									.pipe(
										Effect.flatMap((job) =>
											job?.site_id == null
												? Effect.succeed(null)
												: api.db.query.sites.findFirst({
														where: { norbital_id: { eq: job.site_id } }
													})
										)
									)
							: null;
						if (site != null && locationIsSuspicious(record.location, site.location)) {
							const open = yield* api.db.query.suspicious_activity_logs.findMany({
								where: {
									job_assignment_id: { eq: record.norbital_id },
									resolved_at: { isNull: true }
								},
								limit: 1
							});
							// One open log per assignment for this reason. An update that runs again must not
							// stack a second identical finding on top of one nobody has answered yet.
							if (open.length === 0) {
								yield* api.db.suspicious_activity_logs.create({
									job_assignment_id: record.norbital_id,
									reason:
										'The location reported with this work is further from the assigned site than the tolerance allows.'
								});
							}
						}
						const jobStatus = mapAssignmentStatusToJobStatus(
							status as 'unassigned' | 'assigned' | 'completed'
						);
						yield* api.db.jobs.mutate([{ norbital_id: record.job_id, status: jobStatus }]);
					})
			}
		}
	}
} satisfies JobAssignmentHooks;

/**
 * A job's state, from the state of the assignment on it.
 *
 * A job still distinguishes `in_progress`, and an assignment no longer does — so nothing maps onto
 * it any more. That is deliberate rather than an oversight to tidy up later: `in_progress` on a job
 * is a claim about work happening right now, and nothing in this workspace ever observed that. It
 * was only ever set because an assignment could be spelled `in_progress`, which meant the same as
 * `dispatched` and was chosen by whichever importer wrote the row.
 */
export function mapAssignmentStatusToJobStatus(
	status: 'unassigned' | 'assigned' | 'completed'
): 'assigned' | 'in_progress' | 'completed' {
	switch (status) {
		case 'completed':
			return 'completed';
		case 'unassigned':
		case 'assigned':
			return 'assigned';
		default: {
			const _exhaustive: never = status;
			return _exhaustive;
		}
	}
}
