import { bolt } from '$bolt';
import type { Id } from '@norbital-ai/bolt';
import type { BenefitCaseType } from '../../datatypes/case_types.js';
import type { PayrollSettings } from '../../datatypes/payroll_settings.js';
import { settingsInForce } from '../../jurisdiction_settings.js';
import { live, liveRows } from '../live.svelte.js';
import { inForceSettings } from '../settings-scope.js';

/**
 * The benefit case types (`payroll.benefit_cases`) the employment's lineage declares in the version
 * in force on a day. Must be called during component initialisation.
 */
export function caseTypes(
	employmentId: () => string | null | undefined,
	day: () => string
): { readonly current: readonly BenefitCaseType[] } {
	const employment = live(() => {
		const id = employmentId();
		return id ? bolt.get('employments', id as Id<'employments'>, { company_id: true }) : null;
	});
	const company = live(() =>
		employment.current?.company_id
			? bolt.get('companies', employment.current.company_id, { settings_code: true })
			: null
	);
	const versions = liveRows(() => {
		const code = company.current?.settings_code;
		return code
			? bolt.read('jurisdiction_settings', {
					where: inForceSettings(code, day()),
					select: {
						code: true,
						name: true,
						sealed_at: true,
						voided_at: true,
						approval_id: true,
						effective_range: true,
						payroll: true
					},
					all: true
				})
			: null;
	});
	return {
		get current() {
			return ((
				settingsInForce(versions.current ?? [], company.current?.settings_code ?? '', day())
					?.payroll as PayrollSettings | null
			)?.benefit_cases ?? []) as readonly BenefitCaseType[];
		}
	};
}
