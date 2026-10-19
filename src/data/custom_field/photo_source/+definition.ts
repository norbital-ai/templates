import { customField } from '@norbital-ai/bolt';
/** Where a photo came from: a workspace upload, or the integration message and attachment that delivered it. */
const photo_source = customField({
	description:
		'Where a photo came from: either a workspace upload, or the messaging conversation, message, attachment and sender that delivered it.',
	shape: {
		kind: 'union',
		by: 'kind',
		arms: {
			workspace_upload: {},
			message: {
				integration: { kind: 'text' },
				conversation_id: { kind: 'text' },
				message_id: { kind: 'text' },
				attachment_id: { kind: 'text' },
				sender_id: { kind: 'text' },
				sent_at: { kind: 'instant', optional: true }
			}
		}
	}
});
export default photo_source;
photo_source.validate((value) =>
	value.kind === 'message' &&
	[
		value.integration,
		value.conversation_id,
		value.message_id,
		value.attachment_id,
		value.sender_id
	].some((part) => part.trim() === '')
		? 'A message photo source names its integration, conversation, message, attachment and sender.'
		: undefined
);
