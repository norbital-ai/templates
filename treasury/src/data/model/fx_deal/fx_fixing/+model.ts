import { model } from '@norbital-ai/bolt';
import { FX_OUTCOMES } from '../../../../lib/fx.js';
/**
 * One fixing, expiry or valuation date of an FX deal. Empty amounts and strike take the deal's. The bank's fixing
 * rate is recorded from its notice; the result is worked out from it unless a person chooses one, and the amount
 * exchanged likewise.
 */
export default model('fx_fixing', {
	description: 'One fixing of an FX deal.',
	icon: 'lucide:calendar-clock',
	record_label: 'string(record.fixing_date)',
	fields: {
		deal: { kind: 'ref', to: 'fx_deal', inverse: 'fixings', on_delete: 'cascade' },
		fixing_date: { kind: 'date' },
		settlement_date: { kind: 'date', optional: true },
		notional: { kind: 'decimal', scale: 2, optional: true },
		leveraged_notional: { kind: 'decimal', scale: 2, optional: true },
		strike: { kind: 'decimal', scale: 8, optional: true },
		/** False when the fixing happens only if its condition is met. */
		firm: { kind: 'bool', default: true },
		condition: { kind: 'text', optional: true },
		condition_side: { kind: 'enum', values: ['above', 'below'], optional: true },
		condition_level: { kind: 'decimal', scale: 8, optional: true },
		fixing_rate: { kind: 'decimal', scale: 8, optional: true },
		/** A result a person chose; empty means worked out from the rate. */
		outcome: { kind: 'enum', values: FX_OUTCOMES, optional: true },
		/** The amount actually exchanged, when it differs from the worked-out one. */
		settled_amount: { kind: 'decimal', scale: 2, optional: true },
		note: { kind: 'text', optional: true }
	},
	indexes: { by_date: { on: ['fixing_date'] } },
	outputs: {
		default: {
			fields: 'all',
			deal: {
				fields: ['pair', 'side', 'structure', 'status', 'bank_reference'],
				bank: { fields: ['code'] }
			}
		}
	}
});
