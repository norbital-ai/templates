<script lang="ts">
	/** A received message: read-only; messages are filed by the WhatsApp envoy, never typed here. */
	import { bolt } from '$bolt';
	import { type RecordView, EmptyState, RecordShell } from '@norbital-ai/ui';
	let {
		view
	}: {
		view: RecordView<'communication_logs'>;
	} = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
</script>

{#if record == null}
	<EmptyState title={bolt.t('component.communication_recorded_automatically')} />
{:else}
	<RecordShell
		of="communication_logs"
		id={record.id}
		subtitle={['sender', 'sent_at']}
		fields={['message', 'sender', 'sent_at', 'job_assignment_id']}
		sections={[
			{
				name: 'message',
				title: bolt.t('section.message'),
				fields: ['message']
			},
			{
				name: 'delivery',
				title: bolt.t('section.delivery'),
				fields: ['sender', 'sent_at', 'job_assignment_id'],
				defaultOpen: false,
				summary: (row) => String(row.sender ?? '—')
			}
		]}
	/>
{/if}
