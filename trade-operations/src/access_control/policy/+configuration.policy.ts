import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Commercial rule configuration; no order access.',
	capabilities: {
		apps: ['trade_configuration']
	},
	grants: {
		source_lot_costs: { read: true },
		source_stock_commitments: { read: true },
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
			update: {
				columns: {
					commercial_settings: [
						'default_document_layout',
						'default_purchase_document_layout',
						'freight_treatment',
						'require_floor'
					]
				}
			},
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
