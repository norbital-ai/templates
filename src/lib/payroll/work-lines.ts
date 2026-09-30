/**
 * The pay items Work produces, built from `work_rules`.
 *
 * BASIC, a configured results-wage top-up, ABSENCE and the NIGHT premium are engine-priced lines;
 * the overtime classes and incentive come from `bands`, one component per (line, label), so each
 * class settles as its own payslip line and an incentive hour keeps the band's award. Which schemes charge each line is the
 * scheme's own declaration; nothing here names one.
 */

import type { CatalogueComponent } from '../../lib/payroll/run/configuration.js';
import type { WorkRules } from '../datatypes/work_rules.js';
import { INCENTIVE_LINE, OVERTIME_LINE } from './work-bands.js';
import { splitsOvertime } from '../scheduling/work-limits.js';

const WORK_LINE_CODES = {
	salary: 'BASIC',
	absence: 'ABSENCE',
	night: 'NIGHT_PREMIUM',
	nightWage: 'NIGHT_WAGE'
} as const;

function item(options: {
	readonly settingsId: string;
	readonly code: string;
	readonly output: string;
	readonly absence?: boolean | undefined;
	readonly display?: boolean | undefined;
	readonly definition: CatalogueComponent['definition'];
}): CatalogueComponent {
	return {
		id: `${options.settingsId}:${options.output}`,
		catalogue_id: options.settingsId,
		settings_id: options.settingsId,
		code: options.code,
		name: options.code,
		output: options.output,
		eligibility: '',
		family: 'WORK',
		destination: options.display === true ? 'DISPLAY' : 'PAY',
		direction: options.absence === true ? 'SUBTRACT' : 'ADD',
		bands: [],
		definition: options.definition
	};
}

/**
 * Every Work pay item of one settings version: the engine-priced lines, then the bands in
 * declaration order. Two bands may share a line (OT classes) and differ by label, so the
 * component identity is the pair.
 */
export function workPayItems(
	work: WorkRules & { readonly settings_id: string }
): CatalogueComponent[] {
	const items: CatalogueComponent[] = [
		item({
			settingsId: work.settings_id,
			code: WORK_LINE_CODES.salary,
			output: 'salary',
			definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false }
		}),
		...(work.wages?.block_unmeasured_results_pay === true
			? [
					item({
						settingsId: work.settings_id,
						code: 'MINIMUM_WAGE_TOP_UP',
						output: 'salary_top_up',
						definition: { source: 'RESULTS_FLOOR', unit: 'MONEY' }
					})
				]
			: []),
		item({
			settingsId: work.settings_id,
			code: WORK_LINE_CODES.absence,
			output: 'absence',
			absence: true,
			definition: { source: 'ABSENCE', unit: 'MONEY' }
		}),
		// A normal-day band (`bands[].component`) posts additional normal-time wages to its own item.
		...work.bands.flatMap((band) =>
			band.component == null
				? []
				: [
						item({
							settingsId: work.settings_id,
							code: band.label,
							output: band.component,
							definition: { source: 'DERIVED_NORMAL', unit: 'MONEY' }
						})
					]
		),
		item({
			settingsId: work.settings_id,
			code: WORK_LINE_CODES.night,
			output: 'night',
			definition: { source: 'DERIVED_OVERTIME', unit: 'MONEY' }
		}),
		// What the night's ordinary hours earned inside the salary: shown, never paid again. A law
		// that exempts the whole night-work wage, not only its premium, reads it as `NIGHT_WAGE`.
		...(work.night_premium == null
			? []
			: [
					item({
						settingsId: work.settings_id,
						code: WORK_LINE_CODES.nightWage,
						output: 'night_wage',
						display: true,
						definition: { source: 'DERIVED_OVERTIME', unit: 'MONEY' }
					})
				])
	];
	const seen = new Set(items.map((row) => row.output));
	const add = (line: string, label: string) => {
		const output = `${line}:${label}`;
		if (seen.has(output)) return;
		seen.add(output);
		items.push(
			item({
				settingsId: work.settings_id,
				code: line,
				output,
				definition: { source: 'DERIVED_OVERTIME', unit: 'MONEY' }
			})
		);
	};
	const incentive = paysIncentive(work);
	for (const band of work.bands) {
		if (band.component != null) continue;
		add(OVERTIME_LINE, band.label);
		if (incentive) add(INCENTIVE_LINE, band.label);
	}
	return items;
}

/**
 * Whether a version can store incentive hours: it states a limit that splits planned overtime
 * (`splitsOvertime`). Each band then needs its INCENTIVE line, because the split may leave
 * incentive on any day type.
 */
export const paysIncentive = (work: Pick<WorkRules, 'limits'>): boolean =>
	work.limits.some(splitsOvertime);
