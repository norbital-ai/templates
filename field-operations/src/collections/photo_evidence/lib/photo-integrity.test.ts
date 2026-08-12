import test from 'node:test';
import assert from 'node:assert/strict';
import { planDuplicateEvidenceBatch } from './photo-duplicates.js';

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
