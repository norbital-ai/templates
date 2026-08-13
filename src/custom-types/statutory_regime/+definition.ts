import { defineCustomType } from '@norbital-ai/pod/authoring';
import { z } from 'zod/mini';
import { moneySchema } from '../money/+definition.js';
import { overtimeAwardSchema } from '../overtime_award/+definition.js';
import { overtimeBandSchema } from '../overtime_band/+definition.js';

const authority = z.string().check(z.trim(), z.minLength(1));

export const overtimeCoverageSchema = z.strictObject({
	wage_ceiling: z.nullable(moneySchema()),
	ceiling_is_inclusive: z.nullable(z.boolean()),
	wage_basis: z.nullable(z.enum(['STATUTORY_WAGES', 'BASE_SALARY'])),
	category_basis: z.enum(['STATUTORY_WORK_CATEGORY', 'WORK_CLASSIFICATION']),
	exempt_categories: z.array(z.string().check(z.trim(), z.minLength(1))),
	excluded_categories: z.array(z.string().check(z.trim(), z.minLength(1))),
	authority
});

export const statutoryOvertimeRuleSchema = z.strictObject({
	day_type: z.enum(['ORDINARY', 'REST_DAY', 'PUBLIC_HOLIDAY']),
	authority,
	band: overtimeBandSchema,
	award: overtimeAwardSchema
});

export const statutoryOvertimeLimitSchema = z.strictObject({
	period: z.enum(['DAY', 'WEEK', 'MONTH']),
	measures: z.enum(['OVERTIME_HOURS', 'TOTAL_WORK_HOURS']),
	max_hours: z.number().check(z.positive()),
	on_exceed: z.enum(['WARN', 'BLOCK']),
	authority
});

export const statutoryRestBreakSchema = z.strictObject({
	after_consecutive_hours: z.nullable(z.number().check(z.positive())),
	minimum_minutes: z.int().check(z.positive()),
	counts_as_worked_time: z.nullable(z.boolean()),
	applies_when: z.enum(['ALWAYS', 'CONTINUOUS_ATTENDANCE', 'OVERTIME']),
	authority
});

/**
 * The atomic working-time part of one effective-dated jurisdiction snapshot.
 *
 * These values are attributes of one law revision, not independently versioned records. The
 * jurisdiction's `effective_range` dates the whole structure, so payroll can never pick coverage
 * from one revision and pricing, limits or breaks from another.
 */
export const statutoryRegimeSchema = z.strictObject({
	overtime_coverage: z.nullable(overtimeCoverageSchema),
	overtime_rules: z.array(statutoryOvertimeRuleSchema),
	overtime_limits: z.array(statutoryOvertimeLimitSchema),
	rest_breaks: z.array(statutoryRestBreakSchema)
});

export type StatutoryRegime = z.infer<typeof statutoryRegimeSchema>;
export type StatutoryOvertimeRule = z.infer<typeof statutoryOvertimeRuleSchema>;

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

	const breakKinds = new Set<string>();
	for (const rule of regime.rest_breaks) {
		if (breakKinds.has(rule.applies_when))
			issues.push(`More than one rest-break rule applies when ${rule.applies_when}.`);
		breakKinds.add(rule.applies_when);
	}

	return [...new Set(issues)];
}

export default defineCustomType({
	name: 'statutory_regime',
	description:
		'The overtime coverage, pricing bands, limits and rest-break requirements governed by one effective-dated jurisdiction snapshot.',
	schema: statutoryRegimeSchema
});
