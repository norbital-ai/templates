<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Picker, use_form, type FieldEditor } from '@norbital-ai/ui';
	import { idOf } from '../../reads.js';

	/** Employment picker scoped to the form's current (or fixed) company. */
	let {
		ctx,
		entityId = null,
		disabled = false
	}: {
		ctx: PageContext;
		entityId?: string | null;
		disabled?: boolean;
	} = $props();
	const form = use_form();
	const scopedEntity = $derived.by(() => {
		const raw = form?.get('entity_id');
		return typeof raw === 'string' ? raw : entityId;
	});
</script>

{#snippet employmentEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="employment"
		id={field.id}
		{...scopedEntity === null ? {} : { where: { entity_id: { eq: idOf('entity', scopedEntity) } } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

<Field {ctx} name="employment_id" {disabled} editor={employmentEditor} />
