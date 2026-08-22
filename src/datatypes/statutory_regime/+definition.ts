import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { MoneyValueSchema } from '@norbital-ai/std/finance';
import { Schema } from 'effect';
import { overtimeAwardValueSchema } from '../overtime_award/+definition.js';
import { overtimeBandValueSchema } from '../overtime_band/+definition.js';

const authority = Schema.Trimmed.check(Schema.isMinLength(1));

export const overtimeCoverageValueSchema = Schema.Struct({
	wage_ceiling: Schema.NullOr(MoneyValueSchema),
	ceiling_is_inclusive: Schema.NullOr(Schema.Boolean),
	wage_basis: Schema.NullOr(Schema.Literals(['STATUTORY_WAGES', 'BASE_SALARY'])),
	category_basis: Schema.Literals(['STATUTORY_WORK_CATEGORY', 'WORK_CLASSIFICATION']),
	exempt_categories: Schema.Array(Schema.Trimmed.check(Schema.isMinLength(1))),
	excluded_categories: Schema.Array(Schema.Trimmed.check(Schema.isMinLength(1))),
	authority
});

export const statutoryOvertimeRuleValueSchema = Schema.Struct({
	day_type: Schema.Literals(['ORDINARY', 'REST_DAY', 'PUBLIC_HOLIDAY']),
	authority,
	band: overtimeBandValueSchema,
	award: overtimeAwardValueSchema
});

export type StatutoryOvertimeRule = Schema.Schema.Type<typeof statutoryOvertimeRuleValueSchema>;

export const statutoryOvertimeLimitValueSchema = Schema.Struct({
	period: Schema.Literals(['DAY', 'WEEK', 'MONTH']),
	measures: Schema.Literals(['OVERTIME_HOURS', 'TOTAL_WORK_HOURS']),
	max_hours: Schema.Finite.check(Schema.isGreaterThan(0)),
	on_exceed: Schema.Literals(['WARN', 'BLOCK']),
	authority
});

/**
 * One statutory rest or meal break: the consecutive-hours window that owes it, and what it owes.
 *
 * Four jurisdictions state this in four different shapes, and every one of them is expressible in
 * these fields without a branch per country:
 *
 *   Malaysia     EA 1955 s.60A(1)(a)           more than 5 consecutive hours → ≥ 30 min of leisure
 *                EA 1955 s.60A(1) proviso (ii) work requiring continual attendance: 8 consecutive
 *                                              hours *inclusive of* ≥ 45 min in the aggregate
 *   Philippines  Labor Code art.85             ≥ 60 min for meals, with no consecutive-hours
 *                                              trigger at all — it is a duty owed every day
 *   Indonesia    UU 13/2003 ps.79(2)(a)        after 4 consecutive hours → ≥ 30 min, expressly not
 *                                              counted as working hours
 *   Singapore    EA 1968 s.38(1)(a)            more than 6 consecutive hours → a period of leisure
 *                                              whose length the Act does not prescribe
 *                EA 1968 s.38(1)(c)            the same continual-attendance arm as Malaysia's
 *
 * Both nulls are therefore statements of fact, not missing data:
 *
 *   - a null `after_consecutive_hours` is a flat per-day duty, owed whatever the shape of the day
 *     (art.85, which names no window);
 *   - a null `minimum_minutes` is a trigger with no prescribed duration (s.38(1)(a), which requires
 *     "a period of leisure" and stops there). It can never produce a shortfall, and
 *     `restBreakAssessment` reports that as `null` rather than flattening it to zero — zero would
 *     claim the Act demands nothing, which is the opposite of what it says.
 *
 * `counts_as_worked_time` is null wherever the primary text does not answer it. s.60A(1)(a) calls
 * the period "leisure" and is silent on payment, so nothing may be priced from the Malaysian rows —
 * `docs/architecture.md` records that as unresolved, and this member deliberately produces a
 * compliance assessment rather than a quantity any payslip line can consume. Indonesia's
 * ps.79(2)(a) settles it in the statute ("tidak termasuk jam kerja"), so that row carries `false`.
 *
 * `on_exceed` mirrors `statutoryOvertimeLimitValueSchema`: whether a shortfall warns or refuses the
 * write. It is the one field here that is not a transcription — no statute tells a payroll system
 * what to do — and it lives beside the rule precisely so that the enforcement choice is
 * effective-dated with the law it is a choice about, instead of hiding in a settings screen.
 */
export const statutoryRestBreakRuleValueSchema = Schema.Struct({
	after_consecutive_hours: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0))),
	minimum_minutes: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
	counts_as_worked_time: Schema.NullOr(Schema.Boolean),
	applies_when: Schema.Literals(['ALWAYS', 'CONTINUOUS_ATTENDANCE']),
	on_exceed: Schema.Literals(['WARN', 'BLOCK']),
	authority
});

export type StatutoryRestBreakRule = Schema.Schema.Type<typeof statutoryRestBreakRuleValueSchema>;

/**
 * The atomic working-time part of one effective-dated jurisdiction snapshot.
 *
 * These values are attributes of one law revision, not independently versioned records. The
 * jurisdiction's `effective_range` dates the whole structure, so payroll can never pick coverage
 * from one revision and pricing or limits from another.
 */
