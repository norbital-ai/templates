/**
 * Selecting a rule of a statutory contribution.
 *
 * Rules are expressions, read in declaration order: the first whose `when` holds governs. That is
 * exactly how a statute writes its table — "wages exceeding X but not exceeding Y" — so the seeded
 * order is the published order and no ceiling arithmetic stands between the law and the number.
 *
 * A rules list no member of which holds charges nothing: a ladder that covers nobody
 * pays nobody, and the golden suites are the guard against a mis-transcribed table.
 */

import { evaluateBoolean } from '../../../lib/expressions/evaluate.js';
import type { ExpressionEngine } from '../../../lib/expressions/evaluate.js';
import type { ContributionRule } from './configuration.js';

/**
 * Pick the one rule that governs, or null when none does. The caller evaluates the matched rule's
 * `employee` and `employer` expressions against the same context.
 */
export function selectRule(
	rules: readonly ContributionRule[],
	context: Record<string, unknown>,
	engine: ExpressionEngine
): ContributionRule | null {
	for (const rule of rules) if (evaluateBoolean(engine, rule.when, context)) return rule;
	return null;
}
