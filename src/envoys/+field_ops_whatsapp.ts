import type { Envoy } from './$types.js';

/**
 * Field operations over WhatsApp, for contractors who already hold a workspace account.
 *
 * A sender's number is matched against the verified messaging identities on workspace accounts. A
 * match makes that contractor the policy *requestor*, so every grant carrying
 * `${requestor.norbital_id}` narrows to their own work — it does not change what this envoy may do.
 * `field_ops_whatsapp` is the ceiling either way, and an administrator's verified number reaches no
 * more through here than anyone else's. Unknown senders get the registration prompt and no model run.
 *
 * The ceiling is this envoy's own policy and deliberately *not* the contractor policy people hold in
 * the app: these are different surfaces and they get different authority.
 * `access/policies/+field_ops_whatsapp.ts` exists for exactly this declaration. This file used to
 * name `field_ops_contractor` instead, which handed a phone message the whole contractor surface —
 * variation requests, photo evidence, everything.
 *
 * There is no team behind it any more, and that is the defect this cutover closes here. The runtime
 * used to resolve an envoy's authority by finding a `bolt_team` holding *exactly* its declared
 * policy — so `+teams.ts` carried a `WhatsApp Channel Agent` team with no human members, existing
 * only to satisfy that lookup, and a workspace that forgot it got a channel that refused every
 * message it ever received. The policies are named here now and carried directly.
 */
export default {
	transport: 'whatsapp',
	audience: 'authenticated',
	policies: ['field_ops_whatsapp'],
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
} satisfies Envoy;
