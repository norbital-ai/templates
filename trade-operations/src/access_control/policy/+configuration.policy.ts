import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Commercial rule configuration; no order access.',
	capabilities: {
		apps: ['trade_configuration']
	},
	grants: {
		sys_integration: {
			read: { sys_integration: { where: { integration: { eq: 'kingdee' } } } },
			update: {
				columns: { sys_integration: ['name', 'active', 'configuration'] },
				// the definition never changes on update, so the stored row decides
				check: function* (changes, ctx) {
					const other = changes.findIndex((change) => change.before.integration !== 'kingdee');
					return other >= 0 ? ctx.deny('errors.integration_scope', { row: other }) : ctx.allow();
				}
			},
			history: true
		},
		document_templates: {
			read: true,
			history: true,
			create: true,
			update: true,
			moves: { status: ['draft->published'] }
		},
		parties: {
			read: true
		},
		products: {
			update: true,
			read: true
		},
		warehouses: {
			read: true
		},
		stock_snapshots: {
			read: true
		},
		credit_snapshots: {
			read: true
		},
		commercial_settings: {
			read: true,
			update: true,
			history: true
		},
		pricing_floors: {
			read: true,
			create: true,
			update: true,
			history: true
		},
		commission_rules: {
			read: true,
			create: true,
			update: true,
			history: true
		}
	}
});
