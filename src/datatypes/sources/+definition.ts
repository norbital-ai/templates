import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The official pages a settings version was transcribed from. The statutory drift
 * automation reads them monthly for the version in force and proposes a draft when a statutory row
 * differs. Sources are inlined, not a collection: they belong to the version they evidence.
 *
 * `instructions` is the operator's navigation note for the research agent: which site holds which
 * table, the path shapes that carry it, and which official documents the reader cannot open (over
 * 2 MB, scanned, behind a browser challenge) and where the same figures stand in HTML. It is put
 * in the agent's prompt verbatim, so it is written to the agent, not about the version.
 */
const sourcesValueSchema = Schema.Struct({
	urls: Schema.Array(
		Schema.String.check(
			Schema.isPattern(/^https?:\/\//, {
				message: 'A source is a page a person can read: an http(s) URL.'
			})
		)
	),
	instructions: Schema.optionalKey(Schema.String)
});

export type Sources = Schema.Schema.Type<typeof sourcesValueSchema>;

export default defineCustomType({
	name: 'sources',
	description: 'The official pages one jurisdiction settings version was transcribed from.',
	schema: Schema.toStandardSchemaV1(sourcesValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
