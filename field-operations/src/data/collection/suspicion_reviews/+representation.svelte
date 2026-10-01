<script lang="ts">
	/** One automated review: its decision, reason and the basis it judged. Written by the review run only. */
	import { bolt } from '$bolt';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import { EmptyState, RecordShell } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'suspicion_reviews'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	// the decision and why stay open; the judged snapshot, its hash and the model fold away
	const sections: RecordSection[] = [
		{
			name: 'review',
			title: bolt.t('models.suspicion_reviews.singular'),
			fields: ['suspicious', 'reason', 'job_assignment_id', 'evidence_id', 'reviewed_at']
		},
		{
			name: 'basis',
			title: bolt.t('component.section_basis'),
			fields: ['basis', 'model', 'basis_hash', 'source_key'],
			defaultOpen: false,
			summary: (r) => String(r.model ?? '')
		}
	];
</script>

{#if record == null}
	<EmptyState title={bolt.t('component.suspicion_review_read_only')} />
{:else}
	<RecordShell
		of="suspicion_reviews"
		id={record.id}
		{sections}
		subtitle={record.suspicious
			? bolt.t('component.suspicion_open')
			: bolt.t('component.suspicion_review_decision')}
	/>
{/if}
