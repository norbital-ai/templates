import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The source record one payslip consumed.
 *
 * The union is projected to real foreign-key columns on `payslip_sources`. Unlike the previous
 * collection-name/id pair, every arm is checked by Postgres and can be traversed in either
 * direction through the relationship graph.
 */
export const payslipSourceValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('TIME_ENTRY'),
		time_entry_id: Schema.String.check(Schema.isUUID())
	}),
	Schema.Struct({
		kind: Schema.Literal('LEAVE_REQUEST'),
		leave_request_id: Schema.String.check(Schema.isUUID())
	})
]);

export type PayslipSource = Schema.Schema.Type<typeof payslipSourceValueSchema>;

export const payslipSourceSchema = Schema.toStandardSchemaV1(payslipSourceValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'payslip_source',
	description:
		'The attendance or leave record one payslip consumed, projected to a database-enforced foreign key.',
	schema: payslipSourceSchema
});
