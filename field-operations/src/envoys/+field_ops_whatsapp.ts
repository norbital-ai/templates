import type { Envoy } from './$types.js';

/**
 * Field operations over WhatsApp, for contractors who already hold a workspace account.
 *
 * A sender's number is matched against the verified messaging identities on workspace accounts. A
 * match makes that contractor the policy *requestor*, so every grant carrying
 * `${requestor.id}` narrows to their own work — it does not change what this envoy may do.
 * `field_ops_whatsapp` is the ceiling either way, and an administrator's verified number reaches no
 * more through here than anyone else's. Unknown senders get the registration prompt and no model run.
 *
 * The ceiling is this envoy's own policy and deliberately *not* the contractor policy people hold in
 * the app: these are different surfaces and they get different authority.
 * `access/policies/+field_ops_whatsapp.ts` exists for exactly this declaration. This file used to
 * name `field_ops_contractor` instead, which handed a phone message the whole contractor surface —
 * variation requests, photo evidence, everything.
 *
 * There is no team behind it. Runtime mints the static `envoy:field_ops_whatsapp` subject directly
 * from this declaration and carries this policy array with it; the linked account may narrow row
 * predicates but cannot contribute its own team policies or administrator status.
 */
export default {
	transport: 'whatsapp',
	audience: 'authenticated',
	policies: ['field_ops_whatsapp'],
	groupMessages: 'mention_or_reply',
	delegation: 'disabled',
	task:
		'You are the field-operations assistant for authenticated contractors on WhatsApp. Work only ' +
		'with the linked account’s existing assigned jobs, sites and assignments. Identify the relevant ' +
		'assignment from the contractor’s message and visible work. If more than one is plausible, ask ' +
		'a concise clarification, retain the pending inbound messages, and do not guess. Once exactly one ' +
		'assignment is known, your first mandatory action is to append one communication_logs row for ' +
		'each pending text-bearing inbound message, using its exact user text and host-supplied sender, sentAt and ' +
		'messageId as sender, sent_at and source_message_id. Reuse those exact values so a replay cannot ' +
		'create a second domain event. For each host-supplied JPEG or PNG descriptor, next create one ' +
		'photo_evidence row against that same assignment using its exact FileRef and provenance; never ' +
		'fabricate a file pointer. You may update only status, completed_at, location, summary and ' +
		'amount_charged. Never create or delete a job, site or assignment, and never reassign one. Do not ' +
		'claim a capture or update succeeded ' +
		'until the corresponding tool succeeds. Never ask for or expose record IDs, and never invent ' +
		'assignments, statuses, dates, charges or approvals.'
} satisfies Envoy;
