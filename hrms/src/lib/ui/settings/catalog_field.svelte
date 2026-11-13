<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Combobox, Field, use_form, type FieldEditor } from '@norbital-ai/ui';
	import { idOf } from '../../payroll_engine/reads.js';
	import { pageLaws } from '../law.svelte.js';

	/** An entry's catalogue field: the codes of its company's law, as in force on the entry's date. */
	let {
		ctx,
		of,
		dated
	}: {
		ctx: PageContext;
		of:
			| 'adhoc_catalog'
			| 'claim_catalog'
			| 'leave_catalog'
			| 'loan_catalog'
			| 'work_event_catalog'
			| 'workplace_case_catalog';
		/** The form field holding the entry's date; without one the law is today's. */
		dated?: string;
	} = $props();
	const clock = ctx.clock('day');
	const form = use_form();
	const entity = $derived(form?.get('entity_id'));
	const employment = $derived(form?.get('employment_id'));
	const company = $derived(
		typeof entity === 'string'
			? ctx.query({
					entity: {
						where: { id: { eq: idOf('entity', entity) } },
						fields: ['settings_code'],
						limit: 1
					}
				})
			: typeof employment === 'string'
				? ctx.query({
						entity: {
							where: {
								employee_contract: { some: { id: { eq: idOf('employee_contract', employment) } } }
							},
							fields: ['settings_code'],
							limit: 1
						}
					})
				: null
	);
	const code = $derived(company?.current?.entity.rows[0]?.settings_code);
	const laws = pageLaws(ctx, () => (code === undefined ? [] : [code]));
	const day = $derived.by(() => {
		const on = dated === undefined ? undefined : form?.get(dated);
		return typeof on === 'string' ? on : String(clock.today);
	});
	const options = $derived(
		(laws.on(code, day)?.rows[of] ?? [])
			.map((row) => ({
				value: String(row.code),
				label: String(row.code),
				...(typeof row.description === 'string' ? { description: row.description } : {})
			}))
			.toSorted((one, other) => one.value.localeCompare(other.value))
	);
</script>

{#snippet picker(field: FieldEditor)}
	{@const value = typeof field.value === 'string' ? field.value : null}
	<Combobox
		id={field.id}
		{value}
		{options}
		{...value === null ? {} : { display: value }}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		loading={laws.loading}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

<Field {ctx} name="catalog_code" editor={picker} />
