import type { Id } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';

/** The entity last chosen on any HR page: moving between Payroll runs, Compliance and the rest keeps it. */
let chosen = $state<Id<'entity'> | null>(null);

/**
 * The legal entity an HR Controller page is scoped to: the committed entities in force today, the chosen one (shared by
 * every page that calls this), or the first by name. Call during component initialisation.
 */
export function companyScope(ctx: Pick<PageContext, 'query'>) {
	const entities = $derived(
		ctx.query({ entity: { fields: ['code', 'name', 'settings_code'], order_by: { name: 'asc' } } })
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
