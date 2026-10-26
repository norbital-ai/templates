<script lang="ts">
	/** One automated review: its decision, reason and the evidence it judged. Written by the review run only. */
	import { bolt } from '$bolt';
	import { type RecordView, EmptyState, Field, Form, RecordShell, Section } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import EvidenceBasis from '../../../lib/evidence-basis.svelte';
	let {
		view
	}: {
		view: RecordView<'suspicion_reviews'>;
	} = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
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
	>
		<!-- the decision and why stay open; the judged evidence and the model fold away -->
		<Form of="suspicion_reviews" mode="update" id={record.id} {record} readonly>
			{#snippet children()}
				<Section first name="review" title={bolt.t('models.suspicion_reviews.singular')}>
					<Grid minimum="compact">
						<Field name="suspicious" />
						<Field name="job_assignment_id" />
						<Field name="evidence_id" />
						<Field name="reviewed_at" />
						<Field name="reason" class="col-span-full" />
					</Grid>
				</Section>
				<Section
					name="basis"
					title={bolt.t('component.section_basis')}
					defaultOpen={false}
					summary={record.model}
				>
					<Grid minimum="compact">
						<Field name="model" />
						<Field name="basis">
							{#snippet view()}<EvidenceBasis
									basis={record.basis}
									job={record.job_assignment_id}
								/>{/snippet}
						</Field>
					</Grid>
				</Section>
			{/snippet}
		</Form>
	</RecordShell>
{/if}
