import type { Row } from '@norbital-ai/bolt';

/**
 * How a person reads everywhere on these pages: "JANE TAN (EMP0001)". A list that
 * printed the employee number alone made HR look the person up by hand. The name rides the
 * employment's `employee_id` layer (`'employee_contract.employee_id': { fields: ['name'] }`).
 */
export const employmentLabel = (
	employment:
		| (Pick<Row<'employee_contract'>, 'employee_number'> & {
				readonly employee_id: Pick<Row<'employee_profile'>, 'name'> | null;
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
 * `timezone` (as the engine counts them), else the workspace's. */
export const entityTimeZone = (
	entity: { readonly time_zone?: string | null } | null | undefined,
	version: { readonly timezone?: string | null } | null | undefined
): string =>
	entity?.time_zone ??
	version?.timezone ??
	// before the version answers: the viewer's zone, never a fixed one
	Intl.DateTimeFormat().resolvedOptions().timeZone;
