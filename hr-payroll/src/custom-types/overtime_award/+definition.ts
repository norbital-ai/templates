import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * What an overtime band pays: a multiple of the hourly ordinary rate, or a multiple of
 * the ordinary day wage.
 */
export const overtimeAwardValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('HOURLY_MULTIPLE'),
		multiple: Schema.Finite.check(Schema.isGreaterThan(0))
	}),
	Schema.Struct({
		kind: Schema.Literal('DAY_WAGE_MULTIPLE'),
		multiple: Schema.Finite.check(Schema.isGreaterThan(0))
	})
]);

export type OvertimeAward = Schema.Schema.Type<typeof overtimeAwardValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const overtimeAwardSchema = Schema.toStandardSchemaV1(overtimeAwardValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'overtime_award',
	description:
		'What an overtime band pays: a multiple of the hourly ordinary rate, or a multiple of the ordinary day wage.',
	schema: overtimeAwardSchema
});
