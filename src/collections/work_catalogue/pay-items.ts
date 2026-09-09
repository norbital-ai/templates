import type { WorkspaceRow } from './$types.js';
import type { CatalogueComponent } from '../payroll_runs/lib/configuration.js';
import type { ContributionTreatments } from '../../datatypes/contribution_treatments/+definition.js';
import {
	WORK_OUTPUTS,
	type WorkOutput,
	type WorkTreatments
} from '../../datatypes/work_treatments/+definition.js';

export { WORK_OUTPUTS };

/**
 * The five pay lines Work produces, and where each sits in the settlement order. Neither is
 * captured: every seeded lineage carried these codes and orders (Indonesia's absence line was
 * `UNPAID_LEAVE` at 150; the majority's `ABSENCE` at 1000 is taken). The night premium is the
 * regime's `night_premium` priced per work day, beside overtime.
 */
export const WORK_PAY_ITEMS = {
	salary: { code: 'BASIC', sequence: 100 },
	overtime: { code: 'OVERTIME', sequence: 20 },
	overtime_excess: { code: 'OVERTIME_EXCESS', sequence: 21 },
	absence: { code: 'ABSENCE', sequence: 1000 },
	night: { code: 'NIGHT_PREMIUM', sequence: 22 }
} as const satisfies Record<WorkOutput, { code: string; sequence: number }>;
export const {
	salary: SALARY,
	overtime: OVERTIME,
	overtime_excess: OVERTIME_EXCESS,
	absence: ABSENCE,
	night: NIGHT_PREMIUM
} = WORK_PAY_ITEMS;

/** One column of the matrix, as that pay line's treatments; an absent `night` cell is undecided. */
export const workOutputTreatments = (
	treatments: WorkTreatments,
	output: WorkOutput
): ContributionTreatments =>
	Object.fromEntries(
		Object.entries(treatments).map(([code, cell]) => [code, cell[output] ?? { kind: 'UNSET' }])
	);

/** Four column maps back into one matrix; a scheme one column lacks is `UNSET` there. */
export const workTreatmentsOf = (
	columns: Record<WorkOutput, ContributionTreatments>
): WorkTreatments =>
	Object.fromEntries(
		[...new Set(WORK_OUTPUTS.flatMap((output) => Object.keys(columns[output])))].map((code) => [
			code,
			Object.fromEntries(
				WORK_OUTPUTS.map((output) => [output, columns[output][code] ?? { kind: 'UNSET' }])
			) as WorkTreatments[string]
		])
	);

export function workPayItems(
	work: Pick<WorkspaceRow<'work_catalogue'>, 'id' | 'settings_id' | 'treatments'>
): CatalogueComponent[] {
	return WORK_OUTPUTS.map((output) => ({
		...WORK_PAY_ITEMS[output],
		contribution_treatments: workOutputTreatments(work.treatments, output),
		id: `${work.id}:${output}`,
		catalogue_id: work.id,
		settings_id: work.settings_id,
		family: 'WORK',
		output,
		is_statutory: output !== 'salary',
		nature: output === 'absence' ? 'ABSENCE' : 'EARNING',
		eligibility: '',
		definition:
			output === 'salary'
				? { source: 'SCHEDULE', unit: 'MONEY', reducible: false }
				: output === 'absence'
					? { source: 'ABSENCE', unit: 'MONEY' }
					: { source: 'DERIVED_OVERTIME', unit: 'MONEY' }
	}));
}
