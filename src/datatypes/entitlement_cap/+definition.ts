import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * Who gets how much: a table of tiers read top-down. The first band whose predicate holds for the
 * person is their ceiling per period; a person no band covers has no entitlement at all. An empty
 * predicate is everyone, so the general tier goes last.
 *
 * `Finite` rather than `Number`: an amount that is `NaN` fails no later check and reads as a blank
 * cell on the payslip.
 */
export const entitlementCapValueSchema = Schema.Struct({
	period: Schema.Literals(['CALENDAR_YEAR', 'MONTH', 'LIFETIME', 'PER_EVENT']),
	on_exceed: Schema.Literals(['BLOCK', 'ALLOW']),
	// At least one band: an empty matrix is not "no cap", it is a cap nobody is entitled under.
	bands: Schema.Array(
		Schema.Struct({
			/** One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`); '' is everyone. */
			eligibility: Schema.String,
			amount: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
		})
	).check(Schema.isMinLength(1))
});

export type EntitlementCap = Schema.Schema.Type<typeof entitlementCapValueSchema>;

/** Strict standard view: a key the shape does not declare is refused rather than stripped. */
export const entitlementCapSchema = Schema.toStandardSchemaV1(entitlementCapValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'entitlement_cap',
	description:
		'The entitlement matrix of a pay line: bands of who and how much, read top-down, the first band whose predicate holds being the ceiling per period; nobody covered means no entitlement.',
	schema: entitlementCapSchema
});
