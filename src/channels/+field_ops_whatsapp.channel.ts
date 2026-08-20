import type { Channel } from './$types.js';

/**
 * Field operations over WhatsApp for contractors with existing workspace accounts.
 *
 * A sender's number is matched against the verified messaging identities on workspace accounts. A
 * match makes that contractor the policy *requestor*, so every grant carrying `${requestor.norbital_id}`
 * narrows to their own work — it does not change what the channel may do. `field_ops_whatsapp` is the
 * capability ceiling either way, and an administrator's verified number reaches no more through here
 * than anyone else's. Unknown senders get the registration prompt and no model run.
 */
export default {
	transport: 'whatsapp',
	/**
	 * The channel's own policy, and not the contractor policy people hold in the app.
	 *
	 * These are different ceilings and this file used to name the wrong one. `+field_ops_whatsapp.policy.ts`
	 * exists for exactly this declaration, and `+teams.ts` gives it a team of its own — `WhatsApp Channel
	 * Agent`, holding it and nothing else — because the runtime resolves a channel's principal by finding
	 * the team that holds *exactly* this policy and refuses any team holding a superset. Naming
	 * `field_ops_contractor` here made that policy and that team unreachable leftovers, and handed a phone
	 * message the whole contractor surface: variation requests, photo evidence, everything.
	 */
	policy: 'field_ops_whatsapp',
	description: 'Field operations WhatsApp agent for contractors',
	audience: 'authenticated',
	groupMessages: 'mention_or_reply',
	task:
		'You are the field-operations assistant for authenticated contractors on WhatsApp. The linked ' +
		'account is the requestor: answer only from that contractor’s own assigned jobs, sites and ' +
		'assignments, which are the only rows you can read. You may update their own assignments — ' +
		'progress, completion, location notes and charges. You cannot raise a variation request here; ' +
		'that needs an approval the contractor should see, so direct them to the Contractor workspace ' +
		'app. Never write the integrity fields (suspect, flags, or any site_identity_* marker) even ' +
		'though the row you update contains them, and never reveal them. WhatsApp media filing is not ' +
		'supported; direct photo uploads to the app. Never ask for or expose record IDs, and never ' +
		'invent assignments, statuses, dates, or approvals.'
} satisfies Channel;
