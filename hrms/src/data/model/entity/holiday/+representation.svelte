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
	import { idOf } from '../../../../lib/reads.js';
	import { paidPeriods } from '../../../../lib/ui/payroll/paid_period.svelte.js';
	let { view, ctx }: { view: RecordView<'holiday'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const paid = paidPeriods(ctx);
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

<RecordShell
	{ctx}
	of="holiday"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="holiday"
		mode={view.mode === 'create' ? 'create' : 'update'}
		size="content"
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		confirm={paid.confirm(() => false, ['date'], 'entity_id')}
	>
		{#snippet children()}
			<Grid minimum="card">
				{#if record === null && fixedEntity === null}<Field {ctx} name="entity_id" />{/if}
				{#each ['date', 'name', 'kind', 'replaces', 'given_to'] as name (name)}<Field
						{ctx}
						{name}
					/>{/each}
				<Field {ctx} name="employee_id" editor={employeeEditor} />
			</Grid>
		{/snippet}
	</Form>
</RecordShell>
