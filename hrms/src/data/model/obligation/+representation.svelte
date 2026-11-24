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
	import { Grid } from '@norbital-ai/ui/layout';
	import { idOf } from '../../../lib/reads.js';
	let { view, ctx }: { view: RecordView<'obligation'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const controller = use_record_controller();
	const liveForm = $derived(controller?.current ?? null);
	const fixedEntity = $derived(
		record?.entity_id ??
			(view.mode === 'create' && typeof view.values.entity_id === 'string'
				? view.values.entity_id
				: null)
	);
	const scopedEntity = $derived.by(() => {
		const raw = liveForm?.get('entity_id');
		return typeof raw === 'string' ? raw : fixedEntity;
	});
</script>

{#snippet employeeEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="employee_profile"
		id={field.id}
		{...scopedEntity === null
			? {}
			: { where: { employment: { some: { entity_id: { eq: idOf('entity', scopedEntity) } } } } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

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
	of="obligation"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="obligation"
		mode={view.mode === 'create' ? 'create' : 'update'}
		size="content"
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}
			<Grid minimum="card">
				{#if record === null}
					{#if fixedEntity === null}<Field {ctx} name="entity_id" />{/if}
					<Field {ctx} name="employee_id" editor={employeeEditor} />
					<Field {ctx} name="employment_id" editor={employmentEditor} />
					<Field {ctx} name="title" />
					<Field {ctx} name="due_on" />
				{:else}
					{#each ['title', 'due_on', 'fulfilled_on', 'evidence', 'waiver_reason', 'state'] as name (name)}<Field
							{ctx}
							{name}
						/>{/each}
				{/if}
			</Grid>
		{/snippet}
	</Form>
</RecordShell>
