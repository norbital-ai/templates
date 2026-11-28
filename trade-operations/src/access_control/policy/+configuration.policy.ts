import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'Commercial rule configuration; no order access.',
	capabilities: { apps: ['trade_configuration'] },
	grants: {
		sys_integration: {
			outputs: { default: { where: { integration: { eq: 'kingdee' } } } }
		},
		sys_user: {
			outputs: { default: {} }
		},
		user_profiles: {
			outputs: { default: { history: true } },
			create: {},
			update: {},
			delete: {}
		},
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
			outputs: { default: { history: true } },
			update: { fields: ['tax_id', 'bank_name', 'bank_account', 'profile_notes'] }
		},
		products: {
			outputs: { default: {} }
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
		credit_releases: {
			outputs: { default: { history: true } }
		},
		commercial_settings: {
			outputs: { default: { history: true } },
			update: {
				fields: ['freight_treatment', 'floor_rule']
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