export const statutoryRegimeValueSchema = Schema.Struct({
	overtime_coverage: Schema.NullOr(overtimeCoverageValueSchema),
	overtime_rules: Schema.Array(statutoryOvertimeRuleValueSchema),
	overtime_limits: Schema.Array(statutoryOvertimeLimitValueSchema),
	/**
	 * Rest and meal breaks — an **optional** key, not a required one.
	 *
	 * Optional rather than required-and-possibly-empty because the standard view below is strict
	 * (`onExcessProperty: 'error'`) and every jurisdiction snapshot seeded before this member existed
	 * carries no such key. A required member would fail the decode of all six of them, which is a
	 * migration disguised as a schema change. An absent key makes exactly the statement an empty
	 * array makes: this snapshot declares no break rule, so there is no rule to check and
	 * `restBreakAssessment` returns `rule: null` — absent means no rule, never "unknown rule".
	 *
	 * This member was modelled once and removed. `docs/architecture.md` records the reason — every
	 * field of it was resolved, snapshotted and read by nothing — and that reason is what
	 * `src/lib/scheduling/rest-break.ts` now retires: the day sheet quotes the figure, the publish
	 * gate refuses on it, and the write hook warns on it, all from these rows.
	 */
	rest_break_rules: Schema.optionalKey(Schema.Array(statutoryRestBreakRuleValueSchema))
});

export type StatutoryRegime = Schema.Schema.Type<typeof statutoryRegimeValueSchema>;

/** Strict standard view: a key the snapshot does not declare is refused rather than stripped. */
export const statutoryRegimeSchema = Schema.toStandardSchemaV1(statutoryRegimeValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

/** One half-open pricing band range as the overlap check reads it: `null` to is the top. */
const numericRangeSchema = Schema.Struct({ from: Schema.Number, to: Schema.NullOr(Schema.Number) });
type NumericRange = Schema.Schema.Type<typeof numericRangeSchema>;

function rangeOf(rule: StatutoryOvertimeRule): NumericRange {
	return rule.band.measure === 'BEYOND_NORMAL'
		? { from: rule.band.from_hours, to: rule.band.to_hours }
		: { from: rule.band.from_fraction, to: rule.band.to_fraction };
}

function overlaps(left: NumericRange, right: NumericRange): boolean {
	return (
		left.from < (right.to ?? Number.POSITIVE_INFINITY) &&
		right.from < (left.to ?? Number.POSITIVE_INFINITY)
	);
}

/** Human-readable semantic validation used by both create and update hooks. */
export function statutoryRegimeIssues(regime: StatutoryRegime, currency: string): string[] {
	const issues: string[] = [];
	const coverage = regime.overtime_coverage;
	if (coverage) {
		const hasCeiling = coverage.wage_ceiling !== null;
		if (hasCeiling !== (coverage.wage_basis !== null))
			issues.push('Overtime coverage must state a wage basis exactly when it states a ceiling.');
		if (hasCeiling !== (coverage.ceiling_is_inclusive !== null))
			issues.push(
				'Overtime coverage must state whether the ceiling is inclusive exactly when it states a ceiling.'
			);
		if (coverage.wage_ceiling && coverage.wage_ceiling.currency !== currency)
			issues.push(
				`The overtime wage ceiling is ${coverage.wage_ceiling.currency}, but this snapshot is ${currency}.`
			);
		for (const category of coverage.exempt_categories)
			if (coverage.excluded_categories.includes(category))
				issues.push(`${category} cannot be both always covered and never covered.`);
	}

	for (let index = 0; index < regime.overtime_rules.length; index += 1) {
		const current = regime.overtime_rules[index]!;
		const currentRange = rangeOf(current);
		if (currentRange.to !== null && currentRange.to <= currentRange.from)
			issues.push(
				`${current.day_type} ${current.band.measure} has an upper bound that is not above its lower bound.`
			);
		for (
			let siblingIndex = index + 1;
			siblingIndex < regime.overtime_rules.length;
			siblingIndex += 1
		) {
			const sibling = regime.overtime_rules[siblingIndex]!;
			if (
				current.day_type === sibling.day_type &&
				current.band.measure === sibling.band.measure &&
				overlaps(currentRange, rangeOf(sibling))
			)
				issues.push(
					`${current.day_type} ${current.band.measure} overtime bands overlap; one unit of work cannot enter two awards.`
				);
		}
	}

	const limitKeys = new Set<string>();
	for (const limit of regime.overtime_limits) {
		const key = `${limit.period}:${limit.measures}`;
		if (limitKeys.has(key))
			issues.push(`More than one ${limit.period} limit measures ${limit.measures}.`);
		limitKeys.add(key);
	}

	/**
	 * The break arms. `applies_when` is the discriminator `restBreakAssessment` selects on, so two
	 * rules sharing one arm leave the choice to seed order rather than to the statute — the same
	 * defect the limit keys above guard against, in a member where the arms are the whole model.
	 */
	const breakArms = new Set<string>();
	for (const rule of regime.rest_break_rules ?? []) {
		if (rule.after_consecutive_hours === null && rule.minimum_minutes === null)
			issues.push(
				'A rest break rule that states neither a consecutive-hours trigger nor a minimum length says nothing; remove it or transcribe what the statute requires.'
			);
		if (breakArms.has(rule.applies_when))
			issues.push(
				`More than one rest break rule applies when ${rule.applies_when}; one working day cannot be governed by two of them.`
			);
		breakArms.add(rule.applies_when);
	}

	return [...new Set(issues)];
}

export default defineCustomType({
	name: 'statutory_regime',
	description:
		'The overtime coverage, pricing bands, limits and rest break rules governed by one effective-dated jurisdiction snapshot.',
	schema: statutoryRegimeSchema
});
