import { dateRangeSchema, defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

export { dateRangeSchema };
export type { DateRange } from '@norbital-ai/bolt/authoring';

/**
 * A UTC instant as one is stored: `2026-04-02T00:00:00.000Z`.
 *
 * The platform's own `dateRangeSchema` is a Standard Schema (`Schema.toStandardSchemaV1`), which is
 * what makes it directly usable as a `defineCustomType` schema — but the Standard Schema wrapper
 * erases its schema identity, so it cannot be nested as a field inside an author's `Schema.Struct`
 * or `Schema.Union`. The bounds below restate the platform's `utcInstant` exactly (same grammar,
 * same real-calendar-day filter) so a nested range validates with identical semantics.
 */
const UTC_INSTANT =
	/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?Z$/;
const isRealCalendarDay = Schema.makeFilter(
	(value: string) =>
		(!Number.isNaN(new Date(value).getTime()) &&
			new Date(value).toISOString().startsWith(value.slice(0, 10))) ||
		'must name a day that exists',
	{ title: 'realCalendarDay' }
);
const utcInstant = Schema.String.check(Schema.isPattern(UTC_INSTANT), isRealCalendarDay);

/**
 * The same two required bounds `dateRangeSchema` declares, as an Effect schema that can be nested.
 *
 * Both bounds are required — an open-ended layer is written as a far-future `end`
 * (`9999-12-31T23:59:59.999Z`), never as an absent one. `onExcessProperty: 'error'` is applied by
 * the authoring surface on every `defineCustomType` value, so the nested schema does not repeat it.
 */
export const dateRangeValueSchema = Schema.Struct({ start: utcInstant, end: utcInstant });
export type DateRangeValue = Schema.Schema.Type<typeof dateRangeValueSchema>;

/**
 * The period one nested rule is in force for, as a pair of stored instants.
 *
 * A `dateRange()` *column* already has a platform renderer, but a range nested inside another
 * custom type has none — so every layered policy in this workspace had grown its own pair of
 * `<Input type="date">` boxes and its own instant/calendar-day conversion. Three copies of that
 * conversion is three places for an off-by-one-day boundary to appear, and effective dating is what
 * decides which layer prices a run.
 *
 * The schema is the platform's own, used unchanged rather than restated. It used to be restated
 * here as `dateRangeZodSchema.required()`, because the platform value declared both bounds optional
 * and nothing in this workspace ever meant that; the platform schema now requires both, so the
 * restatement had nothing left to say. An open-ended layer is still written as a far-future `end`
 * rather than as an absent bound.
 */
export default defineCustomType({
	name: 'date_range',
	description:
		'The period a nested rule is in force for: the day it takes effect and the day it stops, both stored as instants and picked as calendar days in the payroll timezone.',
	schema: dateRangeSchema
});
