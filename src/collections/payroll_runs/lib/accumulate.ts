/**
 * Step 5 — ACCUMULATE.
 *
 * Every measured line passes through the treatment grid and becomes part of a contribution base.
 * Nothing in this step knows the word "EPF": a line and a contribution meet in exactly one cell,
 * and the cell says what to do.
 *
 * A line reaches its cell down one of two roads, and which road it takes is the whole of what this
 * step knows about overtime. A configured component asks the component; derived overtime asks the
 * scheme, because there is no component to ask.
 *
 * ```
 * payslip_line  MEAL_ALLOWANCE  120.00        payslip_line  OVERTIME · ORDINARY · BEYOND_NORMAL · 0
 *       │  pay_components.policy                    │  statutory_contributions.overtime_treatments
 *       ▼                                           ▼
 * MEAL × EPF    INCLUDE ──► EPF base += 120   EPF.overtime   EXCLUDE ──► EPF base   unchanged
 * MEAL × SOCSO  INCLUDE ──► SOCSO    += 120   SOCSO.overtime INCLUDE ──► SOCSO base += 288.45
 * ```
 *
 * The second road exists because "EPF excludes overtime" is a fact about EPF and not about anyone's
 * pay catalogue. It is stated once on the scheme, effective-dated, and every company in the
 * jurisdiction reads the same statement.
 *
 * `REDUCE` is why unpaid leave needs no second mechanism: its line is a positive magnitude typed
 * `UNPAID_ABSENCE`, and the cell subtracts it from every base. `SPECIAL` is why no cell is ever
 * blank — "it's complicated" is a value, and it routes the amount to a named side-channel instead
 * of the ordinary base.
 *
 * `UNSET` cannot reach a run, and neither road may be silent. A missing decision must never be read
 * as `EXCLUDE`, which is the dangerous outcome: an under-contribution nobody notices. Both paths
 * therefore throw on absence rather than defaulting.
 */

import { lookupTreatment, type Configuration, type ContributionConfig } from './configuration.js';
import type { ContributionTreatment } from '../../../custom-types/contribution_treatment/+definition.js';
import type { MeasuredLine } from './measure.js';
import { cents } from './rounding.js';

export type ContributionBase = {
	readonly contribution: ContributionConfig;
	/** Never negative: a base is a quantity of chargeable wages, and there is no negative wage. */
	readonly base: number;
	/** Amounts routed by `SPECIAL` cells, keyed by the rule they named. */
	readonly special: Readonly<Record<string, number>>;
};

/**
 * The one cell deciding this line against this scheme, or `undefined` where nobody has decided.
 *
 * The two overtime arms of the line's component union are the only ones with no pay component
 * behind them, and they are exactly the ones the scheme answers for.
 */
function treatmentFor(
	configuration: Configuration,
	contribution: ContributionConfig,
	line: MeasuredLine
): ContributionTreatment | undefined {
	switch (line.component.kind) {
		case 'OVERTIME':
			return contribution.overtimeTreatment?.treatment;
		case 'OVERTIME_EXCESS':
			return contribution.overtimeExcessTreatment?.treatment;
		default:
			return line.payComponent == null
				? undefined
				: lookupTreatment(
						configuration,
						line.payComponent.norbital_id,
						contribution.row.norbital_id
					)?.treatment;
	}
}

export function accumulateBases(options: {
	readonly configuration: Configuration;
	readonly lines: readonly MeasuredLine[];
	readonly employeeNumber: string;
}): ContributionBase[] {
	return options.configuration.contributions.map((contribution) => {
		let base = 0;
		const special: Record<string, number> = {};
		for (const line of options.lines) {
			// Information is not money, so the grid does not apply to it and it carries no cell.
			if (line.nature === 'INFORMATION') continue;
			const treatment = treatmentFor(options.configuration, contribution, line);
			if (treatment == null)
				throw new Error(
					line.payComponent == null
						? `${contribution.row.code} states no treatment for derived overtime effective in this ` +
								`period, so ${line.label} cannot be charged. Record the scheme's overtime position ` +
								'on statutory_contributions.'
						: `No ${contribution.row.code} treatment exists for ${line.label}. ` +
								'The component policy must decide every effective statutory scheme.'
				);
			switch (treatment.kind) {
				case 'INCLUDE':
					base += line.amount;
					break;
				case 'EXCLUDE':
					break;
				case 'REDUCE':
					base -= line.amount;
					break;
				case 'SPECIAL': {
					if (!contribution.row.special_rules.includes(treatment.rule))
						throw new Error(
							`${line.label} × ${contribution.row.code} routes to special rule ` +
								`"${treatment.rule}", which ${contribution.row.code} does not declare.`
						);
					special[treatment.rule] = (special[treatment.rule] ?? 0) + line.amount;
					break;
				}
				case 'UNSET':
					throw new Error(
						`${line.label} × ${contribution.row.code} is undecided. ` +
							`${options.employeeNumber} cannot be paid until the grid cell is set.`
					);
			}
		}
		return { contribution, base: cents(Math.max(0, base)), special };
	});
}
