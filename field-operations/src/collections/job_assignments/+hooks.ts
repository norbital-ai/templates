import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import { currentDate } from '../../lib/clock.js';
import type { Hooks } from './$types.js';

const assignmentIdentitySchema = Schema.Struct({
	job_id: Schema.optional(Schema.NullOr(Schema.String)),
	assignee_user_id: Schema.optional(Schema.NullOr(Schema.String))
});

type AssignmentIdentity = Schema.Schema.Type<typeof assignmentIdentitySchema>;

const assignmentStatusSchema = Schema.Literals(['unassigned', 'assigned', 'completed']);

type AssignmentStatus = Schema.Schema.Type<typeof assignmentStatusSchema>;

const ASSIGNMENT_BATCH_LIMIT = 5_000;

function requireId(value: string | null | undefined, message: string): string {
	if (!value) refuse(message);
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
			refuse(`Unsupported assignment status: ${value}.`);
	}
}

export function assertAssignmentIdentityUnchanged(
	input: AssignmentIdentity,
	existing: Required<AssignmentIdentity>
): void {
	if (input.job_id != null && input.job_id !== existing.job_id) {
		refuse('A dispatched assignment cannot be moved to another job.');
	}
	if (input.assignee_user_id != null && input.assignee_user_id !== existing.assignee_user_id) {
		refuse('A dispatched assignment cannot be moved to another assignee.');
	}
}

const assignmentCreateInputSchema = Schema.Struct({
	job_id: Schema.optional(Schema.NullOr(Schema.String)),
	assignee_user_id: Schema.optional(Schema.NullOr(Schema.String)),
	source_message_id: Schema.optional(Schema.NullOr(Schema.String)),
	dispatched_at: Schema.optional(Schema.NullOr(Schema.String)),
	status: Schema.optional(Schema.NullOr(Schema.String))
});

export type AssignmentCreateInput = Schema.Schema.Type<typeof assignmentCreateInputSchema>;

/**
 * Everything one dispatch needs to know about the world, read once for the whole batch.
 *
 * The rule below is written for one assignment and asks three workspace-data questions about it:
 * does the job exist, is the job already taken, and is the source message already used. Asked per
 * record that is three round trips a row; asked here it is three for the batch.
 *
 * Assignee existence is deliberately not a fourth authored query. `assignee_user_id` has a declared
 * relationship to Bolt's private user table, so the database foreign key owns that integrity check.
 * Authored hooks neither receive nor reconstruct a query handle for private identity data.
 *
 * `repeatedJobIds` and `repeatedSourceMessageIds` are the one thing a per-record hook genuinely
 * cannot see: two rows in the same call claiming the same job. They are derived from the inputs, not
 * read — `prepare` still decides nothing — and the refusal itself is written once, below.
 */
