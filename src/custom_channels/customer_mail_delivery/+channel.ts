import { channel } from '@norbital-ai/bolt';

/**
 * The business's own mailbox for customer notices, connected by an administrator in Settings → Integrations (IMAP + SMTP).
 * Every notice filed for a customer with an email address is mailed in the same transaction, and what the mailbox
 * reports lands on the notice: sent, deferred while the server retries, delivered (or presumed so), opened (when open
 * tracking is on), bounced or failed with the reason, and replied. An automatic answer (out of office) is kept apart.
 */
export default channel({
	transport: 'email',
	policies: ['notice_mail'],
	outbound: {
		notices: {
			from: 'customer_notices',
			on: 'create',
			message: ({ record }) =>
				record.to_address === null
					? null
					: {
							to: [record.to_address],
							subject: record.subject,
							text: record.body,
							thread: record.id
						}
		}
	},
	events: {
		sent: ({ at }) => ({ delivery: 'sent', sent_at: at }),
		deferred: ({ code, reason }) => ({
			delivery: 'deferred',
			delivery_reason: reason ?? code ?? null
		}),
		delivered: ({ at, presumed }) => ({
			delivery: 'delivered',
			delivered_at: at,
			delivery_presumed: presumed === true
		}),
		opened: ({ at }) => ({ delivery: 'opened', opened_at: at }),
		bounced: ({ code, reason }) => ({
			delivery: 'bounced',
			delivery_reason: reason ?? code ?? null
		}),
		failed: ({ code, reason }) => ({ delivery: 'failed', delivery_reason: reason ?? code ?? null }),
		auto_replied: ({ at }) => ({ auto_replied_at: at }),
		replied: ({ reply }) => ({
			delivery: 'replied',
			replied_at: reply.sentAt,
			reply_excerpt: reply.text.slice(0, 500)
		})
	}
});
