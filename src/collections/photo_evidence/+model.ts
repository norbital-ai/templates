import {
	custom,
	defineModel,
	enums,
	file,
	sql,
	text,
	uuid,
	vector
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		job_assignment_id: uuid(),
		variation_request_id: uuid(),
		photo: file({ mimeTypes: ['image/jpeg', 'image/png'] }).notNull(),
		source_key: text().notNull(),
		source: custom('photo_source').notNull(),
		sha256: text().notNull(),
		/** Meta PDQ as a 256-dim 0/1 embedding — same `vector` + `findNearest` path as omni embeds. */
		perceptual_embedding: vector({ dimensions: 256 }).notNull(),
		flags: enums([
			'visual_duplicate',
			'metadata_anomaly',
			'edited_metadata',
			'low_quality',
			'missing_geolocation',
			'location_mismatch'
		])
			.array()
			.notNull(),
		matched_evidence_ids: uuid().array().notNull(),
		/**
		 * The photo's own title, composed in SQL.
		 *
		 * `recordLabel` compiles to a CEL concatenation and CEL has no `+` overload for anything but
		 * strings, so naming `source` — a variant, an object — resolved to nothing and the record
		 * title fell back to joining every scalar column, which printed `job_assignment_id` and the
		 * hashes. No coercion turns an object into a title; where the photo came from is the answer.
		 */
		summary: text({ search: true }).generatedAlwaysAs(
			sql`CASE source ->> 'kind'
				WHEN 'workspace_upload' THEN 'Workspace upload'
				WHEN 'channel' THEN 'From ' || COALESCE(NULLIF(source ->> 'provider', ''), 'a channel') || COALESCE(' · ' || LEFT(source ->> 'sent_at', 10), '')
				ELSE 'Photo'
			END`
		)
	},
	{
		description:
			'One explicitly selected photo and its deterministic integrity facts, linked to exactly one job assignment or variation request. Flags and similarity are evidence for a later AI or human judgement, never suspicion by themselves.',
		/**
		 * The photograph itself, as one vector over the record.
		 *
		 * `perceptual_embedding` cannot answer the question this collection exists to ask. PDQ is a
		 * near-duplicate hash: measured against this corpus, a genuine reuse — 58 Kismis Avenue's
		 * ceiling re-submitted under 18 Lorong Pisang Udang as a crop from a different phone — sits at
		 * 116 bits, while unrelated cross-job pairs bottom out at 88. There is no threshold between
		 * them, so no perceptual band can nominate the pair without nominating thousands of strangers.
		 * A learned embedding compares the scene rather than the pixel layout, which is the only thing
		 * that separates those two facts.
		 *
		 * The photo alone: `summary` is generated from `source` and reads "Workspace upload" or
		 * "Photo" on nearly every row, so including it would add a constant to every vector and pull
		 * the whole collection together.
		 */
		embedding: { fields: ['photo'], dimensions: 256 },
		recordLabel: 'summary',
		icon: 'lucide:scan-search',
		indexes: [
			{ columns: ['source_key'], unique: true },
			{
				name: 'photo_evidence_pdq_hnsw',
				method: 'hnsw',
				columns: ['perceptual_embedding'],
				opclass: { perceptual_embedding: 'vector_l2_ops' }
			}
		]
	}
);
