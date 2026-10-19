import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Commercial rule configuration; no order access.',
	capabilities: {
		apps: ['trade_configuration']
	},
	grants: {
		sys_integration: {
			read: { integration: { eq: 'kingdee' } },
			update: {
				previous: { integration: { eq: 'kingdee' } },
				where: { integration: { eq: 'kingdee' } },
				fields: ['name', 'active', 'configuration']
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
			queries: ['inventory_cost'],
			read: true,
			create: true,
			update: true,
			history: true
		},
		commission_rules: {
			queries: ['preview'],
			read: true,
			create: true,
			update: true,
			history: true
		}
	}
});
