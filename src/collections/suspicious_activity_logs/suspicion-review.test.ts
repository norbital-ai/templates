import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Effect, Schema } from 'effect';
import { hexToBinaryEmbedding } from '@norbital-ai/bolt/authoring';
import { decode as decodeJpeg } from 'jpeg-js';
import suspicionReviewAutomation, {
	SUSPICION_REVIEW_CONCURRENCY,
	SuspicionReviewIncompleteError
} from '../../automations/+review_job_assignment_suspicion.js';
import {
	ASSIGNMENT_PAGE_SIZE,
	CROSS_ASSIGNMENT_MAX_HAMMING,
	MAX_INFERENCE_CONTEXT_CHARS,
	MAX_INFERENCE_EVIDENCE_ID_CHARS,
	MAX_INFERENCE_IMAGE_BYTES,
	MAX_INFERENCE_IMAGES,
	MAX_INFERENCE_REASON_CHARS,
	buildSuspicionInferenceContext,
	buildSuspicionReviewBasis,
	loadCrossAssignmentCandidates,
	loadUncheckedAssignments,
	reviewSourceKey,
	selectSuspicionInferencePhotos,
	shouldCreateSuspicionLog,
	shouldReviewAssignment,
	suspicionInferenceSchema,
	suspicionPrompt,
	suspicionReviewHash,
	validDecisionEvidenceId,
	type SuspicionReviewFacts
} from '../../automations/suspicion-review.js';
import { assertCommunicationUnchanged } from '../communication_logs/+hooks.js';
import { hashPdq, pdqHashToHex } from '../photo_evidence/pdq.js';
import {
	assertJudgementReferences,
	assertOpenJudgement,
	assertResolutionTransition,
	normalizeOpenJudgement
} from './+hooks.js';

type Assignment = SuspicionReviewFacts['assignment'];

type RunResult = {
	readonly reviewed_at: string;
	readonly assignment_count: number;
	readonly inference_count: number;
	readonly failure_count: number;
	readonly failure_details: ReadonlyArray<{
		readonly assignment_id: string;
		readonly stage: string;
	}>;
	readonly failure_details_truncated: boolean;
	readonly counts: Readonly<Record<string, number>>;
};

type ExistingReview = {
	readonly id: string;
	readonly basis: string;
	readonly suspicious: boolean;
	readonly reason: string;
	readonly evidence_id: string | null;
};

function assignment(id: string, status = 'assigned'): Assignment {
	return {
		id,
		job_id: `job-${id}`,
		status,
		summary: null,
		location: null,
		suspicion_checked_at: null
	};
}

function assignmentIdFromPrompt(prompt: string): string {
	const marker = '"assignment":{"id":"';
	const start = prompt.indexOf(marker);
	assert.notEqual(start, -1);
	const valueStart = start + marker.length;
	const end = prompt.indexOf('"', valueStart);
	assert.notEqual(end, -1);
	return prompt.slice(valueStart, end);
}

