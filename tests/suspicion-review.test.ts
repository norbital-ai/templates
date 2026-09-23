import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encode as encodeJpeg } from 'jpeg-js';
import { Effect, Schema } from 'effect';
import { hexToBinaryEmbedding } from '@norbital-ai/bolt/authoring';
import { sha256Text } from '@norbital-ai/std/reckon/hash';
import suspicionReviewAutomation, {
	SUSPICION_REVIEW_CONCURRENCY,
	SuspicionReviewIncompleteError
} from '../src/automations/+review_job_assignment_suspicion.js';
import {
	ASSIGNMENT_PAGE_SIZE,
	MAX_INFERENCE_ASSET_NAME_CHARS,
	MAX_INFERENCE_CONTEXT_CHARS,
	MAX_INFERENCE_IMAGE_BYTES,
	MAX_INFERENCE_IMAGES,
	MAX_INFERENCE_REASON_CHARS,
	RECORD_EMBEDDING_MIN_DISTINCTIVENESS,
	buildSuspicionInferenceContext,
	buildSuspicionReviewBasis,
	gpsMetadataStatus,
	inferSuspicionReviewDecision,
	loadCrossAssignmentCandidates,
	loadUncheckedAssignments,
	reviewSourceKey,
	selectSuspicionInferencePhotos,
	suspicionInferenceSchema,
	suspicionPrompt,
	validDecisionEvidenceId,
	type SuspicionReviewFacts
} from '../src/automations/suspicion-review.js';
import communicationLogs from '../src/collections/communication_logs/+collection.js';
import suspiciousActivityLogs from '../src/collections/suspicious_activity_logs/+collection.js';

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
		site_id: `site-${id}`,
		title: 'Field work',
		nature: null,
		scheduled_for: null,
		description: 'Complete the assigned field work.',
		status,
		summary: null,
		location: null,
		suspicion_checked_at: null
	};
}

