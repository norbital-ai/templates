import { model } from '@norbital-ai/bolt';
import {
	photoSourceKey,
	photoSummary,
	uninspectedPhotoFacts
} from '../../../lib/photo-integrity.js';
const PROBE = { vector: { kind: 'list', of: { kind: 'number' } } } as const;
/**
 * One photo filed against one job assignment, with its integrity facts. A photo is born
 * uninspected (`sha256` empty, a zero `perceptual_embedding`); the suspicion review fills the facts from
 * `ctx.files.image`, or, when the host cannot read it, records the failure and judges the rest. Flags and similarity
 * are evidence for a judgement, never a verdict.
 *
 * A photo created here directly is a workspace upload: `source` is no create column. A message photo arrives through its
 * assignment's update, whose `job_assignments.photo_evidence` layer states the message `source`. Provenance (the file, the
 * parent, the source and its key) never changes; the facts may. The indexes read the vectors the review writes (image facts need the host).
 */
export default model('photo_evidence', {
	description:
		'One explicitly selected photo and its deterministic integrity facts, linked to one job assignment. Flags and similarity are evidence for a later AI or human judgement, never suspicion by themselves.',
	icon: 'lucide:scan-search',
	label: 'summary',
	fields: {
		job_assignment_id: {
			kind: 'ref',
			to: 'job_assignments',
			inverse: 'photo_evidence',
			optional: true
		},
		photo: {
			kind: 'file',
			accept: ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/octet-stream'],
			max: '20MiB'
		},
		/** A message attachment is the same photo however often it is redelivered; an upload is its file. */
		source_key: { kind: 'text', unique: true, hidden: true },
		source: { kind: 'custom', of: 'photo_source' },
		sha256: { kind: 'text', hidden: true },
		/** Set when the host refuses to read the photo: a failed photo is never re-inspected or waited for. */
		inspection_failed_at: { kind: 'instant', optional: true, hidden: true },
		/** The host's bounded refusal reason, kept beside the marker. */
		inspection_failure_reason: { kind: 'text', optional: true, hidden: true },
		/** When a run took the photo's one inspection: runs that read it pending meanwhile leave it to that run. */
		inspection_claimed_at: { kind: 'instant', optional: true, hidden: true },
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
		matched_evidence_ids: { kind: 'text', many: true, hidden: true },
		/** The photo's title: where it came from. */
		summary: { kind: 'text' }
	},
	search: {
		text: [],
		indexes: {
			pdq: {
				description: 'Photos nearest a PDQ vector: near-duplicates of the same pixels.',
				dim: 256,
				metric: 'l2',
				vector: 'perceptual_embedding',
				input: PROBE,
				probe: (input) => ({ vector: input.vector })
			},
			scene: {
				description:
					'Photos nearest a scene embedding: the same place photographed again, cropped or re-shot.',
				dim: 256,
				metric: 'cosine',
				vector: 'scene_embedding',
				input: PROBE,
				probe: (input) => ({ vector: input.vector })
			}
		}
	},
	read: {
		photo_evidence: { fields: 'all' },
		/**
		 * The job a photo was filed against: its title (the review panel's other-assignment photos) and its site (a
		 * `where` hop through this layer, e.g. the site handover).
		 */
		'photo_evidence.job_assignment_id': { fields: ['title', 'site_id'] }
	},
	outputs: {
		/** A contractor's view of their photos: the picture and its summary, never its forensic facts. */
		contractor: { photo_evidence: { fields: ['job_assignment_id', 'photo', 'summary'] } }
	},
	create: {
		columns: { photo_evidence: ['job_assignment_id', 'photo'] },
		transform: function* (rows, ctx) {
			const orphan = rows.findIndex((row) => row.job_assignment_id == null);
			if (orphan >= 0)
				return yield* ctx.refuse('Photo evidence must reference a job assignment.', {
					row: orphan
				});
			return rows.map((row) => {
				const source = row.source ?? ({ kind: 'workspace_upload' } as const);
				return {
					...row,
					source,
					source_key: photoSourceKey(source, String(row.photo.id)),
					summary: photoSummary(source),
					...uninspectedPhotoFacts()
				};
			});
		}
	},
	update: {
		columns: {
			photo_evidence: [
				'sha256',
				'inspection_failed_at',
				'inspection_failure_reason',
				'inspection_claimed_at',
				'perceptual_embedding',
				'scene_embedding',
				'flags',
				'matched_evidence_ids'
			]
		}
	},
	delete: {},
	effect: {
		// a filed photo is born uninspected: the sweep fills its facts (the filer may start it, `policy.automations`)
		created: function* (_rows, ctx) {
			yield* ctx.schedule('inspect_photo_evidence', {}, { key: 'inspect_photo_evidence' });
		}
	}
});
