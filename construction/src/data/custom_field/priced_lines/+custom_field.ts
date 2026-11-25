import { custom_field } from '@norbital-ai/bolt';
import { BigDecimal, Option } from 'effect';

/**
 * Structured BIM- and catalog-backed priced line items for SOs, POs, VOs, DOs, and Invoices.
 * Every line references a Costing Matrix catalog `code` (and optional BIM takeoff bucket key,
 * storey, and 3D expressIDs); quantities, unit rates, and amounts use exact `BigDecimal` strings.
 */
export default custom_field({
	description:
		'Catalog- and BIM-asset-backed exact-decimal priced line items with quantity, unit rate, and computed amount.',
	shape: {
		kind: 'object',
		many: true,
		fields: {
			source: { kind: 'enum', values: ['bim_asset', 'adhoc_catalog'], optional: true },
			code: { kind: 'text' },
			bim_asset_key: { kind: 'text', optional: true },
			storey: { kind: 'text', optional: true },
			bim_express_ids: { kind: 'int', many: true, optional: true },
			description: { kind: 'text' },
			unit: { kind: 'text' },
			qty: { kind: 'text' },
			unit_rate: { kind: 'text' },
			amount: { kind: 'text' }
		}
	},
	validate: (value) => {
		for (const line of value) {
			if (!line.code.trim()) {
				return 'Each line item must reference a BIM asset or Costing Matrix catalog code.';
			}
			if (!line.description.trim()) return 'Each priced line requires a catalog description.';
			if (!line.unit.trim()) return 'Each priced line requires a measurable catalog unit.';
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