/** The one photo every assignment carries unless a test says otherwise: already inspected. */
const inspectedPhoto = () => ({
	id: 'photo-evidence',
	photo: {
		storage_key: 'photos/evidence.jpg',
		file_name: 'evidence.jpg',
		file_size: 1,
		mime_type: 'image/jpeg'
	},
	sha256: 'evidence-sha',
	flags: [],
	matched_evidence_ids: [],
	created_at: null,
	perceptual_embedding: [],
	record_embedding: null,
	job_assignment_id: null,
	variation_request_id: null
});

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
	readonly stampFailures?: ReadonlySet<string>;
	readonly noLongerPending?: ReadonlySet<string>;
	readonly openSuspicionIds?: Readonly<Record<string, string>>;
	readonly existingReviews?: Readonly<Record<string, ExistingReview>>;
	readonly inferenceDelayMillis?: number;
	/** Photos the assignment's own facts read returns; the default is one already-inspected photo. */
	readonly assignmentPhotos?: ReadonlyArray<Record<string, unknown>>;
	/** Photos still awaiting facts, which the review's inspection pass finds by the empty hash. */
	readonly pendingPhotos?: ReadonlyArray<Record<string, unknown>>;
	/** Embedding backfill passes the automation's first pass receives, in order. */
	readonly embeddingPasses?: ReadonlyArray<{
		readonly selected: number;
		readonly embedded: number;
		readonly failed?: number;
		readonly issues?: ReadonlyArray<string>;
	}>;
	/** Cross-assignment near-duplicate rows `findNearest` answers with; the default is none. */
	readonly nearest?: ReadonlyArray<Record<string, unknown>>;
	/** Bytes `readFileAsset` answers with; absent makes it fail like a photo whose object is gone. */
	readonly photoBytes?: Uint8Array;
	/** The mime type the stored descriptor declares; a WhatsApp document arrives as octet-stream. */
	readonly photoMimeType?: string | null;
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
	const progressUpdates: Array<{ readonly progress: number; readonly text?: string }> = [];
	const photoUpdates: Array<Record<string, unknown>> = [];
	const embedRecordsCalls: Array<string> = [];
	const assignmentPhotos = [...(options.assignmentPhotos ?? [inspectedPhoto()])];
	const pendingPhotos = [...(options.pendingPhotos ?? [])];
	const api = {
		/**
		 * The host's embedding backfill, answered pass by pass. The default is "nothing pending", so
		 * a test that does not care about the first pass still gets a truthful empty answer.
		 */
		embed: (input: { readonly collection: string }) =>
			Effect.sync(() => {
				embedRecordsCalls.push(input.collection);
				const pass = options.embeddingPasses?.[embedRecordsCalls.length - 1] ?? {
					selected: 0,
					embedded: 0,
					failed: 0
				};
				return {
					collection: input.collection,
					selected: pass.selected,
					embedded: pass.embedded,
					failed: pass.failed ?? 0,
					...(pass.issues === undefined ? {} : { issues: pass.issues })
				};
			}),
		progress: (update: { readonly progress: number; readonly text?: string }) =>
			Effect.sync(() => {
				progressUpdates.push(update);
			}),
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
				return {
					job_site_review: {
						...decision,
						evidence_asset_name: decision.suspicious ? 'evidence.jpg' : ''
					},
					similar_photo_reviews: []
				};
			}).pipe(Effect.ensuring(Effect.sync(() => (activeInferences -= 1)))),
		/**
		 * The read double, in the shape the authored api now has: reads only. Writes are under
		 * `collection` below.
		 */
		db: {
			job_assignments: {
				findFirst: (input: { readonly where: { readonly id: { readonly eq: string } } }) =>
					Effect.succeed(
						options.assignments.some(({ id }) => id === input.where.id.eq)
							? { site_id: `site-${input.where.id.eq}` }
							: undefined
					),
				findMany: (input: {
					readonly where?: {
						readonly id?: { readonly eq?: string; readonly gt?: string };
					};
					readonly limit?: number;
				}) => {
					const targeted = input.where?.id?.eq;
					if (targeted != null) {
						if (options.noLongerPending?.has(targeted)) return Effect.succeed([]);
						return Effect.succeed(options.assignments.filter(({ id }) => id === targeted));
					}
					const afterId = input.where?.id?.gt;
					assignmentPageAfterIds.push(afterId);
					const eligible = options.assignments
						.filter(({ id }) => afterId === undefined || id > afterId)
						.sort((left, right) => left.id.localeCompare(right.id));
					return Effect.succeed(eligible.slice(0, input.limit ?? ASSIGNMENT_PAGE_SIZE));
				}
			},
			sites: {
				findFirst: (input: { readonly where: { readonly id: { readonly eq: string } } }) => {
					const assignmentId = input.where.id.eq.slice('site-'.length);
					if (options.factLoadFailures?.has(assignmentId) === true) {
						return Effect.fail(new Error(`Facts failed for ${assignmentId}`));
					}
					return Effect.succeed({
						id: input.where.id.eq,
						name: 'Site A',
						location: null,
						house_type: null
					});
				}
			},
			variation_requests: { findMany: () => Effect.succeed([]) },
			photo_evidence: {
				findMany: (input: { readonly where?: { readonly sha256?: { readonly eq?: string } } }) =>
					Effect.succeed(
						input.where?.sha256?.eq === ''
							? pendingPhotos.filter((photo) => photo.sha256 === '')
							: assignmentPhotos
					),
				findNearest: () => Effect.succeed(options.nearest ?? [])
			},
			communication_logs: { findMany: () => Effect.succeed([]) },
			suspicion_reviews: {
				findFirst: (input: {
					readonly where: { readonly job_assignment_id: { readonly eq: string } };
				}) => Effect.succeed(existingReviews[input.where.job_assignment_id.eq])
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
				}
			}
		},
		/**
		 * The declared write surface, in the shape the authored api now has: `create` answers with
		 * the committed row, and a row it accepts becomes visible to the `findFirst` that reads it
		 * back on a lost race — which is exactly what the real runtime does.
		 */
		collection: {
			job_assignments: {
				update: (id: string) => {
					if (options.stampFailures?.has(id))
						return Effect.fail(new Error('Assignment already checked by another run'));
					updates.push(id);
					return Effect.succeed({ id });
				}
			},
			suspicion_reviews: {
				create: (values: {
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
					const row = { ...values, id: `review-${values.job_assignment_id}` };
					existingReviews[values.job_assignment_id] = row;
					return Effect.succeed(row);
				}
			},
			suspicious_activity_logs: {
				create: (values: { readonly job_assignment_id: string; readonly review_id: string }) => {
					logCreates.push(values.job_assignment_id);
					const row = { id: `log-${values.job_assignment_id}` };
					logsByReview[values.review_id] = row;
					return Effect.succeed(row);
				}
			},
			photo_evidence: {
				update: (id: string, values: Record<string, unknown>) => {
					photoUpdates.push({ id, ...values });
					// The row becomes inspected for the reads that follow, as the commit would make it.
					const index = assignmentPhotos.findIndex((photo) => photo.id === id);
					if (index >= 0) assignmentPhotos[index] = { ...assignmentPhotos[index], ...values };
					return Effect.succeed({ id, ...values });
				}
			}
		},
		readFileAsset: () =>
			options.photoBytes === undefined
				? Effect.fail(new Error('photo bytes unavailable'))
				: Effect.succeed({
						id: 'file',
						name: 'photo.jpg',
						mimeType: options.photoMimeType === undefined ? 'image/jpeg' : options.photoMimeType,
						size: options.photoBytes.byteLength,
						bytes: options.photoBytes
					})
	};
	return {
		api,
		embedRecordsCalls,
		assignmentPageAfterIds,
		inferenceCounts,
		reviewCreateAttempts,
		logCreates,
		updates,
		photoUpdates,
		progressUpdates,
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

for (const stage of ['review', 'stamp'] as const) {
	test(`a concurrent winner completing the assignment during ${stage} does not fail the losing run`, async () => {
		const selected = assignment('assignment-concurrently-checked');
		const harness = automationHarness({
			assignments: [selected],
			noLongerPending: new Set([selected.id]),
			...(stage === 'review'
				? { reviewPersistenceFailures: new Set([selected.id]) }
				: { stampFailures: new Set([selected.id]) })
		});
		const result = await runAutomation(harness.api);
		assert.equal(result.failure_count, 0);
		assert.equal(result.counts.skipped_no_longer_pending, 1);
		assert.equal(result.counts.checked, 0, "A losing run must not claim the winner's write.");
		assert.deepEqual(harness.updates, []);
	});
}

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

test('keeps the first bounded provider cause in an incomplete-run error', () => {
	const outcome: RunResult = {
		reviewed_at: '2026-08-31T00:00:00.000Z',
		assignment_count: 34,
		inference_count: 34,
		failure_count: 1,
		failure_details: [{ assignment_id: 'assignment-cashew', stage: 'inference' }],
		failure_details_truncated: false,
		counts: { checked: 33, failed: 1 }
	};
	const error = new SuspicionReviewIncompleteError(
		outcome,
		'ProviderRequestFailure: AI provider rejected turn (503): gateway unavailable'
	);
	assert.match(error.message, /assignment-cashew at inference/);
	assert.match(error.message, /rejected turn \(503\): gateway unavailable/);
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

test('bounds asset identities and rejects empty decision reasons', () => {
	const jsonSchema = JSON.stringify(Schema.toJsonSchemaDocument(suspicionInferenceSchema).schema);
	const decode = Schema.decodeUnknownSync(suspicionInferenceSchema);

	assert.match(jsonSchema, new RegExp(`"maxLength":${MAX_INFERENCE_ASSET_NAME_CHARS}`));
	assert.doesNotThrow(() =>
		decode({
			job_site_review: {
				suspicious: true,
				reason: 'x'.repeat(MAX_INFERENCE_REASON_CHARS),
				evidence_asset_name: 'p'.repeat(MAX_INFERENCE_ASSET_NAME_CHARS)
			},
			similar_photo_reviews: [
				{
					job_site_asset_name: 'current.jpg',
					similar_asset_name: 'candidate.jpg',
					same_scene: true,
					reason: 'x'.repeat(MAX_INFERENCE_REASON_CHARS)
				}
			]
		})
	);
	assert.doesNotThrow(() =>
		decode({
			job_site_review: {
				suspicious: true,
				reason: 'x'.repeat(MAX_INFERENCE_REASON_CHARS + 1),
				evidence_asset_name: ''
			},
			similar_photo_reviews: []
		})
	);
	assert.throws(() =>
		decode({
			job_site_review: {
				suspicious: true,
				reason: 'Needs review',
				evidence_asset_name: ''
			},
			similar_photo_reviews: [
				{
					job_site_asset_name: 'p'.repeat(MAX_INFERENCE_ASSET_NAME_CHARS + 1),
					similar_asset_name: 'candidate.jpg',
					same_scene: true,
					reason: 'Needs review'
				}
			]
		})
	);
	assert.throws(() =>
		decode({
			job_site_review: { suspicious: false, reason: '   ', evidence_asset_name: '' },
			similar_photo_reviews: []
		})
	);
});

test('normalises a verbose provider explanation without failing or changing its decision', async () => {
	const reason = 'The supplied photographs do not show a contradiction. '.repeat(30);
	const api = {
		infer: () =>
			Effect.try(() =>
				Schema.decodeUnknownSync(suspicionInferenceSchema)({
					job_site_review: { suspicious: false, reason, evidence_asset_name: '' },
					similar_photo_reviews: []
				})
			)
	} as unknown as Parameters<typeof inferSuspicionReviewDecision>[0];
	const decision = await Effect.runPromise(inferSuspicionReviewDecision(api, facts()));
	assert.equal(decision.suspicious, false);
	assert.equal(decision.evidence_id, null);
	assert.ok(decision.reason.length <= MAX_INFERENCE_REASON_CHARS);
	assert.ok(decision.reason.endsWith('…[clipped]'));
	assert.ok(decision.reason.startsWith('The supplied photographs do not show a contradiction.'));
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
	assert.doesNotMatch(suspicionPrompt(original), /reserved review policy/);
	assert.match(
		suspicionPrompt(original),
		/Plausibly benign ambiguity, incomplete corroboration.*is not enough/
	);
});

test('reports only the GPS metadata state retained for each named asset', () => {
	const [missing, present] = facts().photos;
	assert.equal(gpsMetadataStatus(missing!.flags), 'missing_from_asset');
	assert.equal(gpsMetadataStatus(present!.flags), 'present_without_location_mismatch');
	assert.equal(
		gpsMetadataStatus(['location_mismatch']),
		'present_and_outside_assigned_site_tolerance'
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
			record_embedding_photos: number;
			job_site_photo_dataset: ReadonlyArray<{
				readonly asset_name: string;
				readonly gps_metadata: string;
			}>;
		};
	};
	assert.equal(context.photo_summary.similarity_relationships, 0);
	assert.equal(
		context.photo_summary.record_embedding_photos,
		0,
		'a photo without a record embedding cannot nominate similar photos'
	);
	assert.equal(
		Object.hasOwn(context.photo_summary, 'within_assignment_exact_sha_group_count'),
		false
	);
	assert.equal(
		Object.hasOwn(context.photo_summary, 'within_assignment_exact_sha_photo_count'),
		false
	);
	assert.deepEqual(context.photo_summary.job_site_photo_dataset, [
		{
			asset_name: '00003039-PHOTO-2026-07-03-10-59-50.jpg',
			gps_metadata: 'missing_from_asset',
			visually_attached: true,
			file_size: 1_042_864,
			mime_type: 'image/jpeg',
			integrity_flags: ['missing_geolocation']
		},
		{
			asset_name: '00003060-PHOTO-2026-07-03-11-01-56.jpg',
			gps_metadata: 'missing_from_asset',
			visually_attached: true,
			file_size: 953_878,
			mime_type: 'image/jpeg',
			integrity_flags: ['missing_geolocation']
		},
		{
			asset_name: '00003097-PHOTO-2026-07-03-11-02-16.jpg',
			gps_metadata: 'missing_from_asset',
			visually_attached: true,
			file_size: 953_878,
			mime_type: 'image/jpeg',
			integrity_flags: ['missing_geolocation']
		}
	]);
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

/**
 * Brute-force stand-in for the HNSW `findNearest`: every corpus row within the cosine band, each
 * carrying its measured `distance` as the real read does.
 */
const nearestStub =
	(corpus: ReadonlyArray<Record<string, unknown>>) =>
	(input: { readonly probe: readonly number[]; readonly maxDistance: number }) =>
		Effect.succeed(
			corpus.flatMap((row) => {
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
				const distance = magnitude === 0 ? 1 : 1 - dot / magnitude;
				return distance <= input.maxDistance ? [{ ...row, distance }] : [];
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
		ceiling('00003140', base, 'assignment-kismis'),
		ceiling('00003139', base, 'assignment-kismis')
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
	assert.deepEqual(candidates[0]?.matched_photo_ids, ['00003139']);

	const withCandidates: SuspicionReviewFacts = {
		...facts(),
		assignment: { ...facts().assignment, id: 'assignment-kismis' },
		photos: probes,
		candidates
	};
	const context = JSON.parse(buildSuspicionInferenceContext(withCandidates)) as {
		attachment_manifest: {
			instruction: string;
			images: ReadonlyArray<{
				readonly asset_name: string;
				readonly gps_metadata: string;
				readonly role: string;
			}>;
		};
		photo_summary: {
			record_embedding_photos: number;
			job_site_photo_dataset: ReadonlyArray<{
				readonly asset_name: string;
				readonly gps_metadata: string;
				readonly visually_attached: boolean;
			}>;
		};
		similar_photos_flagged: ReadonlyArray<{
			readonly job_site_asset_name: string;
			readonly similar_asset_name: string;
			readonly similar_asset_gps_metadata: string;
			readonly visually_attached: boolean;
		}>;
	};
	assert.match(context.attachment_manifest.instruction, /role and asset_name are authoritative/);
	assert.equal(
		context.photo_summary.record_embedding_photos,
		probes.length,
		'every probe with a record embedding is counted as able to nominate'
	);
	assert.deepEqual(context.attachment_manifest.images.at(-1), {
		asset_name: 'foreign-near.jpg',
		gps_metadata: 'missing_from_asset',
		role: 'similar_photo_from_other_assignment',
		compare_only_with_asset_name: '00003139.jpg'
	});
	assert.deepEqual(
		context.photo_summary.job_site_photo_dataset.map(({ asset_name, gps_metadata }) => ({
			asset_name,
			gps_metadata
		})),
		[...probes]
			.sort((left, right) => left.id.localeCompare(right.id))
			.map((photo) => ({
				asset_name: photo.photo.file_name,
				gps_metadata: 'missing_from_asset'
			}))
	);
	assert.deepEqual(context.similar_photos_flagged, [
		{
			job_site_asset_name: '00003139.jpg',
			similar_asset_name: 'foreign-near.jpg',
			similar_asset_gps_metadata: 'missing_from_asset',
			retrieval_distance: 0.3,
			visually_attached: true
		}
	]);
	const prompt = suspicionPrompt(withCandidates);
	assert.match(prompt, /exactly one structured turn/);
	assert.match(prompt, /complete set submitted to this assignment/);
	assert.match(
		prompt,
		/Do not invent a photo number, record id, attachment label, address, GPS coordinate/
	);
	assert.match(prompt, /foreign-near\.jpg/);
	assert.match(prompt, /similar_photo_from_other_assignment/);
	assert.match(prompt, /never borrow a number, address, sign, marker or scene observation/);
	assert.match(prompt, /crop, zoom, recompression/);
	assert.match(prompt, /actionable escalation, not a queue for low-confidence review/);
	assert.doesNotMatch(prompt, /reserved review policy/);
	assert.doesNotMatch(prompt, /foreign-near-sha/);
});

test('names Ridgewood and Hillview in one Pine Grove turn without treating them as job-site evidence', () => {
	const original = facts();
	const photo = (id: string, fileName: string, fileSize: number) => ({
		...original.photos[0]!,
		id,
		photo: {
			storage_key: `document-assets/bca-simulation/${fileName}`,
			file_name: fileName,
			file_size: fileSize,
			mime_type: 'image/jpeg'
		},
		flags: [],
		matched_evidence_ids: []
	});
	const pineBuilding = photo('pine-building', '00003023-PHOTO-2026-07-03-10-56-20.jpg', 1_042_564);
	const pineMeasurement = photo(
		'pine-measurement',
		'00003031-PHOTO-2026-07-03-10-57-56.jpg',
		1_003_701
	);
	const ridgewood = photo(
		'ridgewood-reference',
		'00003035-PHOTO-2026-07-03-10-59-00.jpg',
		1_042_844
	);
	const hillview = photo('hillview-reference', '00003068-PHOTO-2026-07-03-11-02-01.jpg', 965_732);
	const pineGrove: SuspicionReviewFacts = {
		...original,
		assignment: {
			...original.assignment,
			summary: 'Survey & Installation — 1F, Pine Grove #17-30'
		},
		photos: [pineBuilding, pineMeasurement],
		candidates: [
			{
				...ridgewood,
				distance: 0.153,
				matched_photo_ids: [pineBuilding.id]
			},
			{
				...hillview,
				distance: 0.086,
				matched_photo_ids: [pineMeasurement.id]
			}
		]
	};

	const context = JSON.parse(buildSuspicionInferenceContext(pineGrove, pineGrove.photos)) as {
		attachment_manifest: {
			images: ReadonlyArray<{
				readonly asset_name: string;
				readonly role: string;
				readonly compare_only_with_asset_name?: string;
			}>;
		};
		photo_summary: {
			job_site_photo_dataset: ReadonlyArray<{ readonly asset_name: string }>;
		};
		similar_photos_flagged: ReadonlyArray<{
			readonly job_site_asset_name: string;
			readonly similar_asset_name: string;
		}>;
	};
	assert.deepEqual(
		context.attachment_manifest.images.map(({ asset_name, role }) => ({
			asset_name,
			role
		})),
		[
			{ asset_name: pineBuilding.photo.file_name, role: 'job_site_photo' },
			{ asset_name: pineMeasurement.photo.file_name, role: 'job_site_photo' },
			{ asset_name: ridgewood.photo.file_name, role: 'similar_photo_from_other_assignment' },
			{ asset_name: hillview.photo.file_name, role: 'similar_photo_from_other_assignment' }
		]
	);
	assert.deepEqual(
		context.photo_summary.job_site_photo_dataset.map(({ asset_name }) => asset_name),
		[pineBuilding.photo.file_name, pineMeasurement.photo.file_name]
	);
	assert.deepEqual(
		context.similar_photos_flagged.map(({ job_site_asset_name, similar_asset_name }) => ({
			job_site_asset_name,
			similar_asset_name
		})),
		[
			{
				job_site_asset_name: pineBuilding.photo.file_name,
				similar_asset_name: ridgewood.photo.file_name
			},
			{
				job_site_asset_name: pineMeasurement.photo.file_name,
				similar_asset_name: hillview.photo.file_name
			}
		]
	);
	const prompt = suspicionPrompt(pineGrove, pineGrove.photos);
	assert.match(prompt, new RegExp(ridgewood.photo.file_name));
	assert.match(prompt, new RegExp(hillview.photo.file_name));
	assert.match(prompt, /Never treat a similar_photo_from_other_assignment as evidence/);
	assert.match(
		prompt,
		/Compare each visually_attached pair only with its named job_site_asset_name/
	);
});

test('keeps Wajek and Phoenix roles explicit in one turn without exposing internal photo ids', () => {
	const original = facts();
	const photo = (id: string, fileName: string) => ({
		...original.photos[0]!,
		id,
		photo: {
			storage_key: `document-assets/bca-simulation/${fileName}`,
			file_name: fileName,
			file_size: 700_000,
			mime_type: 'image/jpeg'
		},
		flags: ['missing_geolocation'],
		matched_evidence_ids: []
	});
	const mailbox22 = photo(
		'019f6f10-5000-7000-8000-000000000254',
		'00003364-PHOTO-2026-07-03-11-43-27.jpg'
	);
	const wajekSign = photo(
		'019f6f10-5000-7000-8000-000000000255',
		'00003365-PHOTO-2026-07-03-11-43-27.jpg'
	);
	const wajekExterior = photo(
		'019f6f10-5000-7000-8000-000000000256',
		'00003366-PHOTO-2026-07-03-11-43-27.jpg'
	);
	const phoenixMailbox = photo('foreign-phoenix-mailbox', '00003359-PHOTO-2026-07-03-11-42-54.jpg');
	const phoenixExterior = photo(
		'foreign-phoenix-exterior',
		'00003360-PHOTO-2026-07-03-11-42-54.jpg'
	);
	const wajek: SuspicionReviewFacts = {
		...original,
		assignment: {
			...original.assignment,
			id: 'assignment-wajek',
			summary: 'Photo evidence — 22 Jalan Wajek, Singapore'
		},
		job: original.job == null ? null : { ...original.job, title: '22 Jalan Wajek, Singapore' },
		site: original.site == null ? null : { ...original.site, name: '22 Jalan Wajek, Singapore' },
		photos: [mailbox22, wajekSign, wajekExterior],
		candidates: [
			{
				...phoenixMailbox,
				distance: 0.165,
				matched_photo_ids: [mailbox22.id]
			},
			{
				...phoenixExterior,
				distance: 0.168,
				matched_photo_ids: [wajekExterior.id]
			}
		]
	};

	const mainPrompt = suspicionPrompt(wajek, wajek.photos);
	for (const ownPhoto of wajek.photos) {
		assert.match(mainPrompt, new RegExp(ownPhoto.photo.file_name));
		assert.doesNotMatch(mainPrompt, new RegExp(ownPhoto.id));
	}
	assert.match(mainPrompt, new RegExp(phoenixMailbox.photo.file_name));
	assert.match(mainPrompt, new RegExp(phoenixExterior.photo.file_name));
	assert.doesNotMatch(mainPrompt, new RegExp(phoenixMailbox.id));
	assert.doesNotMatch(mainPrompt, new RegExp(phoenixExterior.id));
	assert.match(mainPrompt, /similar_photo_from_other_assignment/);
	assert.match(mainPrompt, /do not use it in TASK 1/);
	assert.doesNotMatch(mainPrompt, /house numbered 15/);
	assert.equal(
		validDecisionEvidenceId(
			{
				suspicious: true,
				reason: 'The attached job-site photos conflict.',
				evidence_asset_name: wajekExterior.photo.file_name
			},
			wajek.photos
		),
		wajekExterior.id
	);
});

test('runs the job-site and similar-photo reviews in one named inference turn', async () => {
	const original = facts();
	const current = {
		...original.photos[0]!,
		id: 'current-record-id',
		photo: {
			...original.photos[0]!.photo,
			file_name: '00003140-PHOTO-2026-07-03-11-09-33.jpg',
			file_size: 800_000
		},
		flags: ['missing_geolocation'],
		matched_evidence_ids: []
	};
	const otherCurrent = {
		...original.photos[1]!,
		id: 'other-current-record-id',
		photo: {
			...original.photos[1]!.photo,
			file_name: '00003145-PHOTO-2026-07-03-11-09-37.jpg',
			file_size: 750_000
		},
		flags: ['missing_geolocation'],
		matched_evidence_ids: []
	};
	const foreign = {
		...current,
		id: 'foreign-record-id',
		photo: {
			...current.photo,
			file_name: '00003592-PHOTO-2026-07-03-12-10-12.jpg'
		},
		distance: 0.122,
		matched_photo_ids: [current.id]
	};
	const reviewFacts: SuspicionReviewFacts = {
		...original,
		photos: [current, otherCurrent],
		candidates: [foreign]
	};
	const calls: Array<{
		readonly model: string;
		readonly prompt: string;
		readonly assetNames: ReadonlyArray<string>;
	}> = [];
	const api = {
		infer: (input: {
			readonly model: string;
			readonly prompt: string;
			readonly images: ReadonlyArray<{ readonly file: { readonly file_name: string } }>;
		}) => {
			calls.push({
				model: input.model,
				prompt: input.prompt,
				assetNames: input.images.map(({ file }) => file.file_name)
			});
			return Effect.succeed({
				job_site_review: {
					suspicious: false,
					reason: 'The job-site evidence is internally consistent.',
					evidence_asset_name: ''
				},
				similar_photo_reviews: [
					{
						job_site_asset_name: current.photo.file_name,
						similar_asset_name: foreign.photo.file_name,
						same_scene: true,
						reason: 'Invented record asset-999 allegedly confirms the match.'
					}
				]
			});
		}
	} as never;

	const decision = await Effect.runPromise(
		inferSuspicionReviewDecision(api, reviewFacts, reviewFacts.photos)
	);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0]?.assetNames, [
		current.photo.file_name,
		otherCurrent.photo.file_name,
		foreign.photo.file_name
	]);
	assert.match(calls[0]!.prompt, new RegExp(current.photo.file_name));
	assert.match(calls[0]!.prompt, new RegExp(otherCurrent.photo.file_name));
	assert.match(calls[0]!.prompt, new RegExp(foreign.photo.file_name));
	assert.match(calls[0]!.prompt, /Return exactly 1 similar_photo_reviews entry/);
	assert.ok(calls.every(({ model }) => model === 'openrouter/deepseek/deepseek-v4.1-flash'));
	assert.deepEqual(decision, {
		suspicious: true,
		reason: `Cross-assignment photo reuse: ${current.photo.file_name} and ${foreign.photo.file_name} were judged to show the same physical scene.`,
		evidence_id: current.id
	});
	assert.doesNotMatch(decision.reason, /asset-999/);

	const incompleteApi = {
		infer: () =>
			Effect.succeed({
				job_site_review: {
					suspicious: false,
					reason: 'The job-site evidence is internally consistent.',
					evidence_asset_name: ''
				},
				similar_photo_reviews: []
			})
	} as never;
	await assert.rejects(
		Effect.runPromise(inferSuspicionReviewDecision(incompleteApi, reviewFacts, reviewFacts.photos)),
		/returned 0 of 1 required similar-photo pair decisions/
	);
});

test('does not persist a job-site suspicion that cites an invented asset name', async () => {
	const reviewFacts = facts();
	const api = {
		infer: () =>
			Effect.succeed({
				job_site_review: {
					suspicious: true,
					reason: 'Invented photo 999 allegedly shows house number 15.',
					evidence_asset_name: 'invented-photo-999.jpg'
				},
				similar_photo_reviews: []
			})
	} as never;

	const decision = await Effect.runPromise(
		inferSuspicionReviewDecision(api, reviewFacts, reviewFacts.photos)
	);
	assert.deepEqual(decision, {
		suspicious: false,
		reason:
			'No suspicion log was created because the review did not identify an attached job-site asset by its supplied name.',
		evidence_id: null
	});
});

test('keeps the real Kismis ceiling winner and rejects the ambiguous Eng Kong cluster', async () => {
	assert.equal(RECORD_EMBEDDING_MIN_DISTINCTIVENESS, 0.02);
	const probe = (plane: number): readonly number[] =>
		Array.from({ length: 6 }, (_, index) => Number(index === plane * 2));
	const atDistance = (plane: number, distance: number): readonly number[] => {
		const angle = Math.acos(1 - distance);
		return Array.from({ length: 6 }, (_, index) => {
			if (index === plane * 2) return Math.cos(angle);
			if (index === plane * 2 + 1) return Math.sin(angle);
			return 0;
		});
	};
	const row = (
		id: string,
		fileName: string,
		assignmentId: string,
		embedding: readonly number[]
	) => ({
		id,
		photo: {
			storage_key: `document-assets/bca-simulation/${fileName}`,
			file_name: fileName,
			file_size: 800_000,
			mime_type: 'image/jpeg'
		},
		sha256: `${id}-sha`,
		flags: [],
		matched_evidence_ids: [],
		created_at: null,
		job_assignment_id: assignmentId,
		variation_request_id: null,
		record_embedding: embedding
	});

	/**
	 * Distances pinned as hex/vector constants from a historical private-demo pair
	 * (this suite does not load private assets):
	 *
	 * - the wrong door/handrail probe `00003149` has two effectively tied neighbours, 0.102007 and
	 *   0.103903, so neither is distinctive;
	 * - the named ceiling probe `00003140` selects `00003592` at 0.121798, with its runner-up at
	 *   0.160457;
	 * - another generic fixture probe is only 0.011670 ahead of its runner-up and is rejected too.
	 *
	 * Separate orthogonal planes preserve exactly those observed rankings without checking provider
	 * vectors into source control.
	 */
	const corpus = [
		row(
			'019f6f10-5000-7000-8000-000000000198',
			'00003288.jpg',
			'assignment-eng-kong',
			atDistance(0, 0.102007)
		),
		row(
			'019f6f10-5000-7000-8000-000000000196',
			'00003286.jpg',
			'assignment-eng-kong',
			atDistance(0, 0.103903)
		),
		row(
			'019f6f10-5000-7000-8000-000000000426',
			'00003592.jpg',
			'assignment-lorong',
			atDistance(1, 0.121798)
		),
		row('ceiling-runner-up', '00003265.jpg', 'assignment-hazel', atDistance(1, 0.160457)),
		row('generic-winner', '00003056.jpg', 'assignment-hillview', atDistance(2, 0.125904)),
		row('generic-runner-up', '00003264.jpg', 'assignment-hazel', atDistance(2, 0.137574))
	];
	const probes = [
		row('019f6f10-5000-7000-8000-000000000097', '00003149.jpg', 'assignment-kismis', probe(0)),
		row('019f6f10-5000-7000-8000-000000000088', '00003140.jpg', 'assignment-kismis', probe(1)),
		row('019f6f10-5000-7000-8000-000000000101', '00003153.jpg', 'assignment-kismis', probe(2))
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
	assert.deepEqual(candidates, [
		{
			id: '019f6f10-5000-7000-8000-000000000426',
			photo: corpus[2]!.photo,
			sha256: '019f6f10-5000-7000-8000-000000000426-sha',
			flags: [],
			distance: 0.122,
			matched_photo_ids: ['019f6f10-5000-7000-8000-000000000088']
		}
	]);
});

test('pins the real Kismis-Lorong crop pair past every perceptual band', () => {
	const kismisFirst = 'ff460171fe8e0179fe870558feaf00d07d4f02b07d5ea6a15a5ea5285a97254c';
	const kismisSecond = '3f86d0593f96c0a92f97d0683ea7c1583fafc1503caf82607d5f1228aad7156c';
	const lorongCrop = 'd24a124bf2dd1243d7583cda8a1fb9604d16edf40927edb40d27e9240da7e5bc';

	// Bit-exact PDQ distances of the pinned hex pair (rank 39/62/327 in each other's
	// neighbour lists — behind hundreds of unrelated pairs, whose corpus floor is 88 bits).
	assert.equal(hammingHex(kismisFirst, lorongCrop), 116);
	assert.equal(hammingHex(kismisSecond, lorongCrop), 130);
	// Beyond even a generous 64-bit perceptual band: no PDQ threshold nominates this reuse.
	assert.ok(hammingHex(kismisFirst, lorongCrop) > 64);
	assert.ok(hammingHex(kismisFirst, lorongCrop) > 31);
	// Same-scene, same-assignment shots are equally far apart — repeats stay neutral regardless.
	assert.equal(hammingHex(kismisFirst, kismisSecond), 84);
});

test('derives stable idempotency keys from the complete evidence basis', () => {
	const basis = buildSuspicionReviewBasis(facts());
	const hash = sha256Text(basis);
	assert.match(hash, /^[a-f0-9]{64}$/);
	assert.equal(reviewSourceKey('assignment-a', hash), `suspicion-review:assignment-a:${hash}`);
});

test('accepts an inference evidence citation only when it names a supplied photo', () => {
	const photos = facts().photos;
	assert.equal(
		validDecisionEvidenceId(
			{ suspicious: true, reason: 'Visible contradiction', evidence_asset_name: 'a.jpg' },
			photos
		),
		'photo-a'
	);
	assert.equal(
		validDecisionEvidenceId(
			{ suspicious: true, reason: 'Invented citation', evidence_asset_name: 'invented.jpg' },
			photos
		),
		null
	);
});

type Transform = (
	inputs: ReadonlyArray<Readonly<Record<string, unknown>>>,
	context: {
		readonly existing: ReadonlyArray<Readonly<Record<string, unknown>> | undefined>;
		readonly db: unknown;
	}
) => Effect.Effect<ReadonlyArray<Readonly<Record<string, unknown>>>, unknown>;

const judgementTransform = suspiciousActivityLogs.transform as unknown as Transform;

/** What the transform reads: one assignment, one review and one photo on it. */
const judgementDb = {
	job_assignments: { findMany: () => Effect.succeed([{ id: 'assignment-a' }]) },
	suspicion_reviews: {
		findMany: () => Effect.succeed([{ id: 'review-a', job_assignment_id: 'assignment-a' }])
	},
	photo_evidence: {
		findMany: () =>
			Effect.succeed([
				{ id: 'photo-a', job_assignment_id: 'assignment-a', variation_request_id: null },
				{ id: 'photo-b', job_assignment_id: 'assignment-b', variation_request_id: null }
			])
	},
	variation_requests: { findMany: () => Effect.succeed([]) }
};

const judge = (
	input: Readonly<Record<string, unknown>>,
	existing?: Readonly<Record<string, unknown>>
) =>
	Effect.runPromise(judgementTransform([input], { existing: [existing], db: judgementDb })).then(
		(payloads) => payloads[0]
	);

const openLog = {
	id: 'log-a',
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

test('a new judgement starts unresolved by construction and resolves once, atomically', async () => {
	// The create selection carries no resolution columns, so a judgement cannot be born resolved.
	assert.equal('resolution' in (suspiciousActivityLogs.create.input.columns ?? {}), false);
	// The update selection carries only the resolution columns, so a judgement cannot be rewritten.
	assert.deepEqual(Object.keys(suspiciousActivityLogs.update.input.columns ?? {}), [
		'resolution',
		'resolved_at',
		'resolved_by'
	]);

	const resolved = await judge(
		{
			id: openLog.id,
			resolution: 'Reviewed and accepted',
			resolved_at: '2026-08-24T02:00:00.000Z',
			resolved_by: 'controller-a'
		},
		openLog
	);
	assert.equal(resolved?.resolution, 'Reviewed and accepted');
	await assert.rejects(
		judge({ id: openLog.id, resolution: 'Partial' }, openLog),
		/must be written together/
	);
	await assert.rejects(
		judge(
			{
				id: openLog.id,
				resolution: 'Again',
				resolved_at: '2026-08-25T00:00:00.000Z',
				resolved_by: 'controller-b'
			},
			{
				...openLog,
				resolution: 'Done',
				resolved_at: '2026-08-24T02:00:00.000Z',
				resolved_by: 'controller-a'
			}
		),
		/cannot be reopened or rewritten/
	);
});

test('stamps authorized-human judgement internals without exposing them as form fields', async () => {
	const normalized = await judge({
		job_assignment_id: 'assignment-a',
		reason: 'The contractor reported a conflicting unit number.',
		evidence_id: null
	});
	assert.equal(normalized?.origin, 'human');
	assert.deepEqual(JSON.parse(String(normalized?.basis)), {
		kind: 'human_judgement',
		reason: 'The contractor reported a conflicting unit number.',
		evidence_id: null
	});
	await assert.rejects(
		judge({
			job_assignment_id: 'assignment-a',
			reason: 'AI says suspicious',
			origin: 'automation'
		}),
		/must supply its reviewed evidence basis/
	);
});

test('keeps automated review and evidence links on the judged assignment', async () => {
	await assert.doesNotReject(
		judge({
			job_assignment_id: 'assignment-a',
			origin: 'automation',
			basis: '{}',
			review_id: 'review-a',
			evidence_id: 'photo-a',
			reason: 'Reused photo'
		})
	);
	await assert.rejects(
		judge({ job_assignment_id: 'assignment-a', origin: 'automation', basis: '{}', reason: 'x' }),
		/must reference its inference review/
	);
	await assert.rejects(
		judge({
			job_assignment_id: 'assignment-a',
			origin: 'human',
			review_id: 'review-a',
			reason: 'x'
		}),
		/cannot claim an automated inference review/
	);
	await assert.rejects(
		judge({
			job_assignment_id: 'assignment-a',
			origin: 'human',
			evidence_id: 'photo-b',
			reason: 'x'
		}),
		/evidence belongs to another/
	);
	await assert.rejects(
		judge({ job_assignment_id: 'assignment-z', reason: 'x' }),
		/must reference an existing job assignment/
	);
});

test('keeps captured contractor communications immutable', () => {
	// No update and no delete endpoint: a received message can only ever be read.
	assert.equal(communicationLogs.update, undefined);
	assert.equal(communicationLogs.delete, undefined);
	assert.notEqual(communicationLogs.create, undefined);
});

test('the inference schema is one the structured-output provider will accept', () => {
	// The provider refuses a request whose schema uses `anyOf` anywhere, or whose root is not an
	// object: `OpenAiStructuredOutput: Root JSON Schema must have type "object" and must not use
	// "anyOf"`. That refusal is total rather than partial — it failed every inference this
	// automation ever attempted, and a suspicion review that never ran looks from the outside like
	// a review that found nothing.
	//
	// A single `Schema.NullOr` is enough to reintroduce it, which is why this asserts the compiled
	// document rather than the shape of any one field.
	const document = JSON.stringify(Schema.toJsonSchemaDocument(suspicionInferenceSchema));
	assert.equal(document.includes('anyOf'), false, 'inference schema must not compile to anyOf');
	assert.equal(
		Schema.toJsonSchemaDocument(suspicionInferenceSchema).schema.type,
		'object',
		'inference schema root must be an object'
	);
});

test('a recorded infer binding receives a root-object schema with no anyOf', async () => {
	const reviewFacts = facts();
	let recordedSchema: unknown;
	const api = {
		infer: (input: { readonly schema: typeof suspicionInferenceSchema }) => {
			recordedSchema = input.schema;
			return Effect.succeed({
				job_site_review: {
					suspicious: false,
					reason: 'The job-site evidence is internally consistent.',
					evidence_asset_name: ''
				},
				similar_photo_reviews: []
			});
		}
	} as never;

	await Effect.runPromise(inferSuspicionReviewDecision(api, reviewFacts, reviewFacts.photos));
	assert.notEqual(recordedSchema, undefined);
	const document = Schema.toJsonSchemaDocument(recordedSchema as typeof suspicionInferenceSchema);
	assert.equal(document.schema.type, 'object', 'recorded infer schema root must be an object');
	assert.equal(
		JSON.stringify(document).includes('anyOf'),
		false,
		'recorded infer schema must not compile to anyOf'
	);
});

test('Run now streams progress percentages and a second start is blocked', async () => {
	const assignments = Array.from({ length: 4 }, (_, index) =>
		assignment(`assignment-progress-${index}`)
	);
	const harness = automationHarness({ assignments });
	const result = await runAutomation(harness.api);
	assert.equal(result.failure_count, 0);
	assert.ok(harness.progressUpdates.length >= 2);
	assert.equal(harness.progressUpdates[0]?.progress, 0.02);
	assert.equal(harness.progressUpdates.at(-1)?.progress, 1);
	const percents = harness.progressUpdates.map((update) => Math.round(update.progress * 100));
	assert.ok(percents.some((percent) => percent > 0 && percent < 100));
	assert.equal(percents.at(-1), 100);
});

test('the 00003140/00003592 pair is sent as host-encoded descriptors under 1 MiB', async () => {
	const original = facts();
	const current = {
		...original.photos[0]!,
		id: 'kismis-ceiling',
		photo: {
			storage_key: 'photos/00003140-PHOTO-2026-07-03-11-09-33.jpg',
			file_name: '00003140-PHOTO-2026-07-03-11-09-33.jpg',
			file_size: 800_000,
			mime_type: 'image/jpeg'
		},
		flags: [],
		matched_evidence_ids: []
	};
	const foreign = {
		...current,
		id: 'lorong-ceiling',
		photo: {
			storage_key: 'photos/00003592-PHOTO-2026-07-03-12-10-12.jpg',
			file_name: '00003592-PHOTO-2026-07-03-12-10-12.jpg',
			file_size: 900_000,
			mime_type: 'image/jpeg'
		},
		distance: 0.122,
		matched_photo_ids: [current.id]
	};
	const reviewFacts: SuspicionReviewFacts = {
		...original,
		photos: [current],
		candidates: [foreign]
	};
	const calls: Array<{
		readonly images: ReadonlyArray<Readonly<Record<string, unknown>>>;
	}> = [];
	const api = {
		infer: (input: {
			readonly images: ReadonlyArray<{
				readonly file: {
					readonly storage_key: string;
					readonly file_name: string;
					readonly file_size: number;
					readonly mime_type: string;
				};
				readonly detail?: string;
			}>;
		}) => {
			calls.push({ images: input.images });
			return Effect.succeed({
				job_site_review: {
					suspicious: false,
					reason: 'The job-site evidence is internally consistent.',
					evidence_asset_name: ''
				},
				similar_photo_reviews: [
					{
						job_site_asset_name: current.photo.file_name,
						similar_asset_name: foreign.photo.file_name,
						same_scene: true,
						reason: 'Same ceiling geometry.'
					}
				]
			});
		}
	} as never;

	await Effect.runPromise(inferSuspicionReviewDecision(api, reviewFacts, reviewFacts.photos));
	assert.equal(calls.length, 1);
	for (const image of calls[0]!.images) {
		const file = image.file;
		assert.equal(file != null && typeof file === 'object' && !Array.isArray(file), true);
		const record = file as Record<string, unknown>;
		assert.equal(typeof record.storage_key, 'string');
		assert.equal(typeof record.file_name, 'string');
		assert.equal(typeof record.mime_type, 'string');
		assert.equal(typeof record.file_size, 'number');
		assert.equal('bytes' in record || 'data' in record || 'base64' in record, false);
		assert.equal(String(record.storage_key).startsWith('data:'), false);
	}
	assert.ok(new TextEncoder().encode(JSON.stringify(calls[0])).length < 1024 * 1024);
	assert.deepEqual(
		calls[0]!.images.map((image) => (image.file as { file_name: string }).file_name),
		[current.photo.file_name, foreign.photo.file_name]
	);
});

test('a full 34-assignment pass completes with no empty-model failures', async () => {
	const assignments = Array.from({ length: 34 }, (_, index) =>
		assignment(`assignment-full-pass-${String(index).padStart(2, '0')}`)
	);
	const harness = automationHarness({ assignments });
	const result = await runAutomation(harness.api);
	assert.equal(result.assignment_count, 34);
	assert.equal(result.inference_count, 34);
	assert.equal(result.failure_count, 0);
	assert.equal(result.counts.checked, 34);
	assert.equal(result.counts.failed ?? 0, 0);
});

/**
 * The affirmative branch: the whole point of the automation, and the one nothing asserted.
 *
 * Every other test in this file that drives a suspicious judgement also arranges a reason for the
 * log *not* to be written — an open log, or a durable prior review — and then asserts `logCreates`
 * is empty. That is the negative half of the contract asserted four times over and the positive
 * half asserted nowhere, so an automation that had stopped writing logs altogether would have
 * passed this suite.
 */
test('writes one suspicion log when the judgement is suspicious and nothing already stands', async () => {
	const selected = assignment('assignment-suspicious');
	const harness = automationHarness({
		assignments: [selected],
		decisions: { [selected.id]: { suspicious: true, reason: 'The photo contradicts the summary.' } }
	});
	const result = await runAutomation(harness.api);

	assert.equal(result.failure_count, 0);
	assert.equal(result.assignment_count, 1);
	assert.equal(result.inference_count, 1);
	assert.equal(result.counts.suspicious, 1, 'the suspicious judgement is counted as one');
	assert.deepEqual(harness.logCreates, [selected.id], 'exactly one log, naming the assignment');
	assert.deepEqual(harness.reviewCreateAttempts, [selected.id]);
	assert.deepEqual(harness.updates, [selected.id], 'the assignment is stamped as checked');
});

/**
 * A second pass over the same assignment adds nothing.
 *
 * The idempotency the hourly schedule depends on is "the log written by the first run is found by
 * the second", and the sibling tests only ever prove the pre-seeded variant of that. This one
 * writes the log for real and then re-runs against the state the first run left behind.
 */
test('a second run over the same suspicious assignment writes no second log', async () => {
	const selected = assignment('assignment-suspicious-twice');
	const decisions = {
		[selected.id]: { suspicious: true, reason: 'The photo contradicts the summary.' }
	};
	const first = automationHarness({ assignments: [selected], decisions });
	await runAutomation(first.api);
	assert.deepEqual(first.logCreates, [selected.id]);

	const second = automationHarness({
		assignments: [selected],
		decisions,
		openSuspicionIds: { [selected.id]: `log-${selected.id}` }
	});
	const result = await runAutomation(second.api);

	assert.equal(result.counts.suspicious_open_exists, 1);
	assert.deepEqual(second.logCreates, [], 'the standing log is not duplicated');
});

/** A real JPEG, because the inspection pass decodes bytes rather than trusting a stub. */
const solidJpeg = (width = 640, height = 480): Uint8Array => {
	const data = new Uint8Array(width * height * 3).fill(150);
	return encodeJpeg({ data, width, height }, 80).data;
};

const pendingPhoto = (assignmentId: string) => ({
	id: 'photo-pending',
	photo: {
		storage_key: 'photos/pending.jpg',
		file_name: 'pending.jpg',
		file_size: 1,
		mime_type: 'image/jpeg'
	},
	sha256: '',
	flags: [],
	matched_evidence_ids: [],
	created_at: null,
	perceptual_embedding: [],
	record_embedding: null,
	job_assignment_id: assignmentId,
	variation_request_id: null
});

/**
 * The inspection pass runs before any judgement, writes the photo's facts, and the assignment is
 * then reviewed on them — one automation doing what a created-event automation used to.
 */
test('inspects a filed photo before judging its assignment', async () => {
	const selected = assignment('assignment-uninspected');
	const photo = pendingPhoto(selected.id);
	const harness = automationHarness({
		assignments: [selected],
		assignmentPhotos: [photo],
		pendingPhotos: [photo],
		photoBytes: solidJpeg()
	});
	const outcome = await runAutomation(harness.api);

	assert.equal(outcome.counts.inspected_photos, 1);
	assert.equal(outcome.counts.inspection_failed, 0);
	assert.equal(harness.photoUpdates.length, 1);
	const update = harness.photoUpdates[0];
	assert.equal(update?.id, photo.id);
	assert.equal(typeof update?.sha256, 'string');
	assert.ok(String(update?.sha256).length > 0, 'the hash was written');
	assert.ok(Array.isArray(update?.flags), 'the flags were written');
	assert.equal(outcome.inference_count, 1, 'the assignment was judged on inspected facts');
	assert.equal(outcome.counts.checked, 1);
});

/**
 * The embedding backfill is the automation's first pass, and it is bounded per call: the loop has
 * to keep asking until the host answers "nothing pending". The review then judges the assignment.
 */
test('embeds filed photos before inspecting and judging them', async () => {
	const selected = assignment('assignment-embedding');
	const harness = automationHarness({
		assignments: [selected],
		embeddingPasses: [
			{ selected: 2, embedded: 2 },
			{ selected: 0, embedded: 0 }
		]
	});
	const outcome = await runAutomation(harness.api);

	assert.deepEqual(harness.embedRecordsCalls, ['photo_evidence', 'photo_evidence']);
	assert.equal(outcome.counts.embedded_photos, 2);
	assert.equal(outcome.counts.embedding_failed, 0);
	assert.equal(outcome.counts.checked, 1);
	assert.equal(outcome.failure_count, 0);
});

/** A refused row keeps its null embedding for the next run; it never blocks the review itself. */
test('reports a failed photo embedding and still reviews the assignment', async () => {
	const selected = assignment('assignment-embedding-failed');
	const harness = automationHarness({
		assignments: [selected],
		embeddingPasses: [
			{ selected: 3, embedded: 1, failed: 2, issues: ['provider refused two rows'] }
		]
	});
	const outcome = await runAutomation(harness.api);

	assert.equal(outcome.counts.embedded_photos, 1);
	assert.equal(outcome.counts.embedding_failed, 2);
	assert.equal(outcome.counts.checked, 1);
	assert.equal(outcome.failure_count, 0);
});

/**
 * The duplicate net separates the two facts the prompt distinguishes: the same file under another
 * assignment is `exact_duplicate` (byte-identical, SHA-256), while a merely similar image is
 * `visual_duplicate`. Both name the matched rows so the review can cite them.
 */
test('reports a byte-identical foreign photo as exact_duplicate and a near match as visual_duplicate', async () => {
	const selected = assignment('assignment-reuse');
	const photo = pendingPhoto(selected.id);
	const bytes = solidJpeg();
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const foreignRow = (id: string, candidateSha: string) => ({
		id,
		photo: {
			storage_key: `photos/${id}.jpg`,
			file_name: `${id}.jpg`,
			file_size: 1,
			mime_type: 'image/jpeg'
		},
		sha256: candidateSha,
		flags: [],
		matched_evidence_ids: [],
		created_at: null,
		job_assignment_id: 'assignment-other',
		variation_request_id: null
	});
	const harness = automationHarness({
		assignments: [selected],
		assignmentPhotos: [photo],
		pendingPhotos: [photo],
		photoBytes: bytes,
		nearest: [foreignRow('photo-identical', sha256), foreignRow('photo-similar', 'other-sha')]
	});
	await runAutomation(harness.api);

	const update = harness.photoUpdates[0];
	const flags = update?.flags as ReadonlyArray<string>;
	assert.ok(flags.includes('exact_duplicate'), `flags: ${JSON.stringify(flags)}`);
	assert.ok(flags.includes('visual_duplicate'), `flags: ${JSON.stringify(flags)}`);
	assert.deepEqual([...(update?.matched_evidence_ids as ReadonlyArray<string>)].sort(), [
		'photo-identical',
		'photo-similar'
	]);
});

/**
 * A WhatsApp document carries no image mime type. The bytes decide the format, and the stored
 * descriptor is corrected so the inference turn attaches it as the image it is.
 */
test('inspects a photo filed as application/octet-stream by its bytes and normalises its mime', async () => {
	const selected = assignment('assignment-document');
	const photo = {
		...pendingPhoto(selected.id),
		photo: { ...pendingPhoto(selected.id).photo, mime_type: 'application/octet-stream' }
	};
	const harness = automationHarness({
		assignments: [selected],
		assignmentPhotos: [photo],
		pendingPhotos: [photo],
		photoBytes: solidJpeg(),
		photoMimeType: 'application/octet-stream'
	});
	const outcome = await runAutomation(harness.api);

	assert.equal(outcome.counts.inspection_failed, 0);
	assert.equal(outcome.counts.inspected_photos, 1);
	const update = harness.photoUpdates[0];
	assert.ok(String(update?.sha256).length > 0, 'the hash was written');
	assert.deepEqual(update?.photo, { ...photo.photo, mime_type: 'image/jpeg' });
	assert.ok(
		!(update?.flags as ReadonlyArray<string>).includes('metadata_anomaly'),
		'a generic transport mime is not a metadata anomaly'
	);
	assert.equal(outcome.counts.checked, 1);
});

test('an assignment whose photo is still queued waits instead of failing the run', async () => {
	const selected = assignment('assignment-queued');
	const photo = pendingPhoto(selected.id);
	// The photo belongs to the assignment but this run inspected nothing: it is queued, not broken.
	const harness = automationHarness({ assignments: [selected], assignmentPhotos: [photo] });
	const outcome = await runAutomation(harness.api);

	assert.equal(outcome.counts.awaiting_inspection, 1);
	assert.equal(outcome.counts.failed, 0);
	assert.equal(outcome.failure_count, 0);
	assert.equal(outcome.inference_count, 0);
	assert.deepEqual(harness.updates, [], 'nothing is stamped checked');
});

/**
 * An unreadable photo keeps its empty hash, so the assignment fails closed at fact loading — the
 * same sentence it gave when the facts arrived from a separate automation. No inference is claimed.
 */
test('records an unreadable photo and leaves its assignment unchecked without an inference', async () => {
	const selected = assignment('assignment-unreadable');
	const photo = pendingPhoto(selected.id);
	const harness = automationHarness({
		assignments: [selected],
		assignmentPhotos: [photo],
		pendingPhotos: [photo]
	});
	const outcome = await runAutomation(harness.api);

	assert.equal(outcome.counts.inspected_photos, 0);
	assert.equal(outcome.counts.inspection_failed, 1);
	assert.equal(outcome.inference_count, 0);
	assert.equal(outcome.counts.failed, 1);
	assert.deepEqual(outcome.failure_details, [
		{ assignment_id: selected.id, stage: 'fact_loading' }
	]);
	assert.deepEqual(harness.updates, [], 'nothing is stamped checked');
});
