<script lang="ts">
	import { type RecordView, type UiContext, Form, RecordShell } from '@norbital-ai/ui';
	let { ctx, view }: { ctx: UiContext; view: RecordView<'photo_evidence'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	// a photo filed here is a workspace upload: its create callback states the source
	const values = $derived(view.mode === 'create' ? view.values : {});
</script>

{#if record === null}
	<RecordShell {ctx} of="photo_evidence" mode="create" {values}>
		<Form
			{ctx}
			of="photo_evidence"
			mode="create"
			{values}
			fields={['job_assignment_id', 'photo']}
		/>
	</RecordShell>
{:else}
	<RecordShell {ctx} of="photo_evidence" id={record.id} />
{/if}