export interface AssignmentCreateBatchLookup {
	readonly jobs: ReadonlyMap<string, { readonly site_id: string | null; readonly title: string }>;
	readonly occupiedJobIds: ReadonlySet<string>;
	readonly occupiedSourceMessageIds: ReadonlySet<string>;
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
 * This is the whole of the create rule, and it is written once, per record — the per-record handler
 * is the only rule the runtime runs, so every row in a batch is decided by exactly this code, and a
 * job claimed twice inside one call is refused on every row that claims it.
 *
 * The refusal is kept here, and it refuses *every* row claiming a repeated job rather than sparing
 * the first. The outcome is the same either way, because a batch is one transaction and a refusal
 * fails all of it; the difference is only which row the message names.
 */
export function assignmentCreateValues<T extends AssignmentCreateInput>(
	input: T,
	lookup: AssignmentCreateBatchLookup,
	now: () => string = () => new Date().toISOString()
): T & {
	readonly dispatched_at: string;
	readonly status: AssignmentStatus;
	readonly search_text: string;
} {
	const jobId = requireId(input.job_id, 'Job assignment must reference a job.');
	requireId(
		input.assignee_user_id,
		'Job assignment must reference the person it is dispatched to.'
	);
	const job = lookup.jobs.get(jobId);
	if (!job) refuse('Referenced job does not exist.');
	if (lookup.occupiedJobIds.has(jobId) || lookup.repeatedJobIds.has(jobId)) {
		refuse('This job already has an assignment.');
	}
	const sourceMessageId = input.source_message_id;
	if (
		sourceMessageId &&
		(lookup.occupiedSourceMessageIds.has(sourceMessageId) ||
			lookup.repeatedSourceMessageIds.has(sourceMessageId))
	) {
		refuse('A job assignment with this source_message_id already exists.');
	}

	return {
		...input,
		dispatched_at: input.dispatched_at ?? now(),
		status: assignmentStatus(input.status),
		// Derived last so a caller cannot forge or stale the board's search label.
		search_text: job.title
	};
}

/**
 * `Hooks` with what `prepare` returns filled in.
 *
 * The generated `Hooks` alias carries the `Prepared` parameter, so a collection that prepares
 * anything names it at the `satisfies` below.
 */
export default {
	mutate: {
		prepare: ({ inputs, api }) => {
			const jobIds = [...new Set(inputs.flatMap((input) => (input.job_id ? [input.job_id] : [])))];
			const sourceMessageIds = [
				...new Set(
					inputs.flatMap((input) => (input.source_message_id ? [input.source_message_id] : []))
				)
			];
			const repeated = repeatedWithinBatch(inputs);
			return Effect.map(
				Effect.all(
					[
						jobIds.length
							? api.db.jobs.findMany({
									where: { id: { in: jobIds } },
									columns: { id: true, site_id: true, title: true },
									limit: ASSIGNMENT_BATCH_LIMIT
								})
							: Effect.succeed([]),
						jobIds.length
							? api.db.job_assignments.findMany({
									where: { job_id: { in: jobIds } },
									columns: { job_id: true },
									limit: ASSIGNMENT_BATCH_LIMIT
								})
							: Effect.succeed([]),
						sourceMessageIds.length
							? api.db.job_assignments.findMany({
									where: { source_message_id: { in: sourceMessageIds } },
									columns: { source_message_id: true },
									limit: ASSIGNMENT_BATCH_LIMIT
								})
							: Effect.succeed([])
					],
					{ concurrency: 'unbounded' }
				),
				([jobs, occupiedJobs, occupiedSources]) => ({
					jobs: new Map(jobs.map((job) => [job.id, job])),
					occupiedJobIds: new Set(occupiedJobs.map((assignment) => assignment.job_id)),
					occupiedSourceMessageIds: new Set(
						occupiedSources.flatMap((assignment) =>
							assignment.source_message_id ? [assignment.source_message_id] : []
						)
					),
					repeatedJobIds: repeated.jobIds,
					repeatedSourceMessageIds: repeated.sourceMessageIds
				})
			);
		},
		perRecord: {
			before: {
				description:
					'Dispatches a person to an unassigned job and stamps the dispatch time, then holds the assignment on its original job and assignee, stamps completion, and keeps progression independent of evidence or suspicion judgements. Reported location remains an evidence fact and never creates a suspicion judgement.',
				handler: ({ input, existing, prepared }) => {
					if (existing === undefined) return assignmentCreateValues(input, prepared);
					// `search_text` is hook-owned. Existing assignments keep their derived value on every
					// ordinary progress edit, even if a client attempts to supply a replacement.
					const { search_text: _ignoredSearchText, ...writableInput } = input;
					return Effect.map(currentDate, (now) => {
						assertAssignmentIdentityUnchanged(writableInput, existing);
						if (writableInput.status === undefined) return writableInput;
						return {
							...writableInput,
							...assignmentLanePersistValues(writableInput, now.toISOString())
						};
					});
				}
			},
			after: {
				description:
					'Moves a job from unassigned to assigned as soon as its first assignee is dispatched, and thereafter carries assignment progress onto its job. Evidence and suspicion are reviewed only by the dedicated automation.',
				handler: ({ previous, changes, record, api }) => {
					// `previous` is undefined on a create: the first dispatch promotes the job, while a
					// later edit maps whatever the assignment moved to onto the job.
					if (previous === undefined)
						return Effect.gen(function* () {
							const job = yield* api.db.jobs.findFirst({ where: { id: { eq: record.job_id } } });
							if (job?.status === 'unassigned') {
								yield* api.db.jobs.mutate({ id: record.job_id, status: 'assigned' });
							}
						});
					if (!Object.hasOwn(changes, 'status')) return Effect.void;
					const status = record.status;
					if (status == null) return Effect.void;
					const jobStatus = mapAssignmentStatusToJobStatus(
						status as 'unassigned' | 'assigned' | 'completed'
					);
					return api.db.jobs.mutate({ id: record.job_id, status: jobStatus });
				}
			}
		}
	}
} satisfies Hooks<AssignmentCreateBatchLookup>;

/**
 * A job's state, from the state of the assignment on it.
 *
 * A job still distinguishes `in_progress`, and an assignment no longer does — so nothing maps onto
 * it any more. That is deliberate rather than an oversight to tidy up later: `in_progress` on a job
 * is a claim about work happening right now, and nothing in this workspace ever observed that. It
 * was only ever set because an assignment could be spelled `in_progress`, which meant the same as
 * `dispatched` and was chosen by whichever importer wrote the row.
 */
/** Kanban and form writes share this persist shape so a completed drop survives reload. */
export function assignmentLanePersistValues(
	input: { readonly status?: string | null; readonly completed_at?: string | null },
	now: string
): { readonly status: AssignmentStatus; readonly completed_at?: string } {
	const status = assignmentStatus(input.status);
	return {
		status,
		...(status === 'completed' && input.completed_at == null ? { completed_at: now } : {})
	};
}

export function mapAssignmentStatusToJobStatus(
	status: AssignmentStatus
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
