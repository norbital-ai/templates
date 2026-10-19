import { bolt } from '$bolt';
import type { Id } from '@norbital-ai/bolt';
import { liveRows } from '../state/live.svelte.js';
import { covers_day } from '../scopes/settings_scope.js';

/**
 * The version of an entity's lineage governing a day (sealed, not voided, its range holding the day), kept live. Its
 * `employee_input_schema` shapes the person forms; `payroll.currency` is the salary currency. Call during component
 * initialisation.
 */
export function governingVersion(companyId: () => Id<'entity'> | null, day: () => string | null) {
	const entity = liveRows(() => {
		const id = companyId();
		return id == null
			? null
			: bolt.read('entity', {
					where: { id: { eq: id } },
					select: { settings_code: true },
					limit: 1
				});
	});
	const code = $derived(entity.current?.[0]?.settings_code ?? null);
	const versions = liveRows(() =>
		code == null
			? null
			: bolt.read('jurisdiction_settings', {
					where: { code: { eq: code }, sealed_at: { isNull: false }, voided_at: { isNull: true } },
					select: {
						id: true,
						effective_range: true,
						payroll: true,
						employee_input_schema: true
					},
					all: true
				})
	);
	const current = $derived.by(() => {
		const on = day();
		if (on == null || on === '') return null;
		return (versions.current ?? []).find((row) => covers_day(row.effective_range, on)) ?? null;
	});
	return {
		get current() {
			return current;
		},
		get loading() {
			return entity.loading || versions.loading;
		}
	};
}
