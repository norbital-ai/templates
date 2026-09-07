/**
 * Step 5 — ACCUMULATE.
 *
 * Every measured amount, whichever plane holds it, is routed through the treatment grid into the
 * chargeable base of each scheme. The grid is `component_catalogue.contribution_treatments` — the
 * company's answer to "what does this scheme do with this money" — and every path throws on
 * absence rather than defaulting, because an undecided cell used twice is the dangerous kind: an
 * under-contribution nobody notices.
 */

import {
	lookupTreatment,
	type Configuration,
	type ContributionConfig,
	type CatalogueComponent
} from './configuration.js';
import type { ContributionTreatment } from '../../../datatypes/contribution_treatment/+definition.js';
import type { PricedItem } from './measure.js';
import { cents } from './rounding.js';

/** The catalogue row a derived overtime line is charged as: the excess row for reclassified hours. */
function overtimeComponentCode(label: string): 'OVERTIME' | 'OVERTIME_EXCESS' {
	return label.includes('_EXCESS_') ? 'OVERTIME_EXCESS' : 'OVERTIME';
}

/**
 * The OVERTIME or OVERTIME_EXCESS catalogue row, or `undefined` where the company has none.
 *
 * Derived overtime is priced by the regime and carries no component of its own on the measured
 * line; what the statute does with it is stated on these two statutory rows like every other
 * treatment. A catalogue without them cannot say what any scheme does with overtime.
 */
function overtimeComponent(
	configuration: Pick<Configuration, 'catalogueComponents'>,
	label: string
): CatalogueComponent | undefined {
	const code = overtimeComponentCode(label);
	return configuration.catalogueComponents.find((component) => component.code === code);
}

export type ContributionBase = {
	readonly contribution: ContributionConfig;
	/** Never negative: a base is a quantity of chargeable wages, and there is no negative wage. */
	readonly base: number;
	/** Amounts routed by `SPECIAL` cells, keyed by the rule they named. */
	readonly special: Readonly<Record<string, number>>;
};

/**
 * The one cell deciding this amount against this scheme, or `undefined` where nobody has decided.
 *
 * A derived overtime line names no component of its own: its label is the rule key, and the
 * excess segment of that key chooses between the OVERTIME and OVERTIME_EXCESS catalogue rows,
 * whose treatments are the scheme's overtime position.
 */
function treatmentFor(
	configuration: Configuration,
	contribution: ContributionConfig,
	item: PricedItem
): ContributionTreatment | undefined {
	const component = item.catalogueComponent ?? overtimeComponent(configuration, item.label);
	if (component == null) return undefined;
	return lookupTreatment(configuration, component.id, contribution.row.id);
}

/**
 * Every measured amount passes through the grid, whichever plane holds it.
 *
, whichever plane holds it.
 *
 * `items` is the contracted amounts and the adjustments concatenated, and that is deliberate: a
 * contribution base is a fact about the payslip, so which table a figure will be stored in cannot
 * change what it is charged on. Proration is not in here — it is the working behind a base amount,
 * not a second amount — and charging it would double the wage.
 */
export function accumulateBases(options: {
	readonly configuration: Configuration;
	readonly items: readonly PricedItem[];
	readonly employeeNumber: string;
}): ContributionBase[] {
	return options.configuration.contributions.map((contribution) => {
		let base = 0;
		const special: Record<string, number> = {};
		for (const item of options.items) {
			// Information is not money, so the grid does not apply to it and it carries no cell.
			if (item.nature === 'INFORMATION') continue;
			/**
			 * An amount naming neither a catalogue row nor a statutory rule has nothing to charge.
			 *
			 * A derived overtime row names its rule; anything else with no component is a measured
			 * nothing, and the grid has no cell for it. Skipping it is not a silent default — it is
			 * the absence of anything to decide.
			 */
			if (
				item.catalogueComponent == null &&
				!item.label.includes('_EXCESS_') &&
				!item.label.startsWith('OT_')
			)
				continue;
			if (item.catalogueComponent == null && item.amount === 0) continue;
			const treatment = treatmentFor(options.configuration, contribution, item);
			if (treatment == null) {
				const component =
					item.catalogueComponent?.code ??
					overtimeComponent(options.configuration, item.label)?.code ??
					null;
				throw new Error(
					component == null
						? `${contribution.row.code} cannot charge ${item.label}: the catalogue has no ` +
								`${overtimeComponentCode(item.label)} component. Add that statutory row, with a ` +
								`${contribution.row.code} treatment, before payroll can price derived overtime.`
						: `No ${contribution.row.code} treatment exists for ${component}` +
								(item.label === component ? '' : ` (${item.label})`) +
								'. The component states a treatment for every scheme its jurisdiction levies.'
				);
			}
			switch (treatment.kind) {
				case 'INCLUDE':
					base += item.amount;
					break;
				case 'EXCLUDE':
					break;
				case 'REDUCE':
					base -= item.amount;
					break;
				case 'SPECIAL': {
					if (!contribution.row.special_rules.includes(treatment.rule))
						throw new Error(
							`${item.label} × ${contribution.row.code} routes to special rule ` +
								`"${treatment.rule}", which ${contribution.row.code} does not declare.`
						);
					special[treatment.rule] = (special[treatment.rule] ?? 0) + item.amount;
					break;
				}
				case 'UNSET':
					throw new Error(
						`${item.label} × ${contribution.row.code} is undecided. ` +
							`${options.employeeNumber} cannot be paid until the grid cell is set.`
					);
			}
		}
		return { contribution, base: cents(Math.max(0, base)), special };
	});
}
