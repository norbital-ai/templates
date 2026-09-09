import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { contributionTreatmentValueSchema } from '../contribution_treatment/+definition.js';

/** The five pay lines Work produces, in the order the matrix shows them. */
export const WORK_OUTPUTS = ['salary', 'overtime', 'overtime_excess', 'absence', 'night'] as const;
export type WorkOutput = (typeof WORK_OUTPUTS)[number];

/**
 * How every statutory scheme charges the five pay lines Work produces: basic salary, statutory
 * overtime, excess overtime, unexplained absence and the night premium. One map keyed by scheme
 * **code**, one cell per column; a scheme the map does not name is undecided on all five. `night`
 * is an optional key — absent is undecided, judged only by a run that priced a night premium, the
 * way the absence column is judged.
 */
export const workTreatmentsValueSchema = Schema.Record(
	Schema.String,
	Schema.Struct({
		salary: contributionTreatmentValueSchema,
		overtime: contributionTreatmentValueSchema,
		overtime_excess: contributionTreatmentValueSchema,
		absence: contributionTreatmentValueSchema,
		night: Schema.optionalKey(contributionTreatmentValueSchema)
	})
).check(
	Schema.makeFilter(
		(map) =>
			Object.keys(map).every((code) => code.trim() !== '') ||
			'A work treatment is keyed by a scheme code; an empty code names no scheme.'
	)
);

export type WorkTreatments = Schema.Schema.Type<typeof workTreatmentsValueSchema>;

/** Strict standard view: a key no arm declares inside a cell is refused rather than stripped. */
export const workTreatmentsSchema = Schema.toStandardSchemaV1(workTreatmentsValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'work_treatments',
	description:
		'How each statutory scheme, by code, charges salary, overtime, excess overtime, unexplained absence and the night premium. A scheme the map does not name is undecided, and payroll refuses rather than guesses.',
	schema: workTreatmentsSchema
});
