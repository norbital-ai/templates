import { documentForPdf } from '../lib/document-layout.js';
import { automation, is_instance } from '@norbital-ai/bolt';
import { conversationId, workspaceMail } from '../lib/conversations.js';
import { documentRead, preview } from '../lib/documents.js';

/**
 * A message to a client: a reply in a thread (by mail in its mail thread, by WhatsApp in its chat), or a new mail to a
 * contact, which opens a thread filed under them. With a catalogue `template`, the mail is that template filled for the
 * contact's company (and `project`): an outreach email is the mail itself; a document is rendered to PDF and attached,
 * refused while a value it requires is missing, and its PDF also reaches the member who sent it.
 */
export default automation({
	description:
		'Sends a reply in a client thread, a new email to a contact, or a catalogue document (as PDF) or outreach email.',
	input: {
		activity: { kind: 'ref', to: 'activities', optional: true },
		contact: { kind: 'ref', to: 'contacts', optional: true },
		template: { kind: 'text', optional: true },
		project: { kind: 'ref', to: 'projects', optional: true },
		subject: { kind: 'text', optional: true },
		text: { kind: 'text', optional: true }
	},
	policies: ['hq_automation'],
	run: function* (input, ctx) {
		const text = input.text?.trim() ?? '';
		if (text === '' && input.template == null) return yield* ctx.refuse('errors.message_empty');
		if (input.activity != null) {
			const thread =
				(yield* ctx.query({
					activities: {
						where: { id: { eq: input.activity } },
						fields: ['subject', 'handle'],
						limit: 1,
						source_message: { fields: ['conversation', 'integration'] }
					}
				})).activities.rows[0] ?? null;
			if (thread === null || thread.source_message == null)
				return yield* ctx.refuse('errors.conversation_missing');
			// a reply goes out through the workspace connection the conversation is on, never another account
			const on = thread.source_message.integration;
			const account =
				on === null
					? undefined
					: (yield* ctx.query({
							sys_integration: {
								where: { id: { eq: on }, owner: { is_null: true } },
								fields: ['integration'],
								limit: 1
							}
						})).sys_integration.rows[0];
			if (
				account === undefined ||
				!(is_instance('email', account) || is_instance('whatsapp', account))
			)
				return yield* ctx.refuse('errors.personal_no_reply');
			// a thread's conversation is the connection's own row: its id is what a chat reply is addressed to
			const key = thread.source_message.conversation;
			const chat =
				key === null
					? undefined
					: (yield* ctx.query({
							sys_conversation: {
								where: { id: { eq: conversationId(key) } },
								fields: ['thread'],
								limit: 1
							}
						})).sys_conversation.rows[0];
			if (chat === undefined) return yield* ctx.refuse('errors.conversation_missing');
			const conversation = chat.id;
			if (is_instance('whatsapp', account)) {
				yield* ctx.send(account.id, { to: conversation, text });
				return;
			}
			yield* ctx.send(account.id, {
				to: [thread.handle ?? ''],
				subject: thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`,
				text,
				...(chat?.thread == null ? {} : { thread: chat.thread })
			});
			return;
		}
		if (input.contact == null) return yield* ctx.refuse('errors.recipient_missing');
		const contact =
			(yield* ctx.query({
				contacts: {
					output: 'crm',
					where: { id: { eq: input.contact } },
					fields: ['email', 'company_id'],
					limit: 1
				}
			})).contacts.rows[0] ?? null;
		if (!contact?.email) return yield* ctx.refuse('errors.contact_no_email');
		const mailbox = yield* workspaceMail(ctx);
		if (mailbox === null) return yield* ctx.refuse('errors.mailbox_missing');
		if (input.template == null || contact.company_id == null) {
			const subject = input.subject?.trim() || 'Workspace update';
			yield* ctx.send(mailbox, { to: [contact.email], subject, text });
			return;
		}
		const data = yield* ctx.query(
			documentRead(input.template, contact.company_id, input.project ?? null)
		);
		const filled = preview(data, ctx.today, contact.id);
		const template = filled.template;
		if (template === undefined) return yield* ctx.refuse('errors.template_missing');
		if (template.scope === 'project' && input.project == null)
			return yield* ctx.refuse('errors.document_needs_job', { field: 'project' });
		if (filled.missing.length > 0)
			return yield* ctx.refuse('errors.template_values_missing', {
				values: { names: filled.missing.join(', ') }
			});
		const subject = input.subject?.trim() || filled.subject || template.title;
		if (template.kind !== 'document') {
			yield* ctx.send(mailbox, { to: [contact.email], subject, text: text || filled.body });
			return;
		}
		const name = `${template.title} — ${filled.values['company'] ?? ''}.pdf`;
		const signature = data.agreement_settings.rows[0]?.provider_signature;
		const pdf = yield* ctx.convert.document(
			{
				markdown: documentForPdf(
					filled.body,
					signature ? { mime: signature.mime, bytes: yield* ctx.files.get(signature) } : undefined
				)
			},
			{ to: 'pdf', name, for: 'send_message' }
		);
		yield* ctx.send(mailbox, {
			to: [contact.email],
			subject,
			text: text || `Please find the ${template.title} attached for review and signature.`,
			attachments: [pdf]
		});
		const trigger = ctx.trigger;
		if (trigger.kind === 'person' && trigger.actor.kind === 'member')
			yield* ctx.notify({
				to: [{ user: trigger.actor.id }],
				title: `${template.title} sent to ${contact.email}`,
				attachments: [pdf],
				once: `document:${ctx.trigger.id}`
			});
	}
});
