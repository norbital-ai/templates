import type { Envoy } from './$types.js';

/**
 * The sales desk, reached over Telegram by anyone who can message it.
 *
 * It answers under `sales_rep` — the same policy the human sales team holds — so a customer's
 * question can reach quote and account data without this surface becoming a way around the
 * permission model. That reuse is deliberate and it is the whole of the security statement: *what a
 * stranger can do to this database is what a sales rep can do*, and the way to narrow it is to give
 * this envoy a narrower policy, not to add a rule here.
 *
 * There is no `description` and no `rateLimits`. The task below already says what this is for, and
 * the caps moved to `sales_rep`'s own `limits` — `envoys.receive` keyed by `sender` for the
 * per-sender cap, keyed by `subject` for the desk as a whole, because an envoy is one subject and
 * its senders therefore share one bucket by construction.
 */
export default {
	transport: 'telegram',
	audience: 'public',
	policies: ['sales_rep'],
	groupMessages: 'disabled',
	task: 'Answer questions about quotes and accounts for this customer.'
} satisfies Envoy;
