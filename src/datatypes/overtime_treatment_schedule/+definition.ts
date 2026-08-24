import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { contributionTreatmentValueSchema } from '../contribution_treatment/+definition.js';
import { instantRangeValueSchema } from '@norbital-ai/bolt/authoring';

/**
 * How one statutory scheme charges derived overtime, over time.
 *
 * Overtime is not a pay component. It is derived from `time_entries` priced against the
 * jurisdiction's `statutory_regime.overtime_rules`, so there is no component row to hang a
 * `statutory_treatments` cell on — and there should never have been one. "EPF excludes overtime" is
 * a fact about EPF, not a fact about a company's catalogue; when it lived on the component, two
 * companies in one jurisdiction could state different law and both be accepted.
 *
 * The list is effective-dated in its own right because these positions genuinely move: Vietnamese
 * PIT includes the overtime line until 1 July 2026 and excludes it afterwards, and a run reprices
 * an old period against the entry that covered its own dates.
 *
 * An empty schedule is not "not chargeable" — it is a decision nobody has made, and ACCUMULATE
 * refuses to pay against it rather than reading the silence as `EXCLUDE`.
 */
export const overtimeTreatmentScheduleValueSchema = Schema.Array(
	Schema.Struct({
		authority: Schema.NonEmptyString,
		treatment: contributionTreatmentValueSchema,
		effective_range: instantRangeValueSchema
	})
);

export type OvertimeTreatmentSchedule = Schema.Schema.Type<
	typeof overtimeTreatmentScheduleValueSchema
>;
export type OvertimeTreatment = OvertimeTreatmentSchedule[number];

/** Strict standard view: a key no entry declares is refused rather than stripped. */
export const overtimeTreatmentScheduleSchema = Schema.toStandardSchemaV1(
	overtimeTreatmentScheduleValueSchema,
	{ parseOptions: { onExcessProperty: 'error' } }
);

export default defineCustomType({
	name: 'overtime_treatment_schedule',
	description:
		'How one statutory scheme charges derived overtime — included, excluded, reduced or specially ruled — under a cited authority, for each period that position is in force.',
	schema: overtimeTreatmentScheduleSchema
});
