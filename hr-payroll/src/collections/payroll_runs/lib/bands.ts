/**
 * Selecting a band of a statutory contribution (RFC 0001 §8).
 *
 * Bands are expressions, read in declaration order: the first whose `when` holds governs. That is
 * exactly how a statute writes its table — "wages exceeding X but not exceeding Y" — so the seeded
 * order is the published order and no ceiling arithmetic stands between the law and the number.
 *
 * The terminal rung's condition is what makes high wages chargeable; a ladder that matches nobody
 * at a wage is a seeding fault that must stop a run rather than quietly fall back to the last row
 * (decision E24).
 */

import { evaluateBoolean } from '../../../lib/expressions/evaluate.js';
import type { ExpressionEngine } from '../../../lib/expressions/evaluate.js';
import type { ContributionBand } from './configuration.js';

/** The scheme context a band's expressions are evaluated against; see `lib/expressions`. */
export type BandContext = Record<string, unknown>;

/**
 * Pick the one band that governs. The result is the matched band row itself; its `employee` and
 * `employer` expressions are evaluated by the caller against the same context.
 */
export function selectBand(
	bands: readonly ContributionBand[],
	context: BandContext,
	engine: ExpressionEngine,
	contributionCode: string
): ContributionBand {
	for (const band of bands) if (evaluateBoolean(engine, band.when, context)) return band;
	const base = typeof context.base === 'number' ? context.base : 0;
	throw new Error(
		`${contributionCode} has no band whose condition holds for a base of ${base}. ` +
			'Every combination a payroll can present must be banded.'
	);
}
