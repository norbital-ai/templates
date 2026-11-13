<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import CatalogField from '../../../../lib/ui/settings/catalog_field.svelte';
	import LeaveEntryForm from '../../../../lib/ui/person/leave_entry_form.svelte';
	import { Stack } from '@norbital-ai/ui/layout';

	let { view, ctx }: { view: RecordView<'leave_catalog_entry'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	// the HR controller changes an entry; self-service only reads its own
	const isHr =
		typeof window === 'undefined' || window.location.pathname.includes('/app/hr_controller/');
</script>

<RecordShell
	{ctx}
	of="leave_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record === null}
		<Form
			{ctx}
			of="leave_catalog_entry"
			mode="create"
			values={view.mode === 'create' ? view.values : {}}
		>
			{#snippet children()}<Stack gap="md">
					<Field {ctx} name="employment_id" />
					<CatalogField {ctx} of="leave_catalog" />
					<Field {ctx} name="evidence_file" />
				</Stack>{/snippet}
		</Form>
	{:else}
		<Stack gap="md">
			<LeaveEntryForm
				{ctx}
				entityId={record.entity_id}
				employmentId={record.employment_id}
				catalogCode={record.catalog_code}
				entry={record.id}
				person={isHr}
				locked={!isHr}
			/>
			<Form
				{ctx}
				of="leave_catalog_entry"
				mode="update"
				id={record.id}
				{record}
				fields={['evidence_file']}
			/>
		</Stack>
	{/if}
</RecordShell>
