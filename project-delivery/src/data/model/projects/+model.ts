import { model } from '@norbital-ai/bolt';

/**
 * A delivery engagement, from NDA through signed SOW to delivery and acceptance.
 *
 * `status` carries the delivery funnel (NDA -> project documents -> SOW -> submission -> issues); documents and
 * issues attach to a project. The budget is stated in its own currency.
 */
export default model({
	description: 'A project delivery engagement for a client company.',
	icon: 'lucide:folder-kanban',
	label: 'name',
	fields: {
		name: { kind: 'text' },
		status: {
			kind: 'enum',
			values: [
				'discovery',
				'nda',
				'sow_draft',
				'sow_in_review',
				'sow_signed',
				'submitted',
				'in_delivery',
				'uat',
				'complete',
				'on_hold'
			],
			optional: true
		},
		start_on: { kind: 'instant', optional: true },
		target_on: { kind: 'instant', optional: true },
		budget_currency: { kind: 'currency', optional: true },
		budget: { kind: 'money', currency: 'budget_currency', optional: true },
		summary: { kind: 'text', optional: true }
	}
});