function automationHarness(options: {
	readonly assignments: ReadonlyArray<Assignment>;
	readonly decisions?: Readonly<Record<string, { suspicious: boolean; reason: string }>>;
	readonly factLoadFailures?: ReadonlySet<string>;
	readonly inferenceFailures?: ReadonlySet<string>;
	readonly reviewPersistenceFailures?: ReadonlySet<string>;
	readonly openSuspicionIds?: Readonly<Record<string, string>>;
	readonly existingReviews?: Readonly<Record<string, ExistingReview>>;
	readonly stallAssignmentPagination?: boolean;
	readonly inferenceDelayMillis?: number;
}) {
	const inferenceCounts = new Map<string, number>();
	let activeInferences = 0;
	let maxInferenceConcurrency = 0;
	const reviewCreateAttempts: Array<string> = [];
	const logCreates: Array<string> = [];
	const updates: Array<string> = [];
	const assignmentPageAfterIds: Array<string | undefined> = [];
	const existingReviews = { ...options.existingReviews };
	const logsByReview: Record<string, { readonly id: string } | undefined> = {};
	const api = {
		progress: () => Effect.void,
		infer: (input: { readonly prompt: string }) =>
			Effect.gen(function* () {
				const assignmentId = assignmentIdFromPrompt(input.prompt);
				inferenceCounts.set(assignmentId, (inferenceCounts.get(assignmentId) ?? 0) + 1);
				activeInferences += 1;
				maxInferenceConcurrency = Math.max(maxInferenceConcurrency, activeInferences);
				if ((options.inferenceDelayMillis ?? 0) > 0)
					yield* Effect.sleep(options.inferenceDelayMillis ?? 0);
				if (options.inferenceFailures?.has(assignmentId) === true) {
					return yield* Effect.fail(new Error(`Inference failed for ${assignmentId}`));
				}
				const decision = options.decisions?.[assignmentId] ?? {
					suspicious: false,
					reason: 'The evidence does not justify a suspicion.'
				};
				return { ...decision, evidence_id: null };
			}).pipe(Effect.ensuring(Effect.sync(() => (activeInferences -= 1)))),
		/**
		 * The database double, in the shape the authored api now has.
		 *
		 * There is no `query` half and no `create`/`update` half: a collection carries its reads and
		 * its one declarative `mutate`. `mutate` answers with nothing, so the rows it accepts have to
		 * become visible to the `findFirst` that reads them back — which is exactly what the real
		 * runtime does, and what a double that returned the written row would have let the code under
		 * test skip.
		 */
		db: {
			job_assignments: {
				findMany: (input: {
					readonly where?: {
						readonly id?: { readonly eq?: string; readonly gt?: string };
					};
					readonly limit?: number;
				}) => {
					const targeted = input.where?.id?.eq;
					if (targeted != null) {
						return Effect.succeed(options.assignments.filter(({ id }) => id === targeted));
					}
					const afterId = input.where?.id?.gt;
					assignmentPageAfterIds.push(afterId);
					const eligible = options.assignments
						.filter(
							({ id }) =>
								options.stallAssignmentPagination === true || afterId === undefined || id > afterId
						)
						.sort((left, right) => left.id.localeCompare(right.id));
					return Effect.succeed(eligible.slice(0, input.limit ?? ASSIGNMENT_PAGE_SIZE));
				},
				mutate: (values: { readonly id: string }) => {
					updates.push(values.id);
					return Effect.void;
				}
			},
			jobs: {
				findFirst: (input: { readonly where: { readonly id: { readonly eq: string } } }) => {
					const assignmentId = input.where.id.eq.slice('job-'.length);
					if (options.factLoadFailures?.has(assignmentId) === true) {
						return Effect.fail(new Error(`Facts failed for ${assignmentId}`));
					}
					return Effect.succeed({
						id: input.where.id.eq,
						site_id: `site-${input.where.id.eq}`,
						title: 'Field work',
						nature: null,
						scheduled_for: null,
						description: 'Complete the assigned field work.'
					});
				}
			},
			sites: {
				findFirst: () =>
					Effect.succeed({
						id: 'site-a',
						name: 'Site A',
						location: null,
						house_type: null
					})
			},
			variation_requests: { findMany: () => Effect.succeed([]) },
			photo_evidence: {
				findMany: () => Effect.succeed([]),
				findNearest: () => Effect.succeed([])
			},
			communication_logs: { findMany: () => Effect.succeed([]) },
			suspicion_reviews: {
				findFirst: (input: {
					readonly where: { readonly job_assignment_id: { readonly eq: string } };
				}) => Effect.succeed(existingReviews[input.where.job_assignment_id.eq]),
				mutate: (values: {
					readonly job_assignment_id: string;
					readonly basis: string;
					readonly suspicious: boolean;
					readonly reason: string;
					readonly evidence_id: string | null;
				}) => {
					reviewCreateAttempts.push(values.job_assignment_id);
					if (options.reviewPersistenceFailures?.has(values.job_assignment_id) === true) {
						return Effect.fail(new Error('review persistence failed'));
					}
					if (existingReviews[values.job_assignment_id] != null) {
						return Effect.fail(new Error('duplicate review basis'));
					}
					existingReviews[values.job_assignment_id] = {
						...values,
						id: `review-${values.job_assignment_id}`
					};
					return Effect.void;
				}
			},
			suspicious_activity_logs: {
				findFirst: (input: {
					readonly where: {
						readonly job_assignment_id?: { readonly eq: string };
						readonly review_id?: { readonly eq: string };
					};
				}) => {
					const reviewId = input.where.review_id?.eq;
					if (reviewId != null) return Effect.succeed(logsByReview[reviewId]);
					const assignmentId = input.where.job_assignment_id?.eq;
					const id = assignmentId == null ? undefined : options.openSuspicionIds?.[assignmentId];
					return Effect.succeed(id == null ? undefined : { id });
				},
				mutate: (values: { readonly job_assignment_id: string; readonly review_id: string }) => {
					logCreates.push(values.job_assignment_id);
					logsByReview[values.review_id] = { id: `log-${values.job_assignment_id}` };
					return Effect.void;
				}
			}
		}
	};
	return {
		api,
		assignmentPageAfterIds,
		inferenceCounts,
		reviewCreateAttempts,
		logCreates,
		updates,
		maxInferenceConcurrency: () => maxInferenceConcurrency
	};
}

async function runAutomation(api: unknown): Promise<RunResult> {
	const effect = suspicionReviewAutomation.spec.handler(
		api as never,
		{
			args: {},
			scope: {}
		} as never
	);
	try {
		return await Effect.runPromise(effect as Effect.Effect<RunResult, unknown, never>);
	} catch (error) {
		if (error instanceof SuspicionReviewIncompleteError) return error.outcome;
		throw error;
	}
}

function facts(): SuspicionReviewFacts {
	return {
		assignment: {
			id: 'assignment-a',
			job_id: 'job-a',
			status: 'assigned',
			summary: 'Survey and installation',
			location: null
		},
		job: {
			id: 'job-a',
			title: 'Install handrails',
			nature: 'installation',
			scheduled_for: '2026-08-24',
			description: 'Install the approved handrail at the assigned unit.'
		},
		site: {
			id: 'site-a',
			name: 'Pine Grove',
			location: null,
			house_type: 'condo'
		},
		photos: [
			{
				id: 'photo-b',
				photo: {
					storage_key: 'photos/b.jpg',
					file_name: 'b.jpg',
					file_size: 2,
					mime_type: 'image/jpeg'
				},
				sha256: 'bbb',
				flags: ['visual_duplicate', 'missing_geolocation'],
				matched_evidence_ids: ['photo-z', 'photo-y'],
				created_at: '2026-08-24T01:00:00.000Z'
			},
			{
				id: 'photo-a',
				photo: {
					storage_key: 'photos/a.jpg',
					file_name: 'a.jpg',
					file_size: 1,
					mime_type: 'image/jpeg'
				},
				sha256: 'aaa',
				flags: [],
				matched_evidence_ids: [],
				created_at: '2026-08-24T00:00:00.000Z'
			}
		],
		candidates: [],
		communications: [
			{
				source_message_id: 'message-b',
				sender: 'contractor-a',
				sent_at: '2026-08-24T01:00:00.000Z',
				message: 'Second update'
			},
			{
				source_message_id: 'message-a',
				sender: 'contractor-a',
				sent_at: '2026-08-24T00:00:00.000Z',
				message: 'First update'
			}
		]
	};
}

