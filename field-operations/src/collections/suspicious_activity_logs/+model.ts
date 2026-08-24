import { defineModel, enums, instant, sql, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		job_assignment_id: uuid().notNull(),
		/** Stable origin key derived from immutable judgement inputs, never supplied by a form. */
		source_key: text()
			.notNull()
			.generatedAlwaysAs(sql`origin || ':' || job_assignment_id::text || ':' || md5(basis)`),
		origin: enums(['automation', 'human']).notNull().default('human'),
		/** Canonical facts on which this judgement was made. Written once and never edited. */
		basis: text(),
		/** Optional durable inference review that caused this log. */
		review_id: uuid(),
		/** Optional primary photo cited by the judge; the full fact set remains in `basis`. */
		evidence_id: uuid(),
		/** The AI or authorized controller's judgement. Written when raised, never edited. */
		reason: text({ search: true }).notNull(),
		/**
		 * What a controller concluded, and the only thing that closes a log.
		 *
		 * Null while open. A log is not a flag to be cleared — somebody has to say whether the
		 * suspicion was correct, and that sentence is the record. Clearing it silently would leave the
		 * next reader unable to tell "looked at and fine" from "nobody has looked".
		 */
		resolution: text({ search: true }),
		resolved_at: instant(),
		resolved_by: uuid()
	},
	{
		description:
			'An AI or authorized-human suspicion judgement against one job assignment, with immutable evidence basis and an explicit controller resolution.',
		recordLabel: 'reason',
		icon: 'lucide:shield-alert',
		indexes: [
			{ columns: ['source_key'], unique: true },
			{ columns: ['job_assignment_id'] },
			{ columns: ['resolved_at'] },
			{ columns: ['review_id'] }
		]
	}
);
