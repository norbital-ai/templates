import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { contributionTreatmentValueSchema } from '../contribution_treatment/+definition.js';

/**
 * How every statutory scheme charges the two pay lines a leave can produce: the unpaid day's
 * deduction (`absence`) and the encashed day's earning (`encashment`). One map keyed by scheme
 * **code**, one cell per column; a scheme the map does not name is undecided on both.
 */
export const leaveTreatmentsValueSchema = Schema.Record(
	Schema.String,
	Schema.Struct({
		absence: contributionTreatmentValueSchema,
		encashment: contributionTreatmentValueSchema
	})
).check(
	Schema.makeFilter(
		(map) =>
			Object.keys(map).every((code) => code.trim() !== '') ||
			'A leave treatment is keyed by a scheme code; an empty code names no scheme.'
	)
);

export type LeaveTreatments = Schema.Schema.Type<typeof leaveTreatmentsValueSchema>;

/** Strict standard view: a key no arm declares inside a cell is refused rather than stripped. */
export const leaveTreatmentsSchema = Schema.toStandardSchemaV1(leaveTreatmentsValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'leave_treatments',
	description:
		'How each statutory scheme, by code, charges an unpaid day of this leave and an encashed day of it. A scheme the map does not name is undecided, and payroll refuses rather than guesses.',
	schema: leaveTreatmentsSchema
});
