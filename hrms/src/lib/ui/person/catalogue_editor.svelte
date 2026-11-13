<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Combobox, use_form, type FieldEditor } from '@norbital-ai/ui';
	import { isJsonObject, type JsonObject } from '../../payroll_engine/foundation.js';
	import { idOf } from '../../payroll_engine/reads.js';
	import { pageLaws } from '../law.svelte.js';
	let {
		ctx,
		family,
		field
	}: {
		ctx: PageContext;
		family: 'leave_catalog' | 'claim_catalog' | 'adhoc_catalog' | 'loan_catalog';
		field: FieldEditor;
	} = $props();
	const form = use_form();
	const selected = $derived(form?.get('catalog_code'));
	const catalogCode = $derived(typeof selected === 'string' ? selected : null);
	const companyId = $derived(form?.get('entity_id'));
	const employmentId = $derived(form?.get('employment_id'));
	const incurredOn = $derived(form?.get('incurred_on'));
	const claims = $derived(
		family !== 'claim_catalog' || typeof employmentId !== 'string'
			? null
			: ctx.query({
					claim_catalog_entry: {
						where: { employment_id: { eq: idOf('employment', employmentId) } },
						fields: ['catalog_code', 'quantity', 'incurred_on'],
						limit: 10000
					}
				})
	);
	const company = $derived(
		typeof companyId === 'string'
			? ctx.query({
					entity: {
						output: 'self_service',
						where: { id: { eq: idOf('entity', companyId) } },
						fields: ['settings_code'],
						limit: 1
					}
				})
			: null
	);
	const code = $derived(company?.current?.entity.rows[0]?.settings_code);
	const laws = pageLaws(ctx, () => (code === undefined ? [] : [code]));
	const day = $derived(
		typeof incurredOn === 'string' ? incurredOn : String(ctx.clock('day').today)
	);
	const year = $derived(day.slice(0, 4));
	const usedFor = (catalogCode: string) =>
		(claims?.current?.claim_catalog_entry.rows ?? []).reduce(
			(total, row) =>
				row.catalog_code === catalogCode && String(row.incurred_on).startsWith(year)
					? total + Number(row.quantity ?? 0)
					: total,
			0
		);
	const remainingFor = (row: JsonObject) => {
		const limit = Number(isJsonObject(row.lookup) ? row.lookup.annual_limit : undefined);
		return Number.isFinite(limit) && limit > 0 ? limit - usedFor(String(row.code)) : null;
	};
	// the rows of the company's law in force on the entry's date
	const choices = $derived(
		(laws.on(code, day)?.rows[family] ?? []).filter(
			(row) => family !== 'claim_catalog' || remainingFor(row) !== 0
		)
	);
</script>

<Combobox
	id={field.id}
	disabled={field.disabled}
	value={catalogCode}
	options={choices.map((row) => ({
		value: String(row.code),
		label: String(row.code),
		description: typeof row.description === 'string' ? row.description : '',
		...(family === 'claim_catalog' && remainingFor(row) != null
			? { suffix: `${remainingFor(row)} left` }
			: {})
	}))}
	on_change={(value) => field.on_change(value)}
/>
