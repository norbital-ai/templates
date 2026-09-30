<script lang="ts">
	/** One automated review: its decision, reason and the basis it judged. Written by the review run only. */
	import { bolt } from '$bolt';
	import type { RecordView } from '@norbital-ai/ui';
	import { EmptyState, RecordShell } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'suspicion_reviews'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

{#if record == null}
	<EmptyState title={bolt.t('component.suspicion_review_read_only')} />
{:else}
	<RecordShell
		of="suspicion_reviews"
		id={record.id}
		subtitle={record.suspicious
			? bolt.t('component.suspicion_open')
			: bolt.t('component.suspicion_review_decision')}
	/>
{/if}
