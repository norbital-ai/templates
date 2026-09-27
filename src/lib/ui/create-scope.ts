import type { CollectionName, Id, Insert, PlainDate } from '@norbital-ai/bolt';
import type { RecordView } from '@norbital-ai/ui';
import { getContext } from 'svelte';
import { inForceSettings } from './settings-scope.js';
import { todayKey } from './calendar.js';
import * as Predicate from 'effect/Predicate';

/**
 * The scope a page hands down to the create forms it opens, so their pickers narrow to the page's
 * entity: `companyId` (the entity's employments), `settingsCode` (its lineage's version in force
 * today), `employmentId` (Self-Service: prefilled, not offered), `employeeId` (the profile's person)
 * and `settingsId` (the Settings page's version: prefilled, hidden, keys its schemes). A form opened
 * with no scope stays unnarrowed.
 */
export interface HrCreateScope {
	readonly companyId: () => Id<'companies'> | undefined;
	readonly settingsCode: () => string | undefined;
	/** Self-service only: the request is this person's own. */
	readonly employmentId?: () => Id<'employments'> | undefined;
	/** Employee profile only: the fact is this person's own. */
	readonly employeeId?: () => Id<'employees'> | undefined;
	/** Settings only: the version whose catalogue the row is a line of. */
	readonly settingsId?: () => Id<'jurisdiction_settings'> | undefined;
	/** Allowances only: the first day of the shown period, so a new allowance opens from it. */
	readonly allowanceFrom?: () => PlainDate | undefined;
}

export const HR_CREATE_SCOPE = Symbol('norbital_hr.create_scope');

/**
 * A record view's create `values`: the page's scope (an entry left undefined prefills nothing) under what the view was
 * opened with. An update prefills nothing.
 */
export function createValues<C extends CollectionName>(
	view: RecordView<C>,
	scoped: { readonly [K in keyof Insert<C>]?: Insert<C>[K] | undefined } = {}
): C extends unknown ? Partial<Insert<C>> : never {
	if (view.mode !== 'create') return {} as never;
	const prefilled = Object.fromEntries(Object.entries(scoped).filter(([, value]) => value != null));
	return { ...prefilled, ...view.values } as never;
}

/** Read the page's scope. Must be called during component initialisation, like any context read. */
export const hrCreateScope = (): HrCreateScope | undefined =>
	getContext<HrCreateScope | undefined>(HR_CREATE_SCOPE);

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

/** The employment `Picker` of a scoped form: the entity's own people, by employee number. */
export const employmentPicker = (companyId: Id<'companies'> | undefined) => ({
	of: 'employments' as const,
	label: ['employee_number' as const],
	...(companyId == null ? {} : { where: { company_id: { eq: companyId } } }),
	orderBy: { employee_number: 'asc' } as const
});

/**
 * The catalogue predicate for a scoped page: rows belonging to the version of the entity's lineage
 * in force today. Undefined without a scope, which leaves the picker unnarrowed. Every catalogue
 * reaches its version through its `settings_id` relation.
 */
export const inForceCatalogue = (settingsCode: string | undefined, day: string = todayKey()) =>
	settingsCode == null ? undefined : { settings_id: { is: inForceSettings(settingsCode, day) } };
