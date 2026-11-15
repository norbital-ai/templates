import { model } from '@norbital-ai/bolt';
/**
 * An actual charge on a line: commission, cable, SWIFT and the rest, at drawdown or at settlement, from the bank's
 * advice or typed in by Treasury (for example the bank's minimum). A stage with any actual charge, even 0, is no
 * longer estimated from the fee rules; removing its charges estimates it again.
 */
export default model('drawdown_charge', {
	description: 'One charge on a financing line.',
	icon: 'lucide:receipt',
	record_label: 'record.charge_type',
	fields: {
		drawdown: { kind: 'ref', to: 'drawdown', inverse: 'charges', on_delete: 'cascade' },
		charge_type: {
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
		stage: { kind: 'enum', values: ['drawdown', 'settlement'], default: 'drawdown' },
		description: { kind: 'text', optional: true },
		currency: { kind: 'currency', default: 'USD' },
		amount: { kind: 'decimal', scale: 2 },
		fx_rate_to_usd: { kind: 'decimal', scale: 12, min: 0, default: 1 },
		amount_usd: { kind: 'decimal', scale: 2, computed: 'round(amount * fx_rate_to_usd, 2)' }
	},
	outputs: {
		default: {
			fields: 'all',
			drawdown: { fields: ['bank_reference', 'product', 'currency', 'amount', 'start_date'] }
		}
	}
});
