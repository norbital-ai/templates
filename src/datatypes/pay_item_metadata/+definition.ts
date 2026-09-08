import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { contributionTreatmentsValueSchema } from '../contribution_treatments/+definition.js';

/** Reporting and contribution treatment for one output of a family calculation. */
export const payItemMetadataInputSchema = Schema.Struct({
	code: Schema.String,
	sequence: Schema.Int,
	contribution_treatments: contributionTreatmentsValueSchema
});

export const payItemMetadataValueSchema = payItemMetadataInputSchema.check(
	Schema.makeFilter((value) => value.code.trim() !== '' || 'A pay item needs a code.')
);
export type PayItemMetadata = Schema.Schema.Type<typeof payItemMetadataValueSchema>;
export const payItemMetadataSchema = Schema.toStandardSchemaV1(payItemMetadataValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'pay_item_metadata',
	description:
		'The code, display/settlement sequence and contribution treatments of a family output.',
	schema: payItemMetadataSchema
});
