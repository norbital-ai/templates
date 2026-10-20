<script lang="ts">
	import { type RecordView, Form, RecordShell } from '@norbital-ai/ui';
	let { view }: { view: RecordView<'photo_evidence'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	// The readonly provenance renderer cannot supply the create form's required value.
	const values = $derived({
		...(view.mode === 'create' ? view.values : {}),
		source: { kind: 'workspace_upload' as const }
	});
</script>

{#if record === null}
	<RecordShell of="photo_evidence" mode="create" {values}>
		<Form
			of="photo_evidence"
			mode="create"
			{values}
			fields={['job_assignment_id', 'variation_request_id', 'photo']}
		/>
	</RecordShell>
{:else}
	<RecordShell of="photo_evidence" id={record.id} />
{/if}
