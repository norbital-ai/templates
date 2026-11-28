import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'The Kingdee syncs mirror ledger rows.',
	grants: {
		sys_user: { outputs: { default: {} } },
		user_profiles: { outputs: { default: {} } },
		sys_integration: {
			outputs: { default: { where: { integration: { eq: 'kingdee' } } } }
		},
		// an SO created in Kingdee is confirmed here under the rule and freight treatment in force
		commission_rules: { outputs: { default: {} } },
		commercial_settings: { outputs: { default: {} } },
		parties: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		products: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		warehouses: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		settlements: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		contacts: {
			outputs: { default: {} },
			create: {},
			update: {},
			delete: {}
		},
		stock_snapshots: {
			outputs: { default: {} },
			create: {},
			update: {},
			delete: {}
		},
		credit_snapshots: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		credit_releases: {
			outputs: { default: {} },
			create: {},
			update: {
				fields: [
					'external_code',
					'source',
					'delivery_fid',
					'bill_number',
					'bill_on',
					'party',
					'order',
					'delivery',
					'settlement_name',
					'currency',
					'source_status',
					'bill_amount',
					'credit_limit',
					'credit_days',
					'credit_used',
					'over_limit',
					'overdue_days',
					'oldest_overdue_bill',
					'block_reasons',
					'source_oper_date',
					'content_hash',
					'audit_seen_at',
					'temp_bump_status',
					'released_by',
					'released_at',
					'release_log_key',
					'observed_at'
				]
			}
		},
		source_lot_costs: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		source_stock_commitments: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		source_receivables: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		source_payables: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		source_purchase_orders: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		source_sales_lines: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		source_payments: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		source_purchase_lines: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		transactions: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		orders: {
			outputs: { default: {} },
			create: {},
			update: { moves: { status: ['draft->confirmed'] } }
		},
		order_lines: {
			outputs: { default: {} },
			create: {},
			update: {},
			delete: {}
		}
	}
});
