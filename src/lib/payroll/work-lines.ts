/**
 * The pay items Work produces, built from `work_rules`.
 *
 * BASIC, ABSENCE and the NIGHT premium are engine-priced lines; the overtime classes and the
 * incentive come from `bands`, one component per (line, label) so each class settles as its
 * own payslip line and the funnel keeps the band's award. Which schemes charge each line is the
 * scheme's own declaration; nothing here names one.
 */

import type { CatalogueComponent } from '../../collections/payroll_runs/lib/configuration.js';
import type { WorkRules } from '../../datatypes/work_rules/+definition.js';
import { INCENTIVE_LINE, OVERTIME_LINE } from './work-bands.js';

const WORK_LINE_CODES = {
	salary: 'BASIC',
	absence: 'ABSENCE',
	night: 'NIGHT_PREMIUM'
} as const;

function item(options: {
	readonly settingsId: string;
	readonly code: string;
	readonly output: string;
	readonly absence?: boolean;
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
		destination: 'PAY',
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
		})
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
	// A calendar-month overtime ceiling (`funnelMonthlyOvertime`) funnels every band's excess to
	// its INCENTIVE line, so each band needs that line whether or not it funnels a daily limit
	// itself. Without it a Malaysian who worked past the Employment (Limitation of Overtime Work)
	// Regulations 1980 reg.4 104 hours refused the whole run — and s.60A(3)(a) still owes those
	// hours at 1.5× whatever the employer's own breach.
	const monthlyCeiling = work.limits.some(
		(limit) => limit.measure === 'OVERTIME_HOURS' && limit.period === 'MONTH'
	);
	for (const band of work.bands) {
		add(OVERTIME_LINE, band.label);
		if (band.funnel_above_hours != null || monthlyCeiling) add(INCENTIVE_LINE, band.label);
	}
	return items;
}
