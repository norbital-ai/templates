import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Commercial rule configuration; no order access.',
	capabilities: { apps: ['trade_configuration'] },
	grants: {
		source_lot_costs: {
			outputs: { default: true }
		},
		source_stock_commitments: {
			outputs: { default: true }
		},
		document_templates: {
			outputs: { default: { history: true } },
			create: true,
			update: { moves: { status: ['draft->published'] } }
		},
		parties: {
			outputs: { default: true }
		},
		products: {
			outputs: { default: true },
			update: true
		},
		warehouses: {
			outputs: { default: true }
		},
		stock_snapshots: {
			outputs: { default: true }
		},
		credit_snapshots: {
			outputs: { default: true }
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
			create: true,
			update: true
		},
		commission_rules: {
			outputs: { default: { history: true } },
			create: true,
			update: true
		}
	}
});
