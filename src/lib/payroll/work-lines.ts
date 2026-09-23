/**
 * The pay items Work produces, built from `work_rules`.
 *
 * BASIC, ABSENCE and the NIGHT premium are engine-priced lines; the overtime classes and the
 * incentive come from `bands`, one component per (line, label) so each class settles as its
 * own payslip line and an incentive hour keeps the band's award. Which schemes charge each line is the
 * scheme's own declaration; nothing here names one.
 */

import type { CatalogueComponent } from '../../collections/payroll_runs/lib/configuration.js';
import type { WorkRules } from '../../datatypes/work_rules/+definition.js';
import { INCENTIVE_LINE, OVERTIME_LINE } from './work-bands.js';

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
	readonly absence?: boolean;
	readonly display?: boolean;
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
		item({
			settingsId: work.settings_id,
			code: WORK_LINE_CODES.absence,
			output: 'absence',
			absence: true,
			definition: { source: 'ABSENCE', unit: 'MONEY' }
		}),
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
		add(OVERTIME_LINE, band.label);
		if (incentive) add(INCENTIVE_LINE, band.label);
	}
	return items;
}

/**
 * Whether a version can store incentive hours: a limit splits planned overtime
 * (`funnelledLimitKeys`) — a calendar-month overtime ceiling, or a band naming a daily limit. Each
 * band then needs its INCENTIVE line, because the split may leave incentive on any day type.
 */
export const paysIncentive = (work: Pick<WorkRules, 'limits' | 'bands'>): boolean =>
	work.limits.some((limit) => limit.measure === 'OVERTIME_HOURS' && limit.period === 'MONTH') ||
	work.bands.some((band) => band.funnel_above_hours != null);
