import { custom_field } from '@norbital-ai/bolt';
import { BigDecimal, Option } from 'effect';

/**
 * Quantifiable BIM asset takeoff lines extracted from an IFC model and cross-checked against the
 * workspace Costing Matrix (`cost_matrix`). Each line tracks IFC class, classification, storey,
 * measured quantity, waste factor, matrix unit rate, computed amount, classification provenance
 * (deterministic rule vs System 1 / System 2 AI vs manual override), and sample expressIDs.
 */
export default custom_field({
	description: 'Quantified BIM asset classifications cross-checked against the costing matrix.',
	shape: {
		kind: 'object',
		many: true,
		fields: {
			asset_key: { kind: 'text' },
			ifc_class: { kind: 'text' },
			classification: { kind: 'text' },
			discipline: { kind: 'text' },
			storey: { kind: 'text' },
			element_count: { kind: 'int' },
			measured_qty: { kind: 'text' },
			unit: { kind: 'text' },
			quantity_basis: { kind: 'text' },
			matrix_code: { kind: 'text', optional: true },
			unit_rate: { kind: 'text' },
			waste_factor_pct: { kind: 'text' },
			priced_qty: { kind: 'text' },
			amount: { kind: 'text' },
			status: { kind: 'enum', values: ['matched', 'unmatched', 'rate_missing', 'override'] },
			match_method: {
				kind: 'enum',
				values: ['rule', 'ai_sys1', 'ai_sys2', 'override'],
				optional: true
			},
			match_confidence: { kind: 'number', optional: true },
			match_reason: { kind: 'text', optional: true },
			sample_express_ids: { kind: 'int', many: true, optional: true }
		}
	},
	validate: (value) => {
		for (const row of value) {
			if (!row.classification.trim()) return 'Each BIM takeoff row requires a classification.';
			if (
				Option.isNone(BigDecimal.fromString(row.measured_qty.trim())) ||
				Option.isNone(BigDecimal.fromString(row.unit_rate.trim())) ||
				Option.isNone(BigDecimal.fromString(row.waste_factor_pct.trim()))
			) {
				return 'Measured quantity, unit rate, and waste factor must be valid decimal values.';
			}
		}
		return undefined;
	}
});
