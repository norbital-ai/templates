import { custom_field } from '@norbital-ai/bolt';
import { BigDecimal, Option } from 'effect';

/**
 * Reusable co-located priced line items for contracts, commercial documents, and additional costings.
 * Quantities, unit rates, and amounts are stored as exact decimal strings (BigDecimal).
 */
export default custom_field({
	description: 'Exact-decimal priced line items with quantity, unit rate, and computed amount.',
	shape: {
		kind: 'object',
		many: true,
		fields: {
			code: { kind: 'text', optional: true },
			description: { kind: 'text' },
			unit: { kind: 'text', optional: true },
			qty: { kind: 'text' },
			unit_rate: { kind: 'text' },
			amount: { kind: 'text' }
		}
	},
	validate: (value) => {
		for (const line of value) {
			if (!line.description.trim()) return 'Each priced line requires a description.';
			if (
				Option.isNone(BigDecimal.fromString(line.qty.trim())) ||
				Option.isNone(BigDecimal.fromString(line.unit_rate.trim()))
			) {
				return 'Quantity and unit rate must be valid exact decimal values.';
			}
		}
		return undefined;
	}
});
