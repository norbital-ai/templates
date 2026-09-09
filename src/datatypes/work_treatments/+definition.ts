import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { contributionTreatmentValueSchema } from '../contribution_treatment/+definition.js';

/** The four pay lines Work produces, in the order the matrix shows them. */
export const WORK_OUTPUTS = ['salary', 'overtime', 'overtime_excess', 'absence'] as const;
export type WorkOutput = (typeof WORK_OUTPUTS)[number];

/**
 * How every statutory scheme charges the four pay lines Work produces: basic salary, statutory
 * overtime, excess overtime and unexplained absence. One map keyed by scheme **code**, one cell per
 * column; a scheme the map does not name is undecided on all four.
 */
export const workTreatmentsValueSchema = Schema.Record(
	Schema.String,
	Schema.Struct({
		salary: contributionTreatmentValueSchema,
		overtime: contributionTreatmentValueSchema,
		overtime_excess: contributionTreatmentValueSchema,
		absence: contributionTreatmentValueSchema
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
		'How each statutory scheme, by code, charges salary, overtime, excess overtime and unexplained absence. A scheme the map does not name is undecided, and payroll refuses rather than guesses.',
	schema: workTreatmentsSchema
});
