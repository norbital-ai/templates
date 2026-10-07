import { PAYROLL_TIME_ZONE } from '../../payroll_engine/foundation.js';
import * as Predicate from 'effect/Predicate';

/**
 * How a person reads everywhere on these pages: "AMIL BIN SULEIMAN (NHPMY0302)". A list that
 * printed the employee number alone made HR look the person up by hand. The name rides the
 * employment's `employee_id` relation (`EMPLOYMENT_LABEL_SELECT`).
 */
export const employmentLabel = (
	employment:
		| {
				readonly employee_number?: unknown | undefined;
				readonly employee_id?: { readonly name?: unknown } | string | null | undefined;
		  }
		| null
		| undefined
): string => {
	if (employment == null) return '—';
	const person = employment.employee_id;
	const rawName = Predicate.isObjectOrArray(person) ? person.name : undefined;
	const name = Predicate.isString(rawName) ? rawName : '';
	const rawNumber = employment.employee_number;
	const number = rawNumber != null && rawNumber !== '' ? String(rawNumber) : '';
	if (name !== '' && number !== '') return `${name} (${number})`;
	return name !== '' ? name : number !== '' ? number : '—';
};

/** The `select` that carries the name `employmentLabel` prints. */
export const EMPLOYMENT_LABEL_SELECT = {
	employee_number: true,
	employee_id: { select: { name: true } }
} as const;

/** The zone an entity counts its payroll windows and rostered days in; the workspace's zone without one. */
export const entityTimeZone = (
	entity: { readonly time_zone?: string | null } | null | undefined
): string => entity?.time_zone ?? PAYROLL_TIME_ZONE;
