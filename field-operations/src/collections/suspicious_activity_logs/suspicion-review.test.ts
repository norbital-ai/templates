import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect, Schema } from 'effect';
import suspicionReviewAutomation from '../../automations/+review_job_assignment_suspicion.js';
import {
	ASSIGNMENT_PAGE_SIZE,
	MAX_INFERENCE_CONTEXT_CHARS,
	MAX_INFERENCE_EVIDENCE_ID_CHARS,
	MAX_INFERENCE_IMAGE_BYTES,
	MAX_INFERENCE_IMAGES,
	MAX_INFERENCE_REASON_CHARS,
	buildSuspicionInferenceContext,
	buildSuspicionReviewBasis,
	loadUncheckedAssignments,
	reviewSourceKey,
	selectSuspicionInferencePhotos,
	shouldCreateSuspicionLog,
	shouldReviewAssignment,
	suspicionInferenceSchema,
	suspicionPrompt,
	suspicionReviewHash,
	validDecisionEvidenceId,
	withinAssignmentExactShaGroups,
	type SuspicionReviewFacts
} from '../../automations/suspicion-review.js';
import { assertCommunicationUnchanged } from '../communication_logs/+hooks.js';
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
}) {
	const inferenceCounts = new Map<string, number>();
	const reviewCreateAttempts: Array<string> = [];
	const logCreates: Array<string> = [];
	const updates: Array<string> = [];
	const assignmentPageOffsets: Array<number> = [];
	const existingReviews = { ...options.existingReviews };
	const logsByReview: Record<string, { readonly id: string } | undefined> = {};
	const api = {
		progress: () => Effect.void,
		infer: (input: { readonly prompt: string }) => {
			const assignmentId = assignmentIdFromPrompt(input.prompt);
			inferenceCounts.set(assignmentId, (inferenceCounts.get(assignmentId) ?? 0) + 1);
			if (options.inferenceFailures?.has(assignmentId) === true) {
				return Effect.fail(new Error(`Inference failed for ${assignmentId}`));
			}
			const decision = options.decisions?.[assignmentId] ?? {
				suspicious: false,
				reason: 'The evidence does not justify a suspicion.'
			};
			return Effect.succeed({ ...decision, evidence_id: null });
		},
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
					readonly where?: { readonly id?: { readonly eq?: string } };
					readonly offset?: number;
					readonly limit?: number;
				}) => {
					const targeted = input.where?.id?.eq;
					if (targeted != null) {
						return Effect.succeed(options.assignments.filter(({ id }) => id === targeted));
					}
					const offset = input.offset ?? 0;
					assignmentPageOffsets.push(offset);
					return Effect.succeed(
						options.assignments.slice(offset, offset + (input.limit ?? ASSIGNMENT_PAGE_SIZE))
					);
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
			photo_evidence: { findMany: () => Effect.succeed([]) },
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
		assignmentPageOffsets,
		inferenceCounts,
		reviewCreateAttempts,
		logCreates,
		updates
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
	return Effect.runPromise(effect as Effect.Effect<RunResult, unknown, never>);
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
	assert.deepEqual(harness.assignmentPageOffsets, [0, ASSIGNMENT_PAGE_SIZE]);
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
	assert.match(suspicionPrompt(original), /Visual similarity is a neutral fact/);
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

	assert.deepEqual(
		selected.map(({ id }) => id),
		['photo-00', 'photo-04', 'photo-08']
	);
	assert.deepEqual(
		reordered.map(({ id }) => id),
		selected.map(({ id }) => id)
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

test('surfaces and attaches both files in the real Hillview within-assignment exact-SHA group', () => {
	const hillview: SuspicionReviewFacts = {
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

	assert.deepEqual(withinAssignmentExactShaGroups(hillview.photos), [
		{
			sha256: 'e1719c9ce6a505b20ac7c8ab5e4e3e67d8878c9db8b312ec0aaf427f942a714d',
			evidence_ids: ['019f6f10-5000-7000-8000-000000000022', '019f6f10-5000-7000-8000-000000000059']
		}
	]);

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
			within_assignment_exact_sha_group_count: number;
			within_assignment_exact_sha_photo_count: number;
			similarity_relationships: number;
			representative_photos: ReadonlyArray<{ readonly sha256: string }>;
		};
	};
	assert.equal(context.photo_summary.within_assignment_exact_sha_group_count, 1);
	assert.equal(context.photo_summary.within_assignment_exact_sha_photo_count, 2);
	assert.equal(context.photo_summary.similarity_relationships, 0);
	assert.deepEqual(
		context.photo_summary.representative_photos.map((photo) => photo.sha256),
		[
			'f7469fd88deda042989a8a87ff51f69fe796a88dcf6db0b6b8d9c9f401a60844',
			'e1719c9ce6a505b20ac7c8ab5e4e3e67d8878c9db8b312ec0aaf427f942a714d',
			'e1719c9ce6a505b20ac7c8ab5e4e3e67d8878c9db8b312ec0aaf427f942a714d'
		]
	);
	assert.match(suspicionPrompt(hillview, selected), /concrete duplicate-submission evidence/);
});

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
