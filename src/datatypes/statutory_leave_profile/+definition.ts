import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/** Leave kinds are stable tenant-defined codes, so new statutory categories need no code release. */
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
	kind: Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_]{1,63}$/)),
	ladder: Schema.Array(
		Schema.Struct({
			band_from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
			days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
		})
	).check(Schema.isMinLength(1)),
	per_child: Schema.NullOr(
		Schema.Struct({
			days: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
			age_limit: Schema.Int.check(Schema.isGreaterThan(0)),
			min_children: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
		})
	),
	max_days: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0))),
	authority
});

export const statutoryLeaveProfileValueSchema = Schema.Array(statutoryLeaveMemberValueSchema).check(
	Schema.makeFilter((members) => {
		if (new Set(members.map((member) => member.kind)).size !== members.length)
			return 'Each statutory leave kind must be unique.';
		if (
			members.some(
				(member) =>
					new Set(member.ladder.map((band) => band.band_from)).size !== member.ladder.length
			)
		)
			return 'Each service band must be unique within a leave kind.';
		return true;
	})
);

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