test('reviews every unchecked assignment, including completed rows', () => {
	assert.equal(shouldReviewAssignment('assigned'), true);
	assert.equal(shouldReviewAssignment('unassigned'), true);
	assert.equal(shouldReviewAssignment(null), true);
	assert.equal(shouldReviewAssignment('completed'), true);
	assert.equal(shouldReviewAssignment('assigned', '2026-08-24T01:00:00.000Z'), false);
});

test('materialises every unchecked assignment across pages beyond 500', async () => {
	const assignments = Array.from({ length: ASSIGNMENT_PAGE_SIZE + 1 }, (_, index) =>
		assignment(
			`assignment-${String(index).padStart(4, '0')}`,
			index === 500 ? 'completed' : 'assigned'
		)
	);
	const harness = automationHarness({ assignments });
	const selected = await Effect.runPromise(loadUncheckedAssignments(harness.api as never));

	assert.equal(selected.length, ASSIGNMENT_PAGE_SIZE + 1);
	assert.equal(selected.at(-1)?.status, 'completed');
	assert.deepEqual(harness.assignmentPageAfterIds, [undefined, 'assignment-0499']);
});

test('fails closed when an unchecked-assignment keyset page does not advance', async () => {
	const assignments = Array.from({ length: ASSIGNMENT_PAGE_SIZE }, (_, index) =>
		assignment(`assignment-${String(index).padStart(4, '0')}`)
	);
	const harness = automationHarness({ assignments, stallAssignmentPagination: true });

	await assert.rejects(
		Effect.runPromise(loadUncheckedAssignments(harness.api as never)),
		/Unchecked assignment pagination did not advance beyond assignment-0499; received assignment-0000/
	);
});

test('infers, persists, and stamps a completed unchecked assignment', async () => {
	const completed = assignment('assignment-completed', 'completed');
	const harness = automationHarness({ assignments: [completed] });
	const result = await runAutomation(harness.api);

	assert.equal(result.assignment_count, 1);
	assert.equal(result.inference_count, 1);
	assert.equal(result.failure_count, 0);
	assert.equal(result.counts.checked, 1);
	assert.equal(result.counts.clear, 1);
	assert.equal(harness.inferenceCounts.get(completed.id), 1);
	assert.deepEqual(harness.reviewCreateAttempts, [completed.id]);
	assert.deepEqual(harness.updates, [completed.id]);
});

test('reviews assignments in a bounded parallel lane', async () => {
	const assignments = Array.from({ length: SUSPICION_REVIEW_CONCURRENCY * 2 }, (_, index) =>
		assignment(`assignment-parallel-${index}`)
	);
	const harness = automationHarness({ assignments, inferenceDelayMillis: 10 });
	const result = await runAutomation(harness.api);

	assert.equal(result.failure_count, 0);
	assert.equal(result.counts.checked, assignments.length);
	assert.equal(harness.maxInferenceConcurrency(), SUSPICION_REVIEW_CONCURRENCY);
});

test('still performs exactly one inference and persists a review when a suspicion is already open', async () => {
	const selected = assignment('assignment-open');
	const harness = automationHarness({
		assignments: [selected],
		decisions: { [selected.id]: { suspicious: true, reason: 'Visible contradiction.' } },
		openSuspicionIds: { [selected.id]: 'log-already-open' }
	});
	const result = await runAutomation(harness.api);

	assert.equal(result.assignment_count, 1);
	assert.equal(result.inference_count, 1);
	assert.equal(result.failure_count, 0);
	assert.equal(result.counts.suspicious_open_exists, 1);
	assert.equal(harness.inferenceCounts.get(selected.id), 1);
	assert.deepEqual(harness.reviewCreateAttempts, [selected.id]);
	assert.deepEqual(harness.logCreates, []);
	assert.deepEqual(harness.updates, [selected.id]);
});

test('still performs exactly one inference and stamps when the evidence basis already has a durable review', async () => {
	const selected = assignment('assignment-reviewed');
	const harness = automationHarness({
		assignments: [selected],
		decisions: { [selected.id]: { suspicious: true, reason: 'A new non-durable answer.' } },
		existingReviews: {
			[selected.id]: {
				id: 'review-existing',
				basis: '{"durable":true}',
				suspicious: false,
				reason: 'The durable review was clear.',
				evidence_id: null
			}
		}
	});
	const result = await runAutomation(harness.api);

	assert.equal(result.assignment_count, 1);
	assert.equal(result.inference_count, 1);
	assert.equal(result.failure_count, 0);
	assert.equal(result.counts.clear_existing, 1);
	assert.equal(harness.inferenceCounts.get(selected.id), 1);
	assert.deepEqual(harness.reviewCreateAttempts, [selected.id]);
	assert.deepEqual(harness.logCreates, []);
	assert.deepEqual(harness.updates, [selected.id]);
});

