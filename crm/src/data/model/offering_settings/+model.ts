import { model } from '@norbital-ai/bolt';

const columns = ['seller_name', 'offering_summary', 'research_focus'] as const;

/**
 * Runtime workspace offering & research configuration (one row). Decoupled from `agreement_settings` so
 * teams that do not use legal document templates (e.g. an Airwallex AE) can configure who they are,
 * what they sell, and how `research_lead` qualifies leads against their `products`.
 */
export default model('offering_settings', {
	description: 'Your company’s offering summary and lead-research qualification focus.',
	icon: 'lucide:sparkles',
	record_label: 'record.seller_name != null ? record.seller_name : "Seller profile"',
	fields: {
		scope: { kind: 'enum', values: ['workspace'], default: 'workspace', hidden: true },
		seller_name: { kind: 'text', optional: true },
		offering_summary: { kind: 'text', format: 'markdown', optional: true },
		research_focus: { kind: 'text', format: 'markdown', optional: true }
	},
	constraints: { one_offering_settings: { unique: ['scope'] } },
	outputs: { default: { fields: 'all' } },
	create: { fields: columns },
	update: { fields: columns }
});
