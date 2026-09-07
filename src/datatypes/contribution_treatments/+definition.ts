import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { contributionTreatmentValueSchema } from '../contribution_treatment/+definition.js';

/**
 * How every statutory scheme charges one pay component: a flat map keyed by scheme **code**.
 *
 * The key is the code and not the scheme row's id because the code is what stays stable across
 * profile versions: a new sealed profile carries its own EPF row, and a component that said
 * `EPF: INCLUDE` still says it. No authority and no effective range per cell: the citation lives on
 * the scheme, and dating is the profile version's job.
 *
 * A missing key is not `EXCLUDE`. It is a decision nobody has made, and ACCUMULATE refuses the run
 * naming the component and the scheme rather than reading the silence as an exemption.
 */
export const contributionTreatmentsValueSchema = Schema.Record(
	Schema.String,
	contributionTreatmentValueSchema
).check(
	Schema.makeFilter(
		(map) =>
			Object.keys(map).every((code) => code.trim() !== '') ||
			'A contribution treatment is keyed by a scheme code; an empty code names no scheme.'
	)
);

export type ContributionTreatments = Schema.Schema.Type<typeof contributionTreatmentsValueSchema>;

/** Strict standard view: a key no arm declares inside a cell is refused rather than stripped. */
export const contributionTreatmentsSchema = Schema.toStandardSchemaV1(
	contributionTreatmentsValueSchema,
	{ parseOptions: { onExcessProperty: 'error' } }
);

export default defineCustomType({
	name: 'contribution_treatments',
	description:
		'How each statutory scheme, by code, charges one pay component: included, excluded, reduced against or specially ruled. A scheme the map does not name is undecided, and payroll refuses rather than guesses.',
	schema: contributionTreatmentsSchema
});
