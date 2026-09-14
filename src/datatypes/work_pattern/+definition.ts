import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

const patternDayValueSchema = Schema.Struct({
	roster_code_id: Schema.String.check(Schema.isUUID())
});

const periodSchema = Schema.Literals(['WEEK', 'MONTH']);

const rosterExpectationValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('GUARANTEED_SCHEDULE'),
		period: periodSchema,
		required_work_days: Schema.Finite.check(Schema.isGreaterThan(0)),
		required_paid_minutes: Schema.Int.check(Schema.isGreaterThan(0))
	}),
	Schema.Struct({
		kind: Schema.Literal('AS_ASSIGNED'),
		period: periodSchema,
		maximum_paid_minutes: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0)))
	})
]);

/**
 * The employment's one canonical schedule term.
 *
 * `days` is a repeating cycle of roster codes, anchored at the `shift_patterns` row's effective
 * start: one day per list entry, repeating forever. There is no anchor on the value and no phase
 * duration — the pattern row already states when it begins, and a crew rotation is a long cycle.
 *
 * `expectation` is reserved for assignments that cannot be generated: a guaranteed weekly or
 * monthly amount the roster must satisfy, or an as-assigned statement with an optional cap.
 */
export const workPatternValueSchema = Schema.Union([
	Schema.Struct({
		days: Schema.Array(patternDayValueSchema).check(Schema.isMinLength(1))
	}),
	Schema.Struct({
		expectation: rosterExpectationValueSchema
	})
]);

export type WorkPattern = Schema.Schema.Type<typeof workPatternValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const workPatternSchema = Schema.toStandardSchemaV1(workPatternValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'work_pattern',
	description:
		'The employment schedule term: a repeating day cycle of roster codes, anchored at the pattern row’s effective start, or a guaranteed/as-assigned expectation where no cycle can be generated.',
	schema: workPatternSchema
});
