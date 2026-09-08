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
 *
 * A form opened with no scope keeps its old, unnarrowed behaviour rather than showing nothing.
 */
export interface HrCreateScope {
	readonly companyId: () => string | undefined;
	readonly settingsCode: () => string | undefined;
	/** Self-service only: the request is this person's own. */
	readonly employmentId?: () => string | undefined;
}

export const HR_CREATE_SCOPE = Symbol('norbital_hr.create_scope');

/** Read the page's scope. Must be called during component initialisation, like any context read. */
export const hrCreateScope = (): HrCreateScope | undefined =>
	getContext<HrCreateScope | undefined>(HR_CREATE_SCOPE);

/**
 * The employment picker every form shares: the entity's own people, by employee number.
 *
 * `limit` is the workspace ceiling rather than a page: the picker searches the loaded options, so
 * a narrower limit would silently hide people from search rather than paginate to them.
 */
export const employmentRelationOptions = (companyId: string | undefined) => ({
	label: (employment: Record<string, unknown>) =>
		employment.employee_number != null && employment.employee_number !== ''
			? String(employment.employee_number)
			: '—',
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
