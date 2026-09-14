import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The official pages a settings version was transcribed from (RFC 0001 §4). The statutory drift
 * automation reads them monthly for the version in force and proposes a draft when a statutory row
 * differs. Sources are inlined, not a collection: they belong to the version they evidence.
 */
export const sourcesValueSchema = Schema.Struct({
	urls: Schema.Array(
		Schema.String.check(
			Schema.isPattern(/^https?:\/\//, {
				message: 'A source is a page a person can read: an http(s) URL.'
			})
		)
	)
});

export type Sources = Schema.Schema.Type<typeof sourcesValueSchema>;

export default defineCustomType({
	name: 'sources',
	description: 'The official pages one jurisdiction settings version was transcribed from.',
	schema: Schema.toStandardSchemaV1(sourcesValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
