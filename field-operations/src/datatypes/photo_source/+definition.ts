import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/** A UTC-offset ISO 8601 datetime as the messaging channel reports one. */
const channelInstant = Schema.String.check(
	Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/),
	Schema.makeFilter((value: string) => {
		const parsed = new Date(value);
		return !Number.isNaN(parsed.getTime()) || 'must be a valid datetime';
	})
);

export const photoSourceValueSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('workspace_upload') }),
	Schema.Struct({
		kind: Schema.Literal('channel'),
		provider: Schema.NonEmptyString,
		conversation_id: Schema.NonEmptyString,
		message_id: Schema.NonEmptyString,
		attachment_id: Schema.NonEmptyString,
		sender_id: Schema.NonEmptyString,
		sent_at: Schema.NullOr(channelInstant)
	})
]);

export const photoSourceSchema = Schema.toStandardSchemaV1(photoSourceValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'photo_source',
	description:
		'Where a photo came from: either a workspace upload, or the messaging conversation, message, attachment and sender that delivered it.',
	schema: photoSourceSchema
});