test('counts failed inference invocations, leaves those assignments unchecked, and continues', async () => {
	const failed = assignment('assignment-inference-failed');
	const succeeded = assignment('assignment-after-failure');
	const harness = automationHarness({
		assignments: [failed, succeeded],
		inferenceFailures: new Set([failed.id])
	});
	const result = await runAutomation(harness.api);

	assert.equal(result.assignment_count, 2);
	assert.equal(result.inference_count, 2);
	assert.equal(result.failure_count, 1);
	assert.equal(result.counts.failed, 1);
	assert.equal(result.counts.checked, 1);
	assert.deepEqual(result.failure_details, [{ assignment_id: failed.id, stage: 'inference' }]);
	assert.equal(harness.inferenceCounts.get(failed.id), 1);
	assert.equal(harness.inferenceCounts.get(succeeded.id), 1);
	assert.deepEqual(harness.updates, [succeeded.id]);
});

test('does not stamp after inference when no review can be durably persisted', async () => {
	const selected = assignment('assignment-review-failed');
	const harness = automationHarness({
		assignments: [selected],
		reviewPersistenceFailures: new Set([selected.id])
	});
	const result = await runAutomation(harness.api);

	assert.equal(result.assignment_count, 1);
	assert.equal(result.inference_count, 1);
	assert.equal(result.failure_count, 1);
	assert.deepEqual(result.failure_details, [
		{ assignment_id: selected.id, stage: 'review_persistence' }
	]);
	assert.equal(harness.inferenceCounts.get(selected.id), 1);
	assert.deepEqual(harness.updates, []);
});

test('reports a pre-inference fact-load failure without claiming an inference invocation', async () => {
	const selected = assignment('assignment-facts-failed');
	const harness = automationHarness({
		assignments: [selected],
		factLoadFailures: new Set([selected.id])
	});
	const result = await runAutomation(harness.api);

	assert.equal(result.assignment_count, 1);
	assert.equal(result.inference_count, 0);
	assert.equal(result.failure_count, 1);
	assert.deepEqual(result.failure_details, [{ assignment_id: selected.id, stage: 'fact_loading' }]);
	assert.equal(harness.inferenceCounts.has(selected.id), false);
	assert.deepEqual(harness.updates, []);
});

test('bounds failure details while retaining the complete failure count', async () => {
	const assignments = Array.from({ length: 101 }, (_, index) =>
		assignment(`assignment-facts-failed-${index}`)
	);
	const harness = automationHarness({
		assignments,
		factLoadFailures: new Set(assignments.map(({ id }) => id))
	});
	const result = await runAutomation(harness.api);

	assert.equal(result.assignment_count, 101);
	assert.equal(result.inference_count, 0);
	assert.equal(result.failure_count, 101);
	assert.equal(result.failure_details.length, 100);
	assert.equal(result.failure_details_truncated, true);
	assert.deepEqual(harness.updates, []);
});

test('bounds every free-form decision field in the provider and runtime schemas', () => {
	const jsonSchema = Schema.toJsonSchemaDocument(suspicionInferenceSchema).schema as {
		properties?: {
			reason?: { maxLength?: number };
			evidence_id?: {
				anyOf?: ReadonlyArray<{ maxLength?: number }>;
			};
		};
	};
	const decode = Schema.decodeUnknownSync(suspicionInferenceSchema);

	assert.equal(jsonSchema.properties?.reason?.maxLength, MAX_INFERENCE_REASON_CHARS);
	assert.equal(
		jsonSchema.properties?.evidence_id?.anyOf?.find((branch) => branch.maxLength != null)
			?.maxLength,
		MAX_INFERENCE_EVIDENCE_ID_CHARS
	);
	assert.doesNotThrow(() =>
		decode({
			suspicious: true,
			reason: 'x'.repeat(MAX_INFERENCE_REASON_CHARS),
			evidence_id: 'p'.repeat(MAX_INFERENCE_EVIDENCE_ID_CHARS)
		})
	);
	assert.throws(() =>
		decode({
			suspicious: true,
			reason: 'x'.repeat(MAX_INFERENCE_REASON_CHARS + 1),
			evidence_id: null
		})
	);
	assert.throws(() =>
		decode({
			suspicious: true,
			reason: 'Needs review',
			evidence_id: 'p'.repeat(MAX_INFERENCE_EVIDENCE_ID_CHARS + 1)
		})
	);
	assert.throws(() => decode({ suspicious: false, reason: '   ', evidence_id: null }));
});

test('canonicalises evidence order without turning deterministic facts into a judgement', () => {
	const original = facts();
	const reordered: SuspicionReviewFacts = {
		...original,
		photos: [...original.photos].reverse().map((photo) => ({
			...photo,
			flags: [...photo.flags].reverse(),
			matched_evidence_ids: [...photo.matched_evidence_ids].reverse()
		})),
		communications: [...original.communications].reverse()
	};
	const basis = buildSuspicionReviewBasis(original);
	assert.equal(buildSuspicionReviewBasis(reordered), basis);
	assert.equal(Object.hasOwn(JSON.parse(basis), 'suspicious'), false);
	assert.match(suspicionPrompt(original), /Missing photo geolocation is a neutral fact/);
	assert.match(
		suspicionPrompt(original),
		/Visual similarity inside one assignment is a neutral fact/
	);
	assert.match(
		suspicionPrompt(original),
		/Ignore uploader-controlled timestamp, GPS and address overlays/
	);
	assert.match(suspicionPrompt(original), /reserved review policy/);
	assert.match(
		suspicionPrompt(original),
		/State the benign interpretation and ask for confirmation/
	);
});

