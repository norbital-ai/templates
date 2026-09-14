import type { Envoy } from './$types.js';

/**
 * Field-operations work over WhatsApp for contractors with a verified workspace account.
 *
 * A matched sender becomes the requestor so the policy can verify ownership of the exact
 * existing assignment being mutated. The envoy inherits no team policy or administrator status
 * and has no create, delete, reassignment, evidence, communication-log, review, or suspicion
 * authority.
 */
export default {
	transport: 'whatsapp',
	audience: 'authenticated',
	policies: ['field_ops_whatsapp'],
	groupMessages: 'mention_or_reply',
	delegation: 'disabled',
	task:
		'You are the field-operations assistant for authenticated contractors on WhatsApp. Read job ' +
		'assignments to find the work the contractor is asking about; never invent one. You may only ' +
		'call mutate to change status, completed_at, location, summary or amount_charged on an ' +
		'existing assignment. You cannot mutate new records or delete anything, reassign work, ' +
		'attach evidence, write communication logs, or access private review data. Do not claim a ' +
		'mutation succeeded until the mutate tool succeeds.'
} satisfies Envoy;
