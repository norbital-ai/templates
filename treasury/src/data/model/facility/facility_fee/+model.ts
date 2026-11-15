import { model } from '@norbital-ai/bolt';
import { PRODUCT_CODES } from '../../../../lib/products.js';
/**
 * How a bank charges on a line, used to estimate charges until its advice arrives.
 */
export default model('facility_fee', {
	description: 'A fee rule on a facility: what the bank charges, when, and on what base.',
	icon: 'lucide:receipt',
	record_label: 'record.fee_type',
	fields: {
		facility: { kind: 'ref', to: 'facility', inverse: 'fees', on_delete: 'cascade' },
		fee_type: {
			kind: 'enum',
			values: [
				'commission',
				'cable',
				'swift',
				'cost_of_funds_transfer',
				'processing',
				'tr_extension',
				'penalty',
				'other'
			],
			default: 'commission'
		},
		product: { kind: 'enum', values: PRODUCT_CODES, optional: true },
		stage: { kind: 'enum', values: ['drawdown', 'settlement'], default: 'drawdown' },
		method: { kind: 'enum', values: ['percent', 'flat'], default: 'percent' },
		currency: { kind: 'currency', default: 'USD' },
		rate_pct: { kind: 'decimal', scale: 6, optional: true },
		amount: { kind: 'decimal', scale: 2, optional: true },
		minimum_amount: { kind: 'decimal', scale: 2, optional: true },
		include_in_estimates: { kind: 'bool', default: true },
		notes: { kind: 'text', optional: true }
	},
	outputs: {
		default: { fields: 'all', facility: { fields: ['name'], bank: { fields: ['code'] } } }
	}
});