test('bounds inference context and chooses deterministic representative low-cost images', () => {
	const original = facts();
	const photos: SuspicionReviewFacts['photos'] = Array.from({ length: 9 }, (_, index) => ({
		...original.photos[0]!,
		id: `photo-${String(index).padStart(2, '0')}`,
		photo: {
			...original.photos[0]!.photo,
			storage_key: `photos/${index}.jpg`,
			file_name: `${index}.jpg`,
			file_size: 1024 * 1024
		},
		sha256: `sha-${index}`,
		flags: index === 4 ? ['exact_duplicate'] : ['missing_geolocation'],
		matched_evidence_ids: index === 4 ? ['photo-external'] : [],
		created_at: `2026-08-24T00:${String(index).padStart(2, '0')}:00.000Z`
	}));
	const communications: SuspicionReviewFacts['communications'] = Array.from(
		{ length: 100 },
		(_, index) => ({
			source_message_id: `message-${String(index).padStart(3, '0')}`,
			sender: 'contractor-a',
			sent_at: `2026-08-24T01:${String(index % 60).padStart(2, '0')}:00.000Z`,
			message: `${index}:${'field update '.repeat(500)}`
		})
	);
	const crowded: SuspicionReviewFacts = { ...original, photos, communications };
	const selected = selectSuspicionInferencePhotos(photos);
	const reordered = selectSuspicionInferencePhotos([...photos].reverse());
	const preferred = selectSuspicionInferencePhotos(photos, ['photo-03']);

	assert.deepEqual(
		selected.map(({ id }) => id),
		['photo-00', 'photo-04', 'photo-08']
	);
	assert.deepEqual(
		reordered.map(({ id }) => id),
		selected.map(({ id }) => id)
	);
	assert.deepEqual(
		preferred.map(({ id }) => id),
		['photo-00', 'photo-03', 'photo-04']
	);
	assert.ok(selected.length <= MAX_INFERENCE_IMAGES);
	assert.ok(
		selected.reduce((total, photo) => total + photo.photo.file_size, 0) <= MAX_INFERENCE_IMAGE_BYTES
	);
	const oversized = {
		...photos[0]!,
		photo: { ...photos[0]!.photo, file_size: MAX_INFERENCE_IMAGE_BYTES + 1 }
	};
	assert.deepEqual(selectSuspicionInferencePhotos([oversized]), []);
	assert.match(
		suspicionPrompt({ ...original, photos: [oversized] }, []),
		/No photo fit the bounded attachment budget/
	);

	const encoded = buildSuspicionInferenceContext(crowded, selected);
	assert.ok(encoded.length <= MAX_INFERENCE_CONTEXT_CHARS);
	const context = JSON.parse(encoded) as {
		photo_summary: {
			total: number;
			attached_representatives: number;
			flag_counts: Record<string, number>;
		};
		communication_summary: { total: number; included_recent: number; omitted: number };
	};
	assert.equal(context.photo_summary.total, 9);
	assert.equal(context.photo_summary.attached_representatives, 3);
	assert.equal(context.photo_summary.flag_counts.missing_geolocation, 8);
	assert.equal(context.photo_summary.flag_counts.exact_duplicate, 1);
	assert.equal(context.communication_summary.total, 100);
	assert.ok(context.communication_summary.included_recent <= 24);
	assert.equal(
		context.communication_summary.omitted,
		100 - context.communication_summary.included_recent
	);
});

