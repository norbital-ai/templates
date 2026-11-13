<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import LeaveEntryForm from '../../../../../../../lib/ui/person/leave_entry_form.svelte';
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
			fields={['employment_id', 'catalog_id', 'evidence_file']}
		/>
	{:else}
		<Stack gap="md">
			<LeaveEntryForm
				{ctx}
				entityId={record.entity_id}
				employmentId={record.employment_id}
				catalogId={record.catalog_id}
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
