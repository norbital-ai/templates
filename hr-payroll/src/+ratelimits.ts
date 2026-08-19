import { defineRateLimits } from '@norbital-ai/bolt/authoring';

/**
 * How often this workspace admits each class of command.
 *
 * Declared here, beside the collections and policies it protects, because a rate limit is only
 * meaningful in terms of things a host cannot see: which command was called, which tenant it belongs
 * to, and who is behind it. An edge proxy sees an IP, and behind a reverse proxy it does not
 * reliably see even that.
 *
 * The four classes are separated because their economics differ, not for tidiness:
 *
 * - `identity.sendCode` is anonymous and costs an email every time. Five an hour to one address is
 *   already generous — nobody legitimately needs a sixth — and the key is the address, because what
 *   is being protected is the cost of sending to it.
 * - `identity.signIn` is semi-anonymous: the caller has an address and is guessing a code. Looser,
 *   because a person who mistypes twice and requests a new code should not be locked out.
 * - `collections.*` is authenticated and cheap. The limit is high enough that no interactive session
 *   meets it and low enough that a runaway client cannot saturate an isolate.
 * - `agents.turn` is authenticated and costs money at a model provider, which is why it is the one
 *   authenticated class with a limit an ordinary person could notice.
 */
export default defineRateLimits({
	'identity.sendCode': { window: '1 hour', limit: 5, key: 'address' },
	'identity.signIn': { window: '1 hour', limit: 20, key: 'address' },
	'collections.*': { window: '1 min', limit: 600, key: 'subject' },
	'agents.turn': { window: '1 hour', limit: 100, key: 'subject' }
});