test('treats identical files within one assignment as a neutral repeat, not duplicate evidence', () => {
	const hillview: SuspicionReviewFacts = {
		candidates: [],
		assignment: {
			id: '019f6f10-3000-7000-8000-000000000003',
			job_id: '019f6f10-2000-7000-8000-000000000003',
			status: 'assigned',
			summary: 'Installation — 112 Hillview Crescent',
			location: null,
			suspicion_checked_at: null
		},
		job: {
			id: '019f6f10-2000-7000-8000-000000000003',
			title: 'Installation — 112, Hillview Crescent, S669505',
			nature: 'installation',
			scheduled_for: '2026-07-03',
			description: 'Complete the assigned installation.'
		},
		site: {
			id: '019f6f10-1000-7000-8000-000000000003',
			name: '112 Hillview Crescent',
			location: null,
			house_type: 'landed'
		},
		photos: [
			{
				id: '019f6f10-5000-7000-8000-000000000011',
				photo: {
					storage_key: 'document-assets/bca-simulation/00003039-PHOTO-2026-07-03-10-59-50.jpg',
					file_name: '00003039-PHOTO-2026-07-03-10-59-50.jpg',
					file_size: 1_042_864,
					mime_type: 'image/jpeg'
				},
				sha256: 'f7469fd88deda042989a8a87ff51f69fe796a88dcf6db0b6b8d9c9f401a60844',
				flags: ['missing_geolocation'],
				matched_evidence_ids: [],
				created_at: '2026-07-03T02:59:50.000Z'
			},
			{
				id: '019f6f10-5000-7000-8000-000000000022',
				photo: {
					storage_key: 'document-assets/bca-simulation/00003060-PHOTO-2026-07-03-11-01-56.jpg',
					file_name: '00003060-PHOTO-2026-07-03-11-01-56.jpg',
					file_size: 953_878,
					mime_type: 'image/jpeg'
				},
				sha256: 'e1719c9ce6a505b20ac7c8ab5e4e3e67d8878c9db8b312ec0aaf427f942a714d',
				flags: ['missing_geolocation'],
				matched_evidence_ids: [],
				created_at: '2026-07-03T03:01:56.000Z'
			},
			{
				id: '019f6f10-5000-7000-8000-000000000059',
				photo: {
					storage_key: 'document-assets/bca-simulation/00003097-PHOTO-2026-07-03-11-02-16.jpg',
					file_name: '00003097-PHOTO-2026-07-03-11-02-16.jpg',
					file_size: 953_878,
					mime_type: 'image/jpeg'
				},
				sha256: 'e1719c9ce6a505b20ac7c8ab5e4e3e67d8878c9db8b312ec0aaf427f942a714d',
				flags: ['missing_geolocation'],
				matched_evidence_ids: [],
				created_at: '2026-07-03T03:02:16.000Z'
			}
		],
		communications: []
	};

	const selected = selectSuspicionInferencePhotos(hillview.photos);
	assert.deepEqual(
		selected.map((photo) => photo.photo.file_name),
		[
			'00003039-PHOTO-2026-07-03-10-59-50.jpg',
			'00003060-PHOTO-2026-07-03-11-01-56.jpg',
			'00003097-PHOTO-2026-07-03-11-02-16.jpg'
		]
	);

	const context = JSON.parse(buildSuspicionInferenceContext(hillview, selected)) as {
		photo_summary: {
			similarity_relationships: number;
			representative_photos: ReadonlyArray<{ readonly sha256: string }>;
		};
	};
	assert.equal(context.photo_summary.similarity_relationships, 0);
	assert.equal(
		Object.hasOwn(context.photo_summary, 'within_assignment_exact_sha_group_count'),
		false
	);
	assert.equal(
		Object.hasOwn(context.photo_summary, 'within_assignment_exact_sha_photo_count'),
		false
	);
	assert.deepEqual(
		context.photo_summary.representative_photos.map((photo) => photo.sha256),
		[
			'f7469fd88deda042989a8a87ff51f69fe796a88dcf6db0b6b8d9c9f401a60844',
			'e1719c9ce6a505b20ac7c8ab5e4e3e67d8878c9db8b312ec0aaf427f942a714d',
			'e1719c9ce6a505b20ac7c8ab5e4e3e67d8878c9db8b312ec0aaf427f942a714d'
		]
	);
	const prompt = suspicionPrompt(hillview, selected);
	assert.match(prompt, /Visual similarity inside one assignment is a neutral fact/);
	assert.match(prompt, /an identical file submitted under the same assignment is a neutral repeat/);
	assert.doesNotMatch(prompt, /duplicate-submission evidence/);
	assert.doesNotMatch(prompt, /within_assignment_exact_sha/);
});

/**
 * The real cross-assignment crop fixture, hashed by the same pdq.wasm the evidence hook ships.
 *
 * `00003592` (18 Lorong Pisang Udang) shows the same white ceiling as `00003139`/`00003140`
 * (58 Kismis Avenue) in a tighter, recompressed framing. The byte hashes differ, and the PDQ
 * bit distances (116 and 130) sit far past the strict `visual_duplicate` bar of 31 — but also
 * past every unrelated-pair floor in this corpus (88 bits), so perceptual distance alone cannot
 * nominate this pair. That limit is pinned by `pins the real Kismis-Lorong crop pair` below.
 */
const hammingHex = (left: string, right: string): number => {
	let distance = 0;
	for (let index = 0; index < left.length; index += 1) {
		let difference = parseInt(left[index]!, 16) ^ parseInt(right[index]!, 16);
		while (difference !== 0) {
			distance += difference & 1;
			difference >>= 1;
		}
	}
	return distance;
};

/** Brute-force stand-in for the HNSW `findNearest`: every corpus row within the cosine band. */
const nearestStub =
	(corpus: ReadonlyArray<Record<string, unknown>>) =>
	(input: { readonly probe: readonly number[]; readonly maxDistance: number }) =>
		Effect.succeed(
			corpus.filter((row) => {
				const embedding = row.record_embedding as readonly number[];
				let dot = 0;
				let left = 0;
				let right = 0;
				for (let index = 0; index < embedding.length; index += 1) {
					const a = input.probe[index] ?? 0;
					const b = embedding[index] ?? 0;
					dot += a * b;
					left += a * a;
					right += b * b;
				}
				const magnitude = Math.sqrt(left) * Math.sqrt(right);
				return (magnitude === 0 ? 1 : 1 - dot / magnitude) <= input.maxDistance;
			})
		);

const embed = (hex: string): readonly number[] => hexToBinaryEmbedding(hex) as readonly number[];

