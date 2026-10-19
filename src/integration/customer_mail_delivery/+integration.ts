import { integration } from '@norbital-ai/bolt';
/**
 * The business's own mailbox for customer notices, connected by an administrator in Settings → Integrations (IMAP + SMTP).
 * Every notice filed for a customer with an email address queues its message in the same transaction, and what the mailbox
 * reports lands on the notice: sent, deferred while the server retries, delivered (or presumed so), opened (when open
 * tracking is on), bounced or failed with the reason, and replied. An automatic answer (out of office) is kept apart.
 */
const mail = integration('customer_mail_delivery', {
	description: 'Customer notices from the business mailbox.',
	driver: 'email',
	outbound: { notices: { from: 'customer_notices', on: 'create', via: 'customer_mail' } }
});
mail.outbound('notices', {
	build: (record) =>
		record.to_address === null
			? null
			: { to: [record.to_address], subject: record.subject, text: record.body, thread: record.id },
	events: {
		sent: ({ at }) => ({ delivery: 'sent' as const, sent_at: at }),
		deferred: ({ code, reason }) => ({
			delivery: 'deferred' as const,
			delivery_reason: reason ?? code ?? null
		}),
		delivered: ({ at, presumed }) => ({
			delivery: 'delivered' as const,
			delivered_at: at,
			delivery_presumed: presumed === true
		}),
		opened: ({ at }) => ({ delivery: 'opened' as const, opened_at: at }),
		bounced: ({ code, reason }) => ({
			delivery: 'bounced' as const,
			delivery_reason: reason ?? code ?? null
		}),
		failed: ({ code, reason }) => ({
			delivery: 'failed' as const,
			delivery_reason: reason ?? code ?? null
		}),
		auto_replied: ({ at }) => ({ auto_replied_at: at }),
		replied: ({ reply }) => ({
			delivery: 'replied' as const,
			replied_at: reply.sentAt,
			reply_excerpt: reply.text.slice(0, 500)
		})
	}
});
export default mail;
