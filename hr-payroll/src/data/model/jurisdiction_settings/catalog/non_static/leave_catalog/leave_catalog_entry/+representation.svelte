<script lang="ts">
	import { Button, Form, RecordShell, Sheet, type RecordView } from '@norbital-ai/ui';
	import LeaveEntryForm from '../../../../../../../lib/ui/person/leave_entry_form.svelte';
	import ReversalCancel from '../../../../../../../lib/ui/person/reversal_cancel.svelte';
	import { Stack } from '@norbital-ai/ui/layout';
	import { bolt } from '$bolt';

	let { view }: { view: RecordView<'leave_catalog_entry'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	// the entry being reversed, held apart from the shown record, which reloads under the sheet once it files
	let reversing = $state<typeof record>(null);
	// the HR controller changes and reverses an entry; self-service only reads its own
	const isHr =
		typeof window === 'undefined' || window.location.pathname.includes('/app/hr_controller/');
	const held = $derived(
		record === null
			? null
			: bolt.query({
					leave_catalog_entry_day: {
						where: { leave_entry_id: { eq: record.id }, payroll_run_id: { isNull: false } },
						fields: ['id'],
						limit: 1
					},
					leave_catalog_entry: {
						where: { reverses: { eq: record.id } },
						fields: ['id'],
						limit: 1
					}
				})
	);
	// a forward entry with a sealed half-day, reversed once
	const canReverse = $derived(
		record !== null &&
			record.reverses == null &&
			held?.current?.leave_catalog_entry_day.rows.length === 1 &&
			held.current.leave_catalog_entry.rows.length === 0
	);
	// a reversal no run has paid is cancelled by the ordinary delete
	const canCancel = $derived(
		record !== null &&
			record.reverses != null &&
			view.mode !== 'create' &&
			view.capabilities?.delete.allowed === true &&
			held?.current?.leave_catalog_entry_day.rows.length === 0
	);
</script>

{#snippet reverseAction()}
	<Button
		variant="outline"
		disabled={!canReverse}
		title={canReverse
			? undefined
			: 'Only a forward entry with a half-day a payroll run sealed is reversed, once; an open half-day is removed instead.'}
		onclick={() => (reversing = record)}
	>
		Reverse entry
	</Button>
{/snippet}

{#snippet cancelAction()}{#if record !== null}<ReversalCancel
			of="leave_catalog_entry"
			id={record.id}
		/>{/if}{/snippet}

<RecordShell
	of="leave_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	footerActions={record === null || !isHr
		? undefined
		: record.reverses == null
			? reverseAction
			: canCancel
				? cancelAction
				: undefined}
>
	{#if record === null}
		<Form
			of="leave_catalog_entry"
			mode="create"
			values={view.mode === 'create' ? view.values : {}}
			fields={['employment_id', 'catalog_id', 'evidence_file']}
		/>
	{:else}
		<Stack gap="md">
			<LeaveEntryForm
				entityId={record.entity_id}
				employmentId={record.employment_id}
				catalogId={record.catalog_id}
				entry={record.id}
				person={isHr}
				locked={!isHr || record.reverses != null}
			/>
			<Form
				of="leave_catalog_entry"
				mode="update"
				id={record.id}
				{record}
				fields={record.reverses == null ? ['evidence_file'] : ['reverses', 'evidence_file']}
			/>
		</Stack>
	{/if}
</RecordShell>

{#if reversing !== null}
	<Sheet open onOpenChange={(open) => !open && (reversing = null)} title="Reverse leave">
		<LeaveEntryForm
			entityId={reversing.entity_id}
			employmentId={reversing.employment_id}
			catalogId={reversing.catalog_id}
			reverses={reversing.id}
			encashment={reversing.encashment}
			person
			onDone={() => (reversing = null)}
		/>
	</Sheet>
{/if}
