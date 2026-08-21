import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import {
	assertPhotoEvidenceProvenanceUnchanged,
	decodePhotoInspection,
	evaluateCaptureGeolocation,
	inspectPhoto,
	planDuplicateEvidenceBatch
} from './photo-integrity.js';

/** A `file()` value, which is what `photo` holds — the whole file, not a pointer to one. */
const photoFile = (name: string) => ({
	storage_key: `photos/${name}.jpg`,
	file_name: `${name}.jpg`,
	file_size: 1024,
	mime_type: 'image/jpeg'
});

const settledProvenance = {
	job_assignment_id: 'assignment-a',
	variation_request_id: null,
	photo: photoFile('asset-a'),
	source_key: 'whatsapp:conversation:attachment-a',
	source: {
		kind: 'channel',
		provider: 'whatsapp',
		conversation_id: 'conversation',
		attachment_id: 'attachment-a'
	}
};

test('keeps a settled photo, parent, and source immutable', () => {
	assert.doesNotThrow(() =>
		assertPhotoEvidenceProvenanceUnchanged({ job_assignment_id: 'assignment-a' }, settledProvenance)
	);
	for (const change of [
		{ job_assignment_id: 'assignment-b' },
		{ job_assignment_id: null, variation_request_id: 'variation-a' },
		{ photo: photoFile('asset-b') },
		{ source_key: 'workspace:asset-a' },
		{ source: { kind: 'workspace_upload' } }
	]) {
		assert.throws(
			() => assertPhotoEvidenceProvenanceUnchanged(change, settledProvenance),
			/provenance is immutable/
		);
	}
});

// A deterministic 3024x4032 JPEG (solid RGB 80/120/160). Gzip collapses the intentionally uniform
// fixture to a few hundred bytes while jpeg-js still has to exercise the full 12 MP decode envelope.
const canonical12MegapixelJpeg = gunzipSync(
	Buffer.from(
		'H4sIAAAAAAAAA+3NTU7CYBSG0e8D2kIlSkMtWDUQCVqMJOyAgXt0PQxcgEN/duKkwlB04tScM3zz5N72tf0IjyHtJWnSS9MkzbK0n4/yfDDIy9Oz4WhSTqeTsqrq6+WsvlxcVdX8Yb64vVvdry5m68262SybVXM4ErMsy/v5OM/HTV3VzZ+1u1D0z3YnL914EzpF7BaxfQ7nIcbwXbKfy9HxGg5x/D0ufsbvYdiN+zfdImzDU+ezOS4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+q2379gV8f33kHhgBAA==',
		'base64'
	)
);

test('inspects the canonical 12 MP phone-photo envelope deterministically', async () => {
	const inspection = await inspectPhoto({
		bytes: canonical12MegapixelJpeg,
		mimeType: 'image/jpeg'
	});

	assert.deepEqual(
		{
			sha256: inspection.sha256,
			perceptualHash: inspection.perceptualHash,
			width: inspection.width,
			height: inspection.height,
			flags: inspection.flags
		},
		{
			sha256: 'fd41dba0ff371735328979ec3b80992623b513173986e79c18b6323861e229d4',
			perceptualHash: '13a0113411341134000082001134000011341134554b2c4b2c4b11342c4b0000',
			width: 3024,
			height: 4032,
			flags: ['low_quality']
		}
	);
});

test('accepts only the immutable fact shape supplied by the host inspection cache', () => {
	assert.deepEqual(
		decodePhotoInspection({
			sha256: 'a'.repeat(64),
			perceptualHash: 'b'.repeat(64),
			width: 1440,
			height: 1920,
			captureLocation: null,
			flags: []
		}),
		{
			sha256: 'a'.repeat(64),
			perceptualHash: 'b'.repeat(64),
			width: 1440,
			height: 1920,
			captureLocation: null,
			flags: []
		}
	);
	assert.throws(() =>
		decodePhotoInspection({
			sha256: 'not-a-digest',
			perceptualHash: 'b'.repeat(64),
			width: 0,
			height: 1920,
			captureLocation: null,
			flags: ['invented-policy']
		})
	);
});

test('records missing and contradictory GPS as evidence without inventing a verdict', () => {
	assert.deepEqual(evaluateCaptureGeolocation(null, { lat: 1.3, lon: 103.8 }), [
		'missing_geolocation'
	]);
	assert.deepEqual(
		evaluateCaptureGeolocation({ lat: 1.3521, lon: 103.8198 }, { lat: 1.3001, lon: 103.8001 }),
		['location_mismatch']
	);
});

