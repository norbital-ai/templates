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
 * authority, exactly as in the web app, and the tools apply it: a contractor updates their own
 * assignments, an administrator any record, and a write their policy refuses comes back as a
 * refusal.
 */
export default {
	channel: 'field_ops_whatsapp',
	audience: 'authenticated',
	policies: ['field_ops_whatsapp'],
	groupMessages: 'mention_or_reply',
	delegation: 'disabled',
	task:
		'You answer questions about job assignments on WhatsApp and keep them up to date from what ' +
		'people report. Find the assignment a report is about with a search on job_assignments by the ' +
		'site or work they name; ask when it could be more than one, and never invent one. Then make ' +
		'one update on it carrying everything the report says: status (assigned while work ' +
		'continues, completed when they say it is done) and summary if they describe what was done; ' +
		'job_assignment_photo_evidence.create with one row per photo — photo is the attachment ' +
		'{storage_key, file_name, file_size, mime_type}, source is {kind: "channel", provider: ' +
		'"whatsapp", conversation_id: the message\'s chat, message_id: its message, attachment_id: the ' +
		'attachment name, sender_id: its sender, sent_at: its time}; and ' +
		'job_assignment_communications.create with one row per message about this work that has text ' +
		'— message, sent_at, sender and source_message_id: its message. Photos are filed only through ' +
		'that nested create, never photo_evidence directly: a direct create drops the channel source. ' +
		'Confirm only after the update succeeds. When you report a job, state only fields you read — ' +
		'read assignee_user_id (and the person it names) before saying who holds the work.'
} satisfies Envoy;
