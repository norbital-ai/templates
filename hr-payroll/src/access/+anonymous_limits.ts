import { anonymousLimits } from '@norbital-ai/bolt/authoring';

/**
 * What a caller may do before there is anybody to charge it to.
 *
 * This is the only rate-limit file left in a workspace, and it is separate for a structural reason
 * rather than a stylistic one: **before sign-in there is no subject, so there is no policy to hang a
 * limit on.** Everything with a holder is declared by that holder — a person's budget lives in the
 * policies their team holds, an envoy's in the policies the envoy names — which is what lets a
 * contractor and a controller be given different budgets for the same command. The retired
 * workspace-wide declaration could not express that distinction.
 *
 * Both rules are keyed by `address`, and that is enforced rather than conventional: `subject` and
 * `sender` name things that do not exist yet at this surface, so a rule keyed by either would
 * collapse every anonymous caller into one bucket. That is the exact defect this whole layer
 * replaced, where every visitor behind one reverse proxy shared one limit.
 *
 * The two differ because their economics do. `identity.sendCode` is anonymous and costs an email
 * every time — five an hour to one address is already generous, nobody legitimately needs a sixth,
 * and the key is the address because what is being protected is the cost of sending to it.
 * `identity.signIn` is semi-anonymous: the caller has an address and is guessing a code, so it is
 * looser, because somebody who mistypes twice and requests a new code should not be locked out.
 */
export default anonymousLimits({
	'identity.sendCode': { window: '1 hour', limit: 5, key: 'address' },
	'identity.signIn': { window: '1 hour', limit: 20, key: 'address' }
});