test('retrieves in-band cross-assignment candidates and excludes same-assignment hits', async () => {
	/**
	 * Three vectors at known angles from one probe: an own-assignment twin and a foreign candidate
	 * inside the 0.5 cosine band, and a foreign photo outside it. Built by rotating in a plane so the
	 * cosine is the rotation itself rather than a number that happens to fall where the test wants.
	 */
	const base = [1, 0, ...Array.from({ length: 254 }, () => 0)];
	const atCosineDistance = (distance: number): readonly number[] => {
		const angle = Math.acos(1 - distance);
		return [Math.cos(angle), Math.sin(angle), ...Array.from({ length: 254 }, () => 0)];
	};
	const ceiling = (id: string, embedding: readonly number[], assignmentId: string) => ({
		id,
		photo: {
			storage_key: `document-assets/bca-simulation/${id}.jpg`,
			file_name: `${id}.jpg`,
			file_size: 900_000,
			mime_type: 'image/jpeg'
		},
		sha256: `${id}-sha`,
		flags: ['missing_geolocation'],
		matched_evidence_ids: [],
		created_at: null,
		job_assignment_id: assignmentId,
		variation_request_id: null,
		record_embedding: embedding
	});
	const corpus = [
		ceiling('own-twin', atCosineDistance(0.2), 'assignment-kismis'),
		ceiling('foreign-near', atCosineDistance(0.3), 'assignment-lorong'),
		ceiling('foreign-far', atCosineDistance(0.9), 'assignment-other')
	];
	const orthogonal = [0, 0, 1, ...Array.from({ length: 253 }, () => 0)];
	const probes = [
		ceiling('unrelated-own-1', orthogonal, 'assignment-kismis'),
		ceiling('unrelated-own-2', orthogonal, 'assignment-kismis'),
		ceiling('unrelated-own-3', orthogonal, 'assignment-kismis'),
		{ ...ceiling('00003140', base, 'assignment-kismis'), photo: corpus[1]!.photo },
		{ ...ceiling('00003139', base, 'assignment-kismis'), photo: corpus[0]!.photo }
	];
	const api = {
		db: {
			photo_evidence: { findNearest: nearestStub(corpus) },
			variation_requests: { findMany: () => Effect.succeed([]) }
		}
	} as never;

	const candidates = await Effect.runPromise(
		loadCrossAssignmentCandidates(api, 'assignment-kismis', probes)
	);

	assert.deepEqual(
		candidates.map((candidate) => candidate.id),
		['foreign-near']
	);
	// The rotation the candidate was built at, recomputed from the durable vectors rather than
	// taken from the retrieval — that recomputation is what the assertion is really pinning.
	assert.equal(candidates[0]?.distance, 0.3);
	assert.deepEqual(candidates[0]?.matched_photo_ids, ['00003139', '00003140']);

	const withCandidates: SuspicionReviewFacts = {
		...facts(),
		assignment: { ...facts().assignment, id: 'assignment-kismis' },
		candidates
	};
	const context = JSON.parse(buildSuspicionInferenceContext(withCandidates)) as {
		photo_summary: {
			representative_photos: ReadonlyArray<{
				readonly id: string;
				readonly attached_image_index: number;
			}>;
		};
		cross_assignment_candidates: ReadonlyArray<{
			readonly id: string;
			readonly file_name: string;
			readonly sha256: string;
			readonly distance: number;
			readonly matched_photo_ids: ReadonlyArray<string>;
			readonly attached_image_index: number | null;
		}>;
	};
	assert.deepEqual(
		context.photo_summary.representative_photos.map(({ id, attached_image_index }) => ({
			id,
			attached_image_index
		})),
		[
			{ id: 'photo-a', attached_image_index: 1 },
			{ id: 'photo-b', attached_image_index: 2 }
		]
	);
	assert.deepEqual(context.cross_assignment_candidates, [
		{
			id: 'foreign-near',
			file_name: 'foreign-near.jpg',
			sha256: 'foreign-near-sha',
			distance: 0.3,
			matched_photo_ids: ['00003139', '00003140'],
			attached_image_index: 3
		}
	]);
	const prompt = suspicionPrompt(withCandidates);
	assert.match(prompt, /cross_assignment_candidates/);
	assert.match(prompt, /attached_image_index/);
	assert.match(prompt, /same physical scene as the photo it was matched with/);
	assert.match(prompt, /different unit, storey, house or street/);
});

test('pins the real Kismis-Lorong crop pair past every perceptual band', () => {
	const kismisFirst = 'ff460171fe8e0179fe870558feaf00d07d4f02b07d5ea6a15a5ea5285a97254c';
	const kismisSecond = '3f86d0593f96c0a92f97d0683ea7c1583fafc1503caf82607d5f1228aad7156c';
	const lorongCrop = 'd24a124bf2dd1243d7583cda8a1fb9604d16edf40927edb40d27e9240da7e5bc';

	// Bit-exact PDQ distances of the real files (rank 39/62/327 in each other's cross-assignment
	// neighbour lists — behind hundreds of unrelated pairs, whose corpus floor is 88 bits).
	assert.equal(hammingHex(kismisFirst, lorongCrop), 116);
	assert.equal(hammingHex(kismisSecond, lorongCrop), 130);
	assert.ok(hammingHex(kismisFirst, lorongCrop) > CROSS_ASSIGNMENT_MAX_HAMMING);
	assert.ok(hammingHex(kismisFirst, lorongCrop) > 31);
	// Same-scene, same-assignment shots are equally far apart — repeats stay neutral regardless.
	assert.equal(hammingHex(kismisFirst, kismisSecond), 84);
});

test(
	'hashes the actual seed crop bytes into the pinned cross-assignment pair',
	{ skip: !existsSync('../../seed_bank/field-operations/assets') },
	async () => {
		const hashAsset = async (fileName: string) => {
			const bytes = readFileSync(`../../seed_bank/field-operations/assets/${fileName}`);
			const image = decodeJpeg(bytes, {
				useTArray: true,
				formatAsRGBA: false,
				maxResolutionInMP: 40,
				maxMemoryUsageInMB: 256
			});
			const { hash } = await Effect.runPromise(
				hashPdq({ data: image.data, width: image.width, height: image.height, channels: 3 })
			);
			return { width: image.width, hex: pdqHashToHex(hash) };
		};
		const kismis = await hashAsset('00003139-PHOTO-2026-07-03-11-09-32.jpg');
		const crop = await hashAsset('00003592-PHOTO-2026-07-03-12-10-12.jpg');
		assert.equal(kismis.width, 1440);
		assert.equal(crop.width, 1233);
		assert.equal(kismis.hex, 'ff460171fe8e0179fe870558feaf00d07d4f02b07d5ea6a15a5ea5285a97254c');
		assert.equal(crop.hex, 'd24a124bf2dd1243d7583cda8a1fb9604d16edf40927edb40d27e9240da7e5bc');
		const distance = hammingHex(kismis.hex, crop.hex);
		assert.ok(distance > 31, 'the crop must sit past the strict near-duplicate bar');
		assert.ok(
			distance > CROSS_ASSIGNMENT_MAX_HAMMING,
			'the real fixture is a re-photographed featureless scene that no perceptual band can nominate'
		);
	}
);

