import { bolt } from '$bolt';
import type { Id } from '@norbital-ai/bolt';
import { covers_day } from '../scopes/settings_scope.js';
import { jsonSchemaOf } from './input_schema.js';

/**
 * The version of an entity's lineage governing a day (sealed, not voided, its range holding the day), kept live. Its
 * `employee_input_schema` (decoded once, as `schema`) shapes the person forms; `payroll.currency` is the salary
 * currency. Call during component initialisation.
 */
export function governingVersion(companyId: () => Id<'entity'> | null, day: () => string | null) {
	const entity = $derived.by(() => {
		const id = companyId();
		return id == null
			? null
			: bolt.query({ entity: { where: { id: { eq: id } }, fields: ['settings_code'], limit: 1 } });
	});
	const code = $derived(entity?.current?.entity.rows[0]?.settings_code ?? null);
	const versions = $derived.by(() =>
		code == null
			? null
			: bolt.query({
					jurisdiction_settings: {
						where: {
							code: { eq: code },
							sealed_at: { isNull: false },
							voided_at: { isNull: true }
						},
						fields: ['effective_range', 'payroll', 'employee_input_schema']
					}
				})
	);
	const current = $derived.by(() => {
		const on = day();
		if (on == null || on === '') return null;
		return (
			(versions?.current?.jurisdiction_settings.rows ?? []).find((row) =>
				covers_day(row.effective_range, on)
			) ?? null
		);
	});
	const schema = $derived(jsonSchemaOf(current?.employee_input_schema));
	return {
		get current() {
			return current;
		},
		get schema() {
			return schema;
		},
		get loading() {
			return entity?.loading || versions?.loading;
		}
	};
}
