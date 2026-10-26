import type { Id } from '@norbital-ai/bolt';
import { getContext, setContext } from 'svelte';
import { bolt } from '$bolt';
import { EMPLOYMENT_LABEL_SELECT, employmentLabel } from './create_scope.js';

/** The entity last chosen on any HR page: moving between Payroll runs, Compliance and the rest keeps it. */
let chosen = $state<Id<'entity'> | null>(null);

/**
 * The legal entity an HR Controller page is scoped to: the committed entities in force today, the chosen one (shared by
 * every page that calls this), or the first by name. Call during component initialisation.
 */
export function companyScope() {
	const clock = bolt.clock('day');
	const entities = $derived.by(() =>
		bolt.query('entity', {
			select: {
				name: true,
				settings_code: true,
				pay_cutoff_day: true,
				pay_frequency: true,
				pay_frequency_changes: true,
				region: true,
				risk_class: true,
				time_zone: true,
				effective_range: true
			},
			where: { effective_range: { contains: clock.today } },
			orderBy: { name: 'asc' },
			all: true
		})
	);
	const list = $derived(entities?.current?.rows ?? []);
	const company = $derived(list.find((row) => row.id === chosen) ?? list[0] ?? null);
	return {
		get entities() {
			return list;
		},
		/** The entities are still loading: no page says "choose an entity" before it knows there is none. */
		get unknown() {
			return entities?.current?.rows === undefined;
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
			: bolt.query('employment_contract', {
					where: { company_id: { eq: id } },
					select: EMPLOYMENT_LABEL_SELECT,
					all: true
				});
	});
	const names = $derived(
		new Map<string, string>(
			(rows?.current?.rows ?? []).map((row) => [row.id, employmentLabel(row)])
		)
	);
	return (id: unknown): string => names.get(String(id)) ?? '—';
}
