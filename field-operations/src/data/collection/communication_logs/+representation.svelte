<script lang="ts">
	/** A received message: read-only; messages are filed by the channel, never typed here. */
	import { bolt } from '$bolt';
	import type { RecordView } from '@norbital-ai/ui';
	import { RecordShell } from '@norbital-ai/ui';
	import { singaporeInstant } from '../../../lib/format.js';

	let { view }: { view: RecordView<'communication_logs'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

{#if record == null}
	<p class="text-sm text-muted-foreground">
		{bolt.t('component.communication_recorded_automatically')}
	</p>
{:else}
	<RecordShell
		of="communication_logs"
		id={record.id}
		subtitle={`${record.sender} · ${singaporeInstant(String(record.sent_at))}`}
	/>
{/if}
