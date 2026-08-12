import type { PhotoIntegrityFlag } from './photo-integrity.js';

const PHOTO_INTEGRITY_FLAGS = [
	'exact_duplicate',
	'visual_duplicate',
	'metadata_anomaly',
	'edited_metadata',
	'low_quality',
	'missing_geolocation',
	'location_mismatch'
] as const satisfies readonly PhotoIntegrityFlag[];
const VISUAL_DUPLICATE_MAX_L2 = Math.sqrt(31);

export interface DuplicateEvidenceInput {
	readonly id: string;
	readonly sha256: string;
	readonly perceptualEmbedding: unknown;
	readonly flags: readonly unknown[];
	readonly assignmentId: string | null;
}

export interface DuplicateEvidenceUpdate {
	readonly id: string;
	readonly flags: PhotoIntegrityFlag[];
	readonly matchedEvidenceIds: string[];
	readonly assignmentId: string | null;
}

function parseEmbedding(value: unknown): number[] | null {
	if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) return value;
	if (typeof value !== 'string') return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'number')
			? parsed
			: null;
	} catch {
		return null;
	}
}

function squaredL2(left: readonly number[], right: readonly number[]): number | null {
	if (left.length !== right.length || left.length === 0) return null;
	let squaredDistance = 0;
	for (let index = 0; index < left.length; index += 1) {
		const difference = left[index]! - right[index]!;
		squaredDistance += difference * difference;
	}
	return squaredDistance;
}

/**
 * Plan duplicate flags for selected rows against one bounded corpus. The corpus includes both rows
 * that predated this createMany call and every row inserted by it, so cross-batch and within-batch
 * reuse have identical semantics without an indexed query per new photo.
 */
export function planDuplicateEvidenceBatch(
	corpus: readonly DuplicateEvidenceInput[],
	targetIds: ReadonlySet<string>
): DuplicateEvidenceUpdate[] {
	const embeddings = new Map(
		corpus.map((evidence) => [evidence.id, parseEmbedding(evidence.perceptualEmbedding)])
	);
	return corpus.flatMap((record) => {
		if (!targetIds.has(record.id)) return [];
		const flags = new Set<PhotoIntegrityFlag>(
			record.flags.filter(
				(flag): flag is PhotoIntegrityFlag =>
					typeof flag === 'string' && PHOTO_INTEGRITY_FLAGS.includes(flag as PhotoIntegrityFlag)
			)
		);
		const matchedEvidenceIds = new Set<string>();
		const exactCandidates = corpus
			.filter((candidate) => candidate.sha256 === record.sha256)
			.slice(0, 21);
		for (const candidate of exactCandidates) {
			if (candidate.id === record.id || candidate.assignmentId === record.assignmentId) continue;
			flags.add('exact_duplicate');
			matchedEvidenceIds.add(candidate.id);
		}
		const recordEmbedding = embeddings.get(record.id);
		const visualCandidates = recordEmbedding
			? corpus
					.filter((candidate) => candidate.id !== record.id)
					.flatMap((candidate) => {
						const candidateEmbedding = embeddings.get(candidate.id);
						const distance = candidateEmbedding
							? squaredL2(recordEmbedding, candidateEmbedding)
							: null;
						return distance != null && distance <= VISUAL_DUPLICATE_MAX_L2 * VISUAL_DUPLICATE_MAX_L2
							? [{ candidate, distance }]
							: [];
					})
					.sort((left, right) => left.distance - right.distance)
					.slice(0, 50)
			: [];
		for (const { candidate } of visualCandidates) {
			if (candidate.assignmentId === record.assignmentId || candidate.sha256 === record.sha256) {
				continue;
			}
			flags.add('visual_duplicate');
			matchedEvidenceIds.add(candidate.id);
		}
		return [
			{
				id: record.id,
				flags: [...flags],
				matchedEvidenceIds: [...matchedEvidenceIds],
				assignmentId: record.assignmentId
			}
		];
	});
}