test('derives stable idempotency keys from the complete evidence basis', () => {
	const basis = buildSuspicionReviewBasis(facts());
	const hash = suspicionReviewHash(basis);
	assert.match(hash, /^[a-f0-9]{64}$/);
	assert.equal(reviewSourceKey('assignment-a', hash), `suspicion-review:assignment-a:${hash}`);
	assert.equal(
		suspicionReviewHash('abc'),
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
	);
});

test('accepts an inference evidence citation only when it names a supplied photo', () => {
	const ids = new Set(['photo-a']);
	assert.equal(
		validDecisionEvidenceId(
			{ suspicious: true, reason: 'Visible contradiction', evidence_id: 'photo-a' },
			ids
		),
		'photo-a'
	);
	assert.equal(
		validDecisionEvidenceId(
			{ suspicious: true, reason: 'Invented citation', evidence_id: 'photo-x' },
			ids
		),
		null
	);
});

test('creates a suspicion log only from an affirmative inference judgement', () => {
	assert.equal(
		shouldCreateSuspicionLog({
			suspicious: false,
			reason: 'The recorded facts do not justify a suspicion.',
			evidence_id: null
		}),
		false
	);
	assert.equal(
		shouldCreateSuspicionLog({
			suspicious: true,
			reason: 'The photographed unit visibly contradicts the assigned unit.',
			evidence_id: 'photo-a'
		}),
		true
	);
});

test('enforces immutable open facts and one atomic resolution transition', () => {
	assert.doesNotThrow(() => assertOpenJudgement({}));
	assert.throws(
		() => assertOpenJudgement({ resolution: 'Fine', resolved_at: null, resolved_by: null }),
		/must start unresolved/
	);

	const existing = {
		job_assignment_id: 'assignment-a',
		source_key: 'human:one',
		origin: 'human',
		basis: '{}',
		review_id: null,
		evidence_id: null,
		reason: 'Needs review',
		resolution: null,
		resolved_at: null,
		resolved_by: null
	};
	assert.doesNotThrow(() =>
		assertResolutionTransition(
			{
				resolution: 'Reviewed and accepted',
				resolved_at: '2026-08-24T02:00:00.000Z',
				resolved_by: 'controller-a'
			},
			existing
		)
	);
	assert.throws(
		() => assertResolutionTransition({ resolution: 'Partial' }, existing),
		/must be written together/
	);
	assert.throws(
		() => assertResolutionTransition({ reason: 'Changed reason' }, existing),
		/immutable/
	);
});

test('stamps authorized-human judgement internals without exposing them as form fields', () => {
	const normalized = normalizeOpenJudgement({
		job_assignment_id: 'assignment-a',
		reason: 'The contractor reported a conflicting unit number.',
		evidence_id: null
	});
	assert.equal(normalized.origin, 'human');
	assert.deepEqual(JSON.parse(normalized.basis), {
		kind: 'human_judgement',
		reason: 'The contractor reported a conflicting unit number.',
		evidence_id: null
	});
	assert.throws(
		() => normalizeOpenJudgement({ reason: 'AI says suspicious', origin: 'automation' }),
		/must supply its reviewed evidence basis/
	);
});

test('keeps automated review and evidence links on the judged assignment', () => {
	const prepared = {
		assignmentIds: new Set(['assignment-a']),
		assignmentByReviewId: new Map([['review-a', 'assignment-a']]),
		assignmentByEvidenceId: new Map([['photo-a', 'assignment-a']])
	};
	assert.doesNotThrow(() =>
		assertJudgementReferences(
			{
				job_assignment_id: 'assignment-a',
				origin: 'automation',
				review_id: 'review-a',
				evidence_id: 'photo-a'
			},
			prepared
		)
	);
	assert.throws(
		() =>
			assertJudgementReferences(
				{ job_assignment_id: 'assignment-a', origin: 'automation', review_id: null },
				prepared
			),
		/must reference its inference review/
	);
	assert.throws(
		() =>
			assertJudgementReferences(
				{
					job_assignment_id: 'assignment-a',
					origin: 'human',
					review_id: 'review-a'
				},
				prepared
			),
		/cannot claim an automated inference review/
	);
	assert.throws(
		() =>
			assertJudgementReferences(
				{
					job_assignment_id: 'assignment-a',
					origin: 'human',
					evidence_id: 'photo-b'
				},
				prepared
			),
		/evidence belongs to another/
	);
});

test('keeps captured contractor communications immutable', () => {
	const existing = {
		job_assignment_id: 'assignment-a',
		message: 'Arrived on site',
		sent_at: '2026-08-24T00:00:00.000Z',
		sender: 'contractor-a',
		source_message_id: 'message-a'
	};
	assert.doesNotThrow(() => assertCommunicationUnchanged({ message: existing.message }, existing));
	assert.throws(
		() => assertCommunicationUnchanged({ message: 'Edited transcript' }, existing),
		/immutable/
	);
});
