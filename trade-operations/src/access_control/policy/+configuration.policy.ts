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
		source_purchase_lines: {
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
			// the rest mirrors Kingdee
			update: { fields: ['commission_factor', 'commission_basis_unit'] }
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
				fields: ['freight_treatment', 'require_floor']
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