const zeros = Array.from({ length: 256 }, () => 0);
const near = zeros.with(0, 1).with(1, 1);
const far = Array.from({ length: 256 }, (_, index) => (index < 32 ? 1 : 0));

test('plans exact and visual reuse across prior and same-batch evidence in target order', () => {
	const updates = planDuplicateEvidenceBatch(
		[
			{
				id: 'prior',
				sha256: 'prior-sha',
				perceptualEmbedding: zeros,
				flags: [],
				assignmentId: 'assignment-prior'
			},
			{
				id: 'same-assignment',
				sha256: 'exact-sha',
				perceptualEmbedding: far,
				flags: [],
				assignmentId: 'assignment-a'
			},
			{
				id: 'first-target',
				sha256: 'exact-sha',
				perceptualEmbedding: near,
				flags: ['missing_geolocation'],
				assignmentId: 'assignment-a'
			},
			{
				id: 'second-target',
				sha256: 'exact-sha',
				perceptualEmbedding: far,
				flags: [],
				assignmentId: 'assignment-b'
			}
		],
		new Set(['first-target', 'second-target'])
	);

	assert.deepEqual(
		updates.map((update) => update.id),
		['first-target', 'second-target']
	);
	assert.deepEqual(updates[0]?.flags, [
		'missing_geolocation',
		'exact_duplicate',
		'visual_duplicate'
	]);
	assert.deepEqual(updates[0]?.matchedEvidenceIds, ['second-target', 'prior']);
	assert.deepEqual(updates[1]?.flags, ['exact_duplicate']);
	assert.deepEqual(updates[1]?.matchedEvidenceIds, ['same-assignment', 'first-target']);
});

test('does not flag same-assignment or above-threshold evidence', () => {
	const updates = planDuplicateEvidenceBatch(
		[
			{
				id: 'target',
				sha256: 'sha',
				perceptualEmbedding: zeros,
				flags: [],
				assignmentId: 'assignment-a'
			},
			{
				id: 'same-assignment',
				sha256: 'sha',
				perceptualEmbedding: zeros,
				flags: [],
				assignmentId: 'assignment-a'
			},
			{
				id: 'too-far',
				sha256: 'other',
				perceptualEmbedding: far,
				flags: [],
				assignmentId: 'assignment-b'
			}
		],
		new Set(['target'])
	);

	assert.deepEqual(updates[0]?.flags, []);
	assert.deepEqual(updates[0]?.matchedEvidenceIds, []);
});

test('retains the indexed single-hook exact and visual candidate caps', () => {
	const target = {
		id: 'target',
		sha256: 'target-sha',
		perceptualEmbedding: zeros,
		flags: [],
		assignmentId: 'target-assignment'
	};
	const exact = Array.from({ length: 25 }, (_, index) => ({
		id: `exact-${index}`,
		sha256: 'target-sha',
		perceptualEmbedding: far,
		flags: [],
		assignmentId: `exact-assignment-${index}`
	}));
	const visual = Array.from({ length: 60 }, (_, index) => ({
		id: `visual-${index}`,
		sha256: `visual-sha-${index}`,
		perceptualEmbedding: near,
		flags: [],
		assignmentId: `visual-assignment-${index}`
	}));

	const [update] = planDuplicateEvidenceBatch([target, ...exact, ...visual], new Set(['target']));

	assert.equal(update?.matchedEvidenceIds.filter((id) => id.startsWith('exact-')).length, 20);
	assert.equal(update?.matchedEvidenceIds.filter((id) => id.startsWith('visual-')).length, 50);
});

test('finds cross-assignment exact reuse after many same-assignment copies', () => {
	const sameAssignment = Array.from({ length: 25 }, (_, index) => ({
		id: `same-${index}`,
		sha256: 'shared-sha',
		perceptualEmbedding: far,
		flags: [],
		assignmentId: 'assignment-a'
	}));
	const [update] = planDuplicateEvidenceBatch(
		[
			{
				id: 'target',
				sha256: 'shared-sha',
				perceptualEmbedding: zeros,
				flags: [],
				assignmentId: 'assignment-a'
			},
			...sameAssignment,
			{
				id: 'cross-assignment',
				sha256: 'shared-sha',
				perceptualEmbedding: far,
				flags: [],
				assignmentId: 'assignment-b'
			}
		],
		new Set(['target'])
	);

	assert.ok(update?.flags.includes('exact_duplicate'));
	assert.ok(update?.matchedEvidenceIds.includes('cross-assignment'));
});
