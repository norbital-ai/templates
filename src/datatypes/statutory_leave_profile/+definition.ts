import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The canonical statutory leave kinds the profile states minimums for.
 *
 * A closed literal set at schema level — the same status as overtime day types: the vocabulary is
 * the template's transcription of statutory leave categories, and extending it is a template
 * change, not tenant configuration. A company leave type links to one kind via
 * `leave_types.statutory_kind`; company-specific leave that no statute mandates has no kind.
 */
export const STATUTORY_LEAVE_KINDS = [
	'ANNUAL',
	'SICK',
	'HOSPITALIZATION',
	'MATERNITY',
	'PATERNITY',
	'CHILDCARE'
] as const;

const authority = Schema.NonEmptyString;

/**
 * One statutory leave kind's floor, transcribed from the law revision the profile snapshots.
 *
 * - `ladder`       — the service-scaled base: the band whose `band_from` is the highest one at or
 *                    below the employee's completed service months supplies the base days. One
 *                    band at `band_from: 0` is a flat floor.
 * - `per_child`    — the law scales this kind by the employee's children. The engine counts the
 *                    employee's child facts under `age_limit` as of the date and adds
 *                    `days × count`. `min_children` is the gate the law states: below it, the
 *                    kind grants nothing (childcare leave with no child of qualifying age).
 * - `max_days`     — the ceiling the law puts on the scaled total, where it states one.
 */
const statutoryLeaveMemberValueSchema = Schema.Struct({
	kind: Schema.Literals(STATUTORY_LEAVE_KINDS),
	ladder: Schema.Array(
		Schema.Struct({
			band_from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
			days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
		})
	).check(Schema.isMinLength(1)),
	per_child: Schema.NullOr(
		Schema.Struct({
			days: Schema.Finite.check(Schema.isGreaterThan(0)),
			age_limit: Schema.Int.check(Schema.isGreaterThan(0)),
			min_children: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
		})
	),
	max_days: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0))),
	authority
});

const statutoryLeaveProfileValueSchema = Schema.Array(statutoryLeaveMemberValueSchema);

/** Strict standard view: duplicate kinds are a sealed lie, so they are refused at the boundary. */
export const statutoryLeaveProfileSchema = Schema.toStandardSchemaV1(
	statutoryLeaveProfileValueSchema,
	{ parseOptions: { onExcessProperty: 'error' } }
);

export default defineCustomType({
	name: 'statutory_leave_profile',
	description:
		'The statutory leave minimums one law revision states, per canonical leave kind: the service-scaled base days, any per-child scaling with its age limit and gate, the ceiling, and the citation.',
	schema: statutoryLeaveProfileSchema
});
