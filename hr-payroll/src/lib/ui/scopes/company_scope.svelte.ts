import type { Id } from '@norbital-ai/bolt';
import { getContext, setContext } from 'svelte';
import { bolt } from '$bolt';
import { employmentLabel } from './create_scope.js';

/** The entity last chosen on any HR page: moving between Payroll runs, Compliance and the rest keeps it. */
let chosen = $state<Id<'entity'> | null>(null);

/**
 * The legal entity an HR Controller page is scoped to: the committed entities in force today, the chosen one (shared by
 * every page that calls this), or the first by name. Call during component initialisation.
 */
export function companyScope() {
	const entities = $derived(
		bolt.query({ entity: { fields: ['code', 'name', 'settings_code'], orderBy: { name: 'asc' } } })
	);
	const list = $derived(entities.current?.entity.rows ?? []);
	const company = $derived(list.find((row) => row.id === chosen) ?? list[0] ?? null);
	return {
		get entities() {
			return list;
		},
		get unknown() {
			return entities.current === undefined;
		},
		get company() {
			return company;
		},
		get id() {
			return company?.id ?? null;
		},
		select(id: Id<'entity'>) {
			chosen = id;
		}
	};
}
export type CompanyScope = ReturnType<typeof companyScope>;

const PAGE_ENTITY = Symbol('hr.page_entity');
/** A scoped page offers its entity to what it opens: a record sheet carries the page's contexts. Call at init. */
export const offerPageEntity = (scope: CompanyScope): CompanyScope =>
	setContext(PAGE_ENTITY, scope);
/** The entity of the page that opened this sheet, if one offered it. Call at init. */
export const pageEntity = (): CompanyScope | undefined => getContext(PAGE_ENTITY);

/** "NAME (NUMBER)" of every employment of the scoped entity, live: what a table's person column prints. */
export function employmentNames(companyId: () => Id<'entity'> | null) {
	const rows = $derived.by(() => {
		const id = companyId();
		return id == null
			? null
			: bolt.query({
					employee_contract: {
						where: { entity_id: { eq: id } },
						fields: ['employee_number', 'employee_id']
					},
					'employee_contract.employee_id': { fields: ['name'] }
				});
	});
	const names = $derived(
		new Map<string, string>(
			(rows?.current?.employee_contract.rows ?? []).map((row) => [row.id, employmentLabel(row)])
		)
	);
	return (id: unknown): string => names.get(String(id)) ?? '—';
}
