import { collection } from '@norbital-ai/bolt';
import {
	exactlyOneParent,
	photoSourceKey,
	photoSummary,
	provenanceChange,
	uninspectedPhotoFacts
} from '../../../lib/photo-integrity.js';

/**
 * A photo filed here is a workspace upload (channel photos arrive through their assignment's nested create, which
 * states the channel `source`). It is born uninspected; the suspicion review fills the facts. Provenance (the file,
 * the parent, the source and its key) never changes; the facts may.
 */
const photo_evidence = collection('photo_evidence', {
	read: { fields: 'all' },
	create: { input: { columns: ['job_assignment_id', 'variation_request_id', 'photo', 'source'] } },
	update: {
		input: {
			columns: [
				'job_assignment_id',
				'variation_request_id',
				'photo',
				'source',
				'source_key',
				'sha256',
				'inspection_failed_at',
				'inspection_failure_reason',
				'perceptual_embedding',
				'scene_embedding',
				'flags',
				'matched_evidence_ids'
			]
		}
	},
	delete: {},
	similarity: {
		pdq: {
			description: 'Photos nearest a PDQ vector: near-duplicates of the same pixels.',
			input: { vector: { kind: 'list', of: { kind: 'number' } } }
		},
		scene: {
			description:
				'Photos nearest a scene embedding: the same place photographed again, cropped or re-shot.',
			input: { vector: { kind: 'list', of: { kind: 'number' } } }
		}
	}
});
export default photo_evidence;

photo_evidence.transform(async (inputs, ctx) =>
	inputs.map((input, i) => {
		const stored = ctx.existing[i];
		if (stored !== undefined) {
			const change = provenanceChange(input, stored);
			if (change !== undefined) ctx.refuse(change);
			return input;
		}
		if (!exactlyOneParent(input.job_assignment_id, input.variation_request_id))
			ctx.refuse('Photo evidence must reference exactly one job assignment or variation request.');
		const photo = input.photo ?? ctx.refuse('Photo evidence names no photo.', { field: 'photo' });
		// every create through this surface is a workspace upload, whatever it claims
		const source = { kind: 'workspace_upload' } as const;
		return {
			...input,
			source,
			source_key: photoSourceKey(source, String(photo.id)),
			summary: photoSummary(source),
			...uninspectedPhotoFacts()
		};
	})
);

photo_evidence.similarity('pdq', {
	probe: (input) => ({ field: 'perceptual_embedding', vector: input.vector })
});
photo_evidence.similarity('scene', {
	probe: (input) => ({ field: 'scene_embedding', vector: input.vector })
});
