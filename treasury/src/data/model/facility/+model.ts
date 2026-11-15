import { model } from '@norbital-ai/bolt';
/**
 * A credit line at a bank, owned by a group company: the limit, the pricing reference, the day basis
 * and rounding the bank uses on its advices, and the longest tenor it will finance. The fee rules it
 * charges by hang off it.
 */
export default model('facility', {
	description: 'A credit line at a bank, with its limit, pricing and terms.',
	icon: 'lucide:gauge',
	record_label: 'record.name',
	fields: {
		bank: { kind: 'ref', to: 'bank', inverse: 'facilities' },
		entity: { kind: 'text', optional: true },
		name: { kind: 'text' },
		currency: { kind: 'currency', default: 'USD' },
		limit: { kind: 'decimal', scale: 2, default: 0 },
		status: { kind: 'enum', values: ['active', 'expired'], default: 'active' },
		margin_pct: { kind: 'decimal', scale: 6, optional: true },
		pricing_basis: { kind: 'text', optional: true },
		pricing_notes: { kind: 'text', optional: true },
		day_count_basis: { kind: 'enum', values: ['actual_360', 'actual_365'], default: 'actual_360' },
		interest_rounding: {
			kind: 'enum',
			values: ['nearest_cent', 'down_to_cent'],
			default: 'nearest_cent'
		},
		max_tenor_days: { kind: 'int', min: 0, optional: true },
		tenor_start_rule: {
			kind: 'enum',
			values: ['invoice_date', 'disbursement_date', 'bill_of_lading_date'],
			optional: true
		},
		early_settlement_penalty: { kind: 'text', optional: true },
		pledged_deposit: { kind: 'decimal', scale: 2, optional: true },
		review_date: { kind: 'date', optional: true },
		expiry_date: { kind: 'date', optional: true },
		security: { kind: 'text', optional: true },
		notes: { kind: 'text', optional: true }
	},
	constraints: {
		facility_name_per_bank: { unique: ['bank', 'name'] }
	},
	outputs: {
		default: {
			fields: 'all',
			bank: { fields: ['code', 'name', 'cut_off_time', 'offered_products'] },
			fees: {
				fields: [
					'fee_type',
					'product',
					'stage',
					'method',
					'currency',
					'rate_pct',
					'amount',
					'minimum_amount',
					'minimum_currency',
					'include_in_estimates'
				]
			},
			drawdowns: { fields: ['bank_reference', 'status', 'currency', 'amount', 'due_date'] },
			sub_limits: { fields: ['name', 'product', 'supplier', 'limit'] },
			letters_of_offer: { fields: ['title', 'next_review_date'] },
			watch_points: { fields: ['category', 'text'] }
		}
	},
	create: {
		fields: [
			'bank',
			'entity',
			'name',
			'currency',
			'limit',
			'status',
			'margin_pct',
			'pricing_basis',
			'pricing_notes',
			'day_count_basis',
			'interest_rounding',
			'max_tenor_days',
			'tenor_start_rule',
			'early_settlement_penalty',
			'pledged_deposit',
			'review_date',
			'expiry_date',
			'security',
			'notes'
		],
		fees: {
			fields: [
				'fee_type',
				'product',
				'stage',
				'method',
				'currency',
				'rate_pct',
				'amount',
				'minimum_amount',
				'minimum_currency',
				'include_in_estimates',
				'notes'
			]
		}
	},
	update: {
		fields: [
			'bank',
			'entity',
			'name',
			'currency',
			'limit',
			'status',
			'margin_pct',
			'pricing_basis',
			'pricing_notes',
			'day_count_basis',
			'interest_rounding',
			'max_tenor_days',
			'tenor_start_rule',
			'early_settlement_penalty',
			'pledged_deposit',
			'review_date',
			'expiry_date',
			'security',
			'notes'
		],
		fees: {
			fields: [
				'fee_type',
				'product',
				'stage',
				'method',
				'currency',
				'rate_pct',
				'amount',
				'minimum_amount',
				'minimum_currency',
				'include_in_estimates',
				'notes'
			]
		}
	}
});
