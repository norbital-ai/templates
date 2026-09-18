import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

const patternDayValueSchema = Schema.Struct({
	roster_code_id: Schema.String.check(Schema.isUUID())
});

/** Days a week, 1–7; a half day is an alternate-Saturday week (5.5). */
const daysPerWeekSchema = Schema.Finite.check(
	Schema.isGreaterThan(0),
	Schema.isLessThanOrEqualTo(7)
);

const rosterExpectationValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('GUARANTEED_SCHEDULE'),
		days_per_week: daysPerWeekSchema,
		paid_minutes_per_week: Schema.Int.check(Schema.isGreaterThan(0))
	}),
	Schema.Struct({
		kind: Schema.Literal('AS_ASSIGNED'),
		days_per_week: daysPerWeekSchema,
		maximum_paid_minutes_per_week: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0)))
	})
]);

/**
 * The employment's one canonical schedule term. The days a week a contract works live here and
 * nowhere else: a cycle works the WORK days its weeks hold, a declaration states them.
 *
 * `days` is a repeating cycle of roster codes, anchored at the `shift_patterns` row's effective
 * start: one day per list entry, repeating forever. There is no anchor on the value and no phase
 * duration — the pattern row already states when it begins, and a crew rotation is a long cycle.
 *
 * `expectation` is the declared week where no cycle can be generated ("Rostered 6 days"): the
 * days a week, and either the paid minutes a week the roster must supply or a cap on them.
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
		'The employment schedule term: a repeating day cycle of roster codes, anchored at the pattern row’s effective start, or a declared week (days and paid minutes) where no cycle can be generated. The days a week a contract works are read from here.',
	schema: workPatternSchema
});
