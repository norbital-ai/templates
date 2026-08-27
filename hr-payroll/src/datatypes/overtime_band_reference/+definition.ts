import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The statutory overtime band a derived adjustment was priced under.
 *
 * Overtime names no pay component, because there is no pay component to name: it is derived from
 * `work_days` and the jurisdiction's `statutory_regime.overtime_rules`, and the rule that paid it is
 * the only identity it has. `payslip_adjustments.pay_component_id` is therefore NULL on exactly
 * these rows, and this column carries the band instead — the same triple `overtime.ts` groups a
 * priced segment by, plus the excess flag that separates hours beyond the statutory ceiling from
 * hours inside it.
 *
 * It is one value rather than four nullable columns for the reason the whole restructure exists:
 * a fact stated once cannot disagree with itself, and a band half-present is not a band.
 */
export const overtimeBandReferenceValueSchema = Schema.Struct({
	day_type: Schema.Literals(['ORDINARY', 'REST_DAY', 'PUBLIC_HOLIDAY']),
	measure: Schema.Literals(['BEYOND_NORMAL', 'FROM_START_OF_DAY']),
	band_from: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
	/** Hours past the statutory ceiling, priced under the same band but reported separately. */
	excess: Schema.Boolean
});

export type OvertimeBandReference = Schema.Schema.Type<typeof overtimeBandReferenceValueSchema>;

/** Strict standard view: a key the struct does not declare is refused rather than stripped. */
export const overtimeBandReferenceSchema = Schema.toStandardSchemaV1(
	overtimeBandReferenceValueSchema,
	{ parseOptions: { onExcessProperty: 'error' } }
);

export default defineCustomType({
	name: 'overtime_band_reference',
	description:
		'The statutory overtime band a derived payslip adjustment was priced under: the day type, how the band is measured, where it starts, and whether it is the excess above the statutory ceiling.',
	schema: overtimeBandReferenceSchema
});
