<script lang="ts">
	/** A received message: read-only; messages are filed by the channel, never typed here. */
	import { bolt } from '$bolt';
	import type { RecordView } from '@norbital-ai/ui';
	import { EmptyState, RecordShell } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'communication_logs'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

{#if record == null}
	<EmptyState title={bolt.t('component.communication_recorded_automatically')} />
{:else}
	<RecordShell of="communication_logs" id={record.id} subtitle={['sender', 'sent_at']} />
{/if}
