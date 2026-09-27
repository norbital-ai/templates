import { model } from '@norbital-ai/bolt';

/**
 * One photo filed against exactly one job assignment or variation request, with its integrity facts. A photo is born
 * uninspected (`sha256` empty, a zero `perceptual_embedding`); the suspicion review fills the facts from
 * `ctx.files.image`. Flags and similarity are evidence for a judgement, never a verdict.
 */
export default model({
	description:
		'One explicitly selected photo and its deterministic integrity facts, linked to exactly one job assignment or variation request. Flags and similarity are evidence for a later AI or human judgement, never suspicion by themselves.',
	icon: 'lucide:scan-search',
	label: 'summary',
	fields: {
		photo: {
			kind: 'file',
			accept: ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/octet-stream'],
			max: '20MiB'
		},
		/** A channel attachment is the same photo however often it is redelivered; an upload is its file. */
		source_key: { kind: 'text', unique: true, hidden: true },
		source: { kind: 'custom', of: 'photo_source' },
		sha256: { kind: 'text', hidden: true },
		/** Meta PDQ as a 256-dim 0/1 vector: L2 distance is √Hamming. */
		perceptual_embedding: { kind: 'vector', dim: 256, metric: 'l2', hidden: true },
		/** The scene (`ctx.ai.embed` of the photo), for cross-assignment reuse the pixel hash cannot see (crops, re-photographs). */
		scene_embedding: { kind: 'vector', dim: 256, metric: 'cosine', optional: true, hidden: true },
		flags: {
			kind: 'enum',
			many: true,
			values: [
				'exact_duplicate',
				'visual_duplicate',
				'metadata_anomaly',
				'edited_metadata',
				'low_quality',
				'missing_geolocation',
				'location_mismatch'
			]
		},
		/** Photos under other assignments this one duplicates. */
		matched_evidence_ids: { kind: 'text', many: true },
		/** The photo's title: where it came from. */
		summary: { kind: 'text' }
	}
});
