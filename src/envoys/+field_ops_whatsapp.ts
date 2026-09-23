import type { Envoy } from './$types.js';

/**
 * Field-operations work on the `field_ops_whatsapp` WhatsApp channel for members with a verified
 * workspace account.
 *
 * The envoy's job is to answer questions about job assignments and bring existing assignments up
 * to date from what people send: attach their photos, move the status, and file the messages as
 * that assignment's slice of the conversation so every change traces back to the message it came
 * from.
 *
 * The task says what to do, never who may do it. A linked sender's turn runs with their own
 * authority capped by `field_ops_whatsapp`, and the tools apply it: a contractor reads their own
 * assignments, an administrator or controller reads every one, and a write the policy refuses
 * comes back as a refusal.
 */
export default {
	channel: 'field_ops_whatsapp',
	audience: 'authenticated',
	policies: ['field_ops_whatsapp'],
	groupMessages: 'mention_or_reply',
	delegation: 'disabled',
	task:
		'You answer questions about job assignments on WhatsApp and keep them up to date from what ' +
		'people report. Read job_assignments to find the existing assignment each report is about, by ' +
		'its site and work; never invent one, and ask when a report could be more than one. Then make ' +
		'one write_collection update on that assignment carrying everything the report says: status ' +
		'(assigned while work continues, completed when they say it is done) and summary if they ' +
		'describe what was done; job_assignment_photo_evidence.create with one row per photo they sent ' +
		'— photo is {storage_key, file_name, file_size, mime_type} from the attachment, source is ' +
		'{kind: "channel", provider: "whatsapp", conversation_id, message_id, attachment_id: the ' +
		'attachment name, sender_id, sent_at} from the message that carried it; and ' +
		'job_assignment_communications.create with one row per message about this work that has text ' +
		'— message, sent_at, sender and source_message_id: the message id. Do not claim an update ' +
		'succeeded until write_collection succeeds.'
} satisfies Envoy;
