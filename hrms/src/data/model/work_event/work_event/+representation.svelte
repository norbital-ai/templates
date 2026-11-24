<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Field,
		Form,
		Picker,
		RecordShell,
		use_record_controller,
		type FieldEditor,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { idOf } from '../../../../lib/reads.js';
	import CatalogField from '../../../../lib/ui/settings/catalog_field.svelte';
	let { view, ctx }: { view: RecordView<'work_event'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const controller = use_record_controller();
	const liveForm = $derived(controller?.current ?? null);
	const fixedEntity = $derived(
		record?.entity_id ??
			(view.mode === 'create' && typeof view.values.entity_id === 'string'
				? view.values.entity_id
				: null)
	);
	const fixedEmployment = $derived(
		view.mode === 'create' && typeof view.values.employment_id === 'string'
			? view.values.employment_id
			: null
	);
	const scopedEntity = $derived.by(() => {
		const raw = liveForm?.get('entity_id');
		return typeof raw === 'string' ? raw : fixedEntity;
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

<RecordShell
	{ctx}
	of="work_event"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="work_event"
		mode={view.mode}
		size="content"
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}
			<Stack gap="md">
				<Grid minimum="card">
					{#if record === null && fixedEntity === null}<Field {ctx} name="entity_id" />{/if}
					<CatalogField {ctx} of="work_event_catalog" dated="from" />
					<Field
						{ctx}
						name="employment_id"
						disabled={fixedEmployment !== null}
						editor={employmentEditor}
					/>
					{#each ['from', 'to', 'location'] as name (name)}<Field {ctx} {name} />{/each}
				</Grid>
				{#each ['description', 'evidence_file'] as name (name)}<Field {ctx} {name} />{/each}
			</Stack>
		{/snippet}
	</Form>
</RecordShell>
