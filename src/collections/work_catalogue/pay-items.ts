import type { WorkspaceRow } from './$types.js';
import type { CatalogueComponent } from '../payroll_runs/lib/configuration.js';

/** Work output identities are independent of the operator's pay-item labels. */
export const WORK_OUTPUTS = ['salary', 'overtime', 'overtime_excess', 'absence'] as const;
type WorkOutput = (typeof WORK_OUTPUTS)[number];

export function workPayItems(
	work: Pick<WorkspaceRow<'work_catalogue'>, 'id' | 'settings_id' | WorkOutput>
): CatalogueComponent[] {
	return WORK_OUTPUTS.flatMap((output): CatalogueComponent[] => {
		const metadata = work[output];
		if (metadata == null) return [];
		return [
			{
				...metadata,
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
			}
		];
	});
}
