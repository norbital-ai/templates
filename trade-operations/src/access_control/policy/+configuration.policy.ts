import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Commercial rule configuration; no order access.',
	capabilities: { apps: ['trade_configuration'] },
	grants: {
		source_lot_costs: {
			outputs: { default: {} }
		},
		source_stock_commitments: {
			outputs: { default: {} }
		},
		document_templates: {
			outputs: { default: { history: true } },
			create: {},
			update: { moves: { status: ['draft->published'] } }
		},
		parties: {
			outputs: { default: {} }
		},
		products: {
			outputs: { default: {} },
			update: {}
		},
		warehouses: {
			outputs: { default: {} }
		},
		stock_snapshots: {
			outputs: { default: {} }
		},
		credit_snapshots: {
			outputs: { default: {} }
		},
		commercial_settings: {
			outputs: { default: { history: true } },
			update: {
				columns: {
					fields: [
						'default_document_layout',
						'default_purchase_document_layout',
						'freight_treatment',
						'require_floor'
					]
				}
			}
		},
		pricing_floors: {
			outputs: { default: { history: true } },
			create: {},
			update: {}
		},
		commission_rules: {
			outputs: { default: { history: true } },
			create: {},
			update: {}
		}
	}
});
