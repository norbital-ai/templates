import { custom, defineModel, enums, instant, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * A delivery engagement, from NDA through signed SOW to delivery and acceptance.
 *
 * `status` carries the delivery funnel this workspace will grow into
 * (NDA -> project documents -> SOW -> submission -> issues); documents and
 * issues attach to a project as those collections arrive.
 */
export default defineModel(
	{
		name: text().notNull(),
		company_id: uuid(),
		lead_contact_id: uuid(),
		status: enums([
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
		]),
		start_on: instant(),
		target_on: instant(),
		budget: custom('money'),
		summary: text()
	},
	{
		description: 'A project delivery engagement for a client company.',
		recordLabel: 'name',
		icon: 'lucide:folder-kanban'
	}
);
