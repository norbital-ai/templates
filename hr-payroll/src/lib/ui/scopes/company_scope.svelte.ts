import type { Id } from '@norbital-ai/bolt';
import { bolt } from '$bolt';

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
