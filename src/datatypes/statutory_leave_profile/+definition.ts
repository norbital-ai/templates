import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { eligibilityRulesValueSchema } from '../eligibility_rules/+definition.js';
import { leaveSettlementValueSchema } from '../leave_settlement/+definition.js';

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
	account_basis: Schema.optional(Schema.Literals(['YEAR', 'EVENT'])),
	qualifying_service_months: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
	eligibility: Schema.optional(eligibilityRulesValueSchema),
	vesting: Schema.optional(Schema.Literals(['UPFRONT', 'MONTHLY'])),
	rounding: Schema.optional(Schema.Literals(['HALF_DAY', 'WHOLE_DAY_HALF_UP'])),
	event: Schema.optional(
		Schema.Struct({
			window_months: Schema.Int.check(Schema.isGreaterThan(0)),
			allocation: Schema.Literals(['INDIVIDUAL', 'HOUSEHOLD']),
			unit: Schema.optional(Schema.Literals(['DAYS', 'WEEKS'])),
			weekly_index_cap: Schema.optional(Schema.Finite.check(Schema.isGreaterThan(0)))
		})
	),
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
	transition: Schema.Literals(['FULL_AT_EFFECTIVE_DATE', 'PRORATE_REMAINDER', 'NEXT_LEAVE_YEAR']),
	/**
	 * What the leave year does with this kind's unused balance: the statute's own floor, merged
	 * against company policy by worker-protective rank (COMMUTE > CARRY > FORFEIT), never by
	 * silently dropping the stronger side.
	 */
	settlement: leaveSettlementValueSchema,
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
		if (
			members.some(
				(member) =>
					(member.account_basis ?? 'YEAR') === 'EVENT' &&
					(member.event == null ||
						member.settlement.settlement !== 'FORFEIT' ||
						member.vesting === 'MONTHLY' ||
						((member.event?.unit ?? 'DAYS') === 'WEEKS' && member.event?.weekly_index_cap == null))
			)
		)
			return 'Event-based statutory leave needs an event window, lapses outright, vests upfront, and needs a weekly-index cap when measured in weeks.';
		if (
			members.some((member) => (member.account_basis ?? 'YEAR') === 'YEAR' && member.event != null)
		)
			return 'Only event-based statutory leave may declare an event window.';
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
		'The statutory leave minimums one law revision states, including yearly or qualifying-event coverage, service qualification, vesting, child scaling, transition treatment, year-end settlement, event window/allocation scope, and the citation.',
	schema: statutoryLeaveProfileSchema
});
