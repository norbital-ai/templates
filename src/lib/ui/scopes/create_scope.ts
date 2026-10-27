import type { Row } from '@norbital-ai/bolt';

/**
 * How a person reads everywhere on these pages: "AMIL BIN SULEIMAN (NHPMY0302)". A list that
 * printed the employee number alone made HR look the person up by hand. The name rides the
 * employment's `employee_id` layer (`'employment_contract.employee_id': { fields: ['name'] }`).
 */
export const employmentLabel = (
	employment:
		| (Pick<Row<'employment_contract'>, 'employee_number'> & {
				readonly employee_id: Pick<Row<'employment_profile'>, 'name'> | null;
		  })
		| null
		| undefined
): string => {
	if (employment == null) return '—';
	const name = employment.employee_id?.name ?? '';
	const number = employment.employee_number;
	if (name !== '' && number !== '') return `${name} (${number})`;
	return name !== '' ? name : number !== '' ? number : '—';
};

/** The zone an entity counts its payroll windows and rostered days in: its own, else its governing version's
 * `payroll.timezone` (as the engine counts them), else the workspace's. */
export const entityTimeZone = (
	entity: { readonly time_zone?: string | null } | null | undefined,
	version: { readonly payroll?: { readonly timezone?: string | null } | null } | null | undefined
): string =>
	entity?.time_zone ??
	version?.payroll?.timezone ??
	// before the version answers: the viewer's zone, never a fixed one
	Intl.DateTimeFormat().resolvedOptions().timeZone;
