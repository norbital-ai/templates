<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView } from '@norbital-ai/ui';
	import LeaveEntryForm from '../../../../lib/ui/person/leave_entry_form.svelte';
	let { view, ctx }: { view: RecordView<'leave_catalog_entry'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const isHr =
		typeof window === 'undefined' || window.location.pathname.includes('/app/hr_controller/');
</script>

{#if record !== null}
	<LeaveEntryForm
		{ctx}
		entityId={record.entity_id}
		employmentId={record.employment_id}
		catalogCode={record.catalog_code}
		entry={record.id}
		person={isHr}
		locked={!isHr}
	/>
{:else if view.mode === 'create'}
	<LeaveEntryForm
		{ctx}
		person={isHr}
		entityId={view.values.entity_id ?? null}
		employmentId={view.values.employment_id ?? null}
		catalogCode={view.values.catalog_code ?? null}
	/>
{/if}
