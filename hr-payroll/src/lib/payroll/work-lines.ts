/**
 * The pay items Work produces, built from `work_rules` (RFC 0001 §6).
 *
 * BASIC, ABSENCE and the NIGHT premium are engine-priced lines with their opt-ins on
 * `work_rules.engine_lines`; the overtime classes and the incentive come from `rates.bands`, one component
 * per (line, label) so each class settles as its own payslip line and the funnel inherits the
 * band's award and statutory opt-ins.
 */

import type { CatalogueComponent } from '../../collections/payroll_runs/lib/configuration.js';
import type { StatutoryOptIn, WorkRules } from '../../datatypes/work_rules/+definition.js';

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
	readonly optIns: readonly StatutoryOptIn[];
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
		is_statutory: options.code !== WORK_LINE_CODES.salary,
		destination: 'PAY',
		direction: options.absence === true ? 'SUBTRACT' : 'ADD',
		bands: [],
		optIns: options.optIns,
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
			definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false },
			optIns: work.engine_lines.salary.statutory_opt_ins
		}),
		item({
			settingsId: work.settings_id,
			code: WORK_LINE_CODES.absence,
			output: 'absence',
			absence: true,
			definition: { source: 'ABSENCE', unit: 'MONEY' },
			optIns: work.engine_lines.absence.statutory_opt_ins
		}),
		item({
			settingsId: work.settings_id,
			code: WORK_LINE_CODES.night,
			output: 'night',
			definition: { source: 'DERIVED_OVERTIME', unit: 'MONEY' },
			optIns: work.engine_lines.night.statutory_opt_ins
		})
	];
	const seen = new Set(items.map((row) => row.output));
	const add = (line: string, label: string, optIns: readonly StatutoryOptIn[]) => {
		const output = `${line}:${label}`;
		if (seen.has(output)) return;
		seen.add(output);
		items.push(
			item({
				settingsId: work.settings_id,
				code: line,
				output,
				absence: line === WORK_LINE_CODES.absence,
				definition: { source: 'DERIVED_OVERTIME', unit: 'MONEY' },
				optIns
			})
		);
	};
	work.rates.bands.forEach((band, index) => {
		add(band.line, band.label, band.statutory_opt_ins);
		if (band.funnel != null) add(band.funnel.line, band.label, band.statutory_opt_ins);
	});
	return items;
}
