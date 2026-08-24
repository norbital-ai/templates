import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from 'effect';
import {
	MAX_INFERENCE_CONTEXT_CHARS,
	MAX_INFERENCE_EVIDENCE_ID_CHARS,
	MAX_INFERENCE_IMAGE_BYTES,
	MAX_INFERENCE_IMAGES,
	MAX_INFERENCE_REASON_CHARS,
	buildSuspicionInferenceContext,
	buildSuspicionReviewBasis,
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
import {
	assertJudgementReferences,
	assertOpenJudgement,
	assertResolutionTransition,
	normalizeOpenJudgement
} from './+hooks.js';

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

test('reviews only assignments that are not completed', () => {
	assert.equal(shouldReviewAssignment('assigned'), true);
	assert.equal(shouldReviewAssignment('unassigned'), true);
	assert.equal(shouldReviewAssignment(null), true);
	assert.equal(shouldReviewAssignment('completed'), false);
	assert.equal(shouldReviewAssignment('assigned', '2026-08-24T01:00:00.000Z'), false);
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
	assert.match(suspicionPrompt(original), /similar photos are also neutral facts/);
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
