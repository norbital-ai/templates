import type { Id } from '@norbital-ai/bolt';
import { bolt } from '$bolt';
import { EMPLOYMENT_LABEL_SELECT, employmentLabel } from './create_scope.js';
import { liveRows } from '../state/live.svelte.js';

/**
 * The legal entity an HR Controller page is scoped to: the committed entities in force today, the chosen one, or the
 * first by name. Each page owns its choice. Call during component initialisation.
 */
export function companyScope() {
	const entities = liveRows(() =>
		bolt.read('entity', {
			select: {
				name: true,
				settings_code: true,
				pay_cutoff_day: true,
				pay_frequency: true,
				region: true,
				risk_class: true,
				time_zone: true,
				effective_range: true
			},
			where: { approval_id: { isNull: true }, effective_range: { contains: { today: '' } } },
			orderBy: { name: 'asc' },
			all: true
		})
	);
	let chosen = $state<Id<'entity'> | null>(null);
	const list = $derived(entities.current ?? []);
	const company = $derived(list.find((row) => row.id === chosen) ?? list[0] ?? null);
	return {
		get entities() {
			return list;
		},
		/** The entities are still loading: no page says "choose an entity" before it knows there is none. */
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

/** "NAME (NUMBER)" of every employment of the scoped entity, live: what a table's person column prints. */
export function employmentNames(companyId: () => Id<'entity'> | null) {
	const rows = liveRows(() => {
		const id = companyId();
		return id == null
			? null
			: bolt.read('employment_contract', {
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
