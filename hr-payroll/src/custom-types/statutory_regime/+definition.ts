import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { moneyValueSchema } from '../money/+definition.js';
import { overtimeAwardValueSchema } from '../overtime_award/+definition.js';
import { overtimeBandValueSchema } from '../overtime_band/+definition.js';

const authority = Schema.Trimmed.check(Schema.isMinLength(1));

export const overtimeCoverageValueSchema = Schema.Struct({
	wage_ceiling: Schema.NullOr(moneyValueSchema),
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
 * The atomic working-time part of one effective-dated jurisdiction snapshot.
 *
 * These values are attributes of one law revision, not independently versioned records. The
 * jurisdiction's `effective_range` dates the whole structure, so payroll can never pick coverage
 * from one revision and pricing or limits from another.
 */
export const statutoryRegimeValueSchema = Schema.Struct({
	overtime_coverage: Schema.NullOr(overtimeCoverageValueSchema),
	overtime_rules: Schema.Array(statutoryOvertimeRuleValueSchema),
	overtime_limits: Schema.Array(statutoryOvertimeLimitValueSchema)
});

export type StatutoryRegime = Schema.Schema.Type<typeof statutoryRegimeValueSchema>;

/** Strict standard view: a key the snapshot does not declare is refused rather than stripped. */
export const statutoryRegimeSchema = Schema.toStandardSchemaV1(statutoryRegimeValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

type NumericRange = { readonly from: number; readonly to: number | null };

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

	return [...new Set(issues)];
}

export default defineCustomType({
	name: 'statutory_regime',
	description:
		'The overtime coverage, pricing bands and limits governed by one effective-dated jurisdiction snapshot.',
	schema: statutoryRegimeSchema
});
