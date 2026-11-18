import { model } from '@norbital-ai/bolt';

/**
 * A product or service the workspace sells, grouped by category with runtime qualification / fit criteria.
 * `research_lead` reads all active products to decide which products and categories fit each researched lead.
 */
export default model('products', {
	description: 'Products and categories your workspace sells, with qualification and fit criteria.',
	icon: 'lucide:package',
	record_label: 'record.category != null ? record.category + " · " + record.name : record.name',
	fields: {
		name: { kind: 'text' },
		category: { kind: 'text', optional: true },
		summary: { kind: 'text', format: 'markdown', optional: true },
		fit_criteria: { kind: 'text', format: 'markdown', optional: true },
		active: { kind: 'bool', default: true }
	},
	indexes: {
		by_category: { on: ['category', 'name'] },
		find: { text: ['name', 'category', 'summary', 'fit_criteria'] }
	},
	outputs: { default: { fields: 'all' } },
	create: { fields: ['name', 'category', 'summary', 'fit_criteria', 'active'] },
	update: { fields: ['name', 'category', 'summary', 'fit_criteria', 'active'] },
	delete: {}
});
