<script lang="ts">
	/** One automated review: its decision, reason and the evidence it judged. Written by the review run only. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { type RecordView, EmptyState, Field, Form, RecordShell, Section } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import EvidenceBasis from '../../../../../lib/evidence-basis.svelte';
	let {
		ctx,
		view
	}: {
		ctx: PageContext;
		view: RecordView<'suspicion_reviews'>;
	} = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
</script>

{#if record == null}
	<EmptyState title={ctx.t('component.suspicion_review_read_only')} />
{:else}
	<RecordShell
		of="suspicion_reviews"
		id={record.id}
		subtitle={record.suspicious
			? ctx.t('component.suspicion_open')
			: ctx.t('component.suspicion_review_decision')}
	>
		<!-- the decision and why stay open; the judged evidence and the model fold away -->
		<Form of="suspicion_reviews" mode="update" id={record.id} {record} readonly>
			{#snippet children()}
				<Section
					icon="lucide:search-check"
					first
					name="review"
					title={ctx.t('models.suspicion_reviews.singular')}
				>
					<Grid minimum="compact">
						<Field name="suspicious" />
						<Field name="job_assignment_id" />
						<Field name="evidence_id" />
						<Field name="reviewed_at" />
						<Field name="reason" class="col-span-full" />
					</Grid>
				</Section>
				<Section
					icon="lucide:list-checks"
					name="basis"
					title={ctx.t('component.section_basis')}
					default_open={false}
					summary={record.model}
				>
					<Grid minimum="compact">
						<Field name="model" />
						<Field name="basis">
							{#snippet view()}<EvidenceBasis
									{ctx}
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
