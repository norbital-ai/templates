import type { Id } from '@norbital-ai/bolt';
import { everyField } from '../every-field.js';
import { bolt } from '$bolt';
import { EMPLOYMENT_LABEL_SELECT, employmentLabel } from './create-scope.js';
import { liveRows } from './live.svelte.js';

/**
 * The legal entity an HR Controller page is scoped to: the committed entities in force today, the chosen one, or the
 * first by name. Each page owns its choice. Call during component initialisation.
 */
export function companyScope() {
	const companies = liveRows(() =>
		bolt.read('companies', {
			select: everyField('companies'),
			where: { approval_id: { isNull: true }, effective_range: { contains: { today: '' } } },
			orderBy: { name: 'asc' },
			all: true
		})
	);
	let chosen = $state<Id<'companies'> | null>(null);
	const list = $derived(companies.current ?? []);
	const company = $derived(list.find((row) => row.id === chosen) ?? list[0] ?? null);
	return {
		get companies() {
			return list;
		},
		/** The entities are still loading: no page says "choose an entity" before it knows there is none. */
		get unknown() {
			return companies.current === undefined;
		},
		get company() {
			return company;
		},
		get id() {
			return company?.id ?? null;
		},
		select(id: Id<'companies'>) {
			chosen = id;
		}
	};
}
export type CompanyScope = ReturnType<typeof companyScope>;

/** "NAME (NUMBER)" of every employment of the scoped entity, live: what a table's person column prints. */
export function employmentNames(companyId: () => Id<'companies'> | null) {
	const rows = liveRows(() => {
		const id = companyId();
		return id == null
			? null
			: bolt.read('employments', {
					where: { company_id: { eq: id } },
					select: EMPLOYMENT_LABEL_SELECT,
					all: true
				});
	});
	const names = $derived(
		new Map<string, string>((rows.current ?? []).map((row) => [row.id, employmentLabel(row)]))
	);
	return (id: unknown): string => names.get(String(id)) ?? '—';
}
