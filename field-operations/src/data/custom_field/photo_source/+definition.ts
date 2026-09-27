import { customField } from '@norbital-ai/bolt';

/** Where a photo came from: a workspace upload, or the channel message and attachment that delivered it. */
const photo_source = customField({
	description:
		'Where a photo came from: either a workspace upload, or the messaging conversation, message, attachment and sender that delivered it.',
	shape: {
		kind: 'union',
		by: 'kind',
		arms: {
			workspace_upload: {},
			channel: {
				provider: { kind: 'text' },
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
	value.kind === 'channel' &&
	[
		value.provider,
		value.conversation_id,
		value.message_id,
		value.attachment_id,
		value.sender_id
	].some((part) => part.trim() === '')
		? 'A channel photo source names its provider, conversation, message, attachment and sender.'
		: undefined
);
