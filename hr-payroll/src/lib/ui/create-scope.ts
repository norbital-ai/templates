import { getContext } from 'svelte';
import { inForceSettings } from './settings-scope.js';
import { todayKey } from './calendar.js';

/**
 * The scope a page hands down to the create forms it opens.
 *
 * Every operator page in this template is scoped to one legal entity — the combobox in the app
 * header — and the tables it draws are filtered by it. The *forms* behind those tables were not:
 * a representation is a shared component with no page above it, so its relation pickers offered
 * every employment in the workspace and every version of every catalogue row. The leave form's
 * type picker showing `ANNUAL_LEAVE` five times was not duplicate data; it was five versions of
 * one lineage, offered because nothing narrowed them.
 *
 * One context carries what the pickers need:
 *
 * - `companyId` narrows people to the entity's own employments.
 * - `settingsCode` is that entity's jurisdiction lineage, which narrows catalogue rows to the
 *   version in force today — the same predicate the payroll engine picks a version with.
 * - `employmentId` is set only by Employee Self-Service, where the record is the employee's own:
 *   employment is prefilled and the field is not offered at all.
 * - `employeeId` is set by the employee profile, where a statutory fact names the person: the
 *   person is prefilled and the field is not offered at all.
 * - `settingsId` is set by the Settings page, where every catalogue row belongs to the version on
 *   screen: the form prefills it, hides it, and keys its statutory opt-ins by that version's schemes.
 *
 * A form opened with no scope keeps its old, unnarrowed behaviour rather than showing nothing.
 */
export interface HrCreateScope {
	readonly companyId: () => string | undefined;
	readonly settingsCode: () => string | undefined;
	/** Self-service only: the request is this person's own. */
	readonly employmentId?: () => string | undefined;
	/** Employee profile only: the fact is this person's own. */
	readonly employeeId?: () => string | undefined;
	/** Settings only: the version whose catalogue the row is a line of. */
	readonly settingsId?: () => string | undefined;
	/** Allowances only: the first day of the shown period, so a new allowance opens from it. */
	readonly allowanceFrom?: () => string | undefined;
}

export const HR_CREATE_SCOPE = Symbol('norbital_hr.create_scope');

/** Read the page's scope. Must be called during component initialisation, like any context read. */
export const hrCreateScope = (): HrCreateScope | undefined =>
	getContext<HrCreateScope | undefined>(HR_CREATE_SCOPE);

/**
 * The employment picker every form shares: the entity's own people, by name and employee number.
 *
 * `with` carries the employee so an option reads as a person rather than a code; the relation is
 * one-to-one on `employee_id` and named `employment_employee` by the compiler.
 *
 * `limit` is the workspace ceiling rather than a page: the picker searches the loaded options, so
 * a narrower limit would silently hide people from search rather than paginate to them.
 */
/**
 * How a person reads everywhere on these pages: "AMIL BIN SULEIMAN (NHPMY0302)". A list that
 * printed the employee number alone made HR look the person up by hand.
 */
export const employmentLabel = (
	employment:
		| {
				readonly employee_number?: unknown;
				readonly employment_employee?: { readonly name?: unknown } | null;
		  }
		| null
		| undefined
): string => {
	if (employment == null) return '—';
	const rawName = employment.employment_employee?.name;
	const name = typeof rawName === 'string' ? rawName : '';
	const rawNumber = employment.employee_number;
	const number = rawNumber != null && rawNumber !== '' ? String(rawNumber) : '';
	if (name !== '' && number !== '') return `${name} (${number})`;
	return name !== '' ? name : number !== '' ? number : '—';
};

/** The relation `with` that carries the name `employmentLabel` prints. */
export const EMPLOYMENT_LABEL_WITH = {
	columns: { employee_number: true },
	with: { employment_employee: { columns: { name: true } } }
} as const;

/** A catalogue row as HR reads it: its name, with the code where the name is missing. */
export const componentLabel = (
	component: { readonly code?: unknown; readonly name?: unknown } | null | undefined
): string => {
	if (component == null) return '—';
	const name =
		typeof component.name === 'string' && component.name.trim() !== '' ? component.name : '';
	const code = typeof component.code === 'string' ? component.code : '';
	return name !== '' ? name : code !== '' ? code : '—';
};

export const employmentRelationOptions = (companyId: string | undefined) => ({
	label: (employment: Record<string, unknown>) =>
		employmentLabel(employment as Parameters<typeof employmentLabel>[0]),
	with: { employment_employee: { columns: { name: true } } },
	...(companyId == null ? {} : { where: { company_id: { eq: companyId } } }),
	orderBy: { employee_number: 'asc' } as const,
	limit: 10_000
});

/**
 * The catalogue predicate for a scoped page: rows belonging to the version of the entity's lineage
 * in force today. Undefined without a scope, which leaves the picker unnarrowed.
 *
 * Every catalogue reaches its version through a one-relation named `<catalogue>_settings`, so the
 * shape is the same for all of them and only the relation name differs. The parameter names that
 * shape rather than enumerating the tables: there are seven catalogues now where there were two,
 * and a list would have to be edited every time one is added.
 */
export const inForceCatalogue = (
	relation: `${string}_catalogue_settings`,
	settingsCode: string | undefined,
	day: string = todayKey()
) =>
	settingsCode == null ? undefined : { [relation]: { some: inForceSettings(settingsCode, day) } };
