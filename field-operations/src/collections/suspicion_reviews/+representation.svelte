<script lang="ts">
	/**
	 * A model review is an immutable audit receipt. Relationships are rendered with human labels and
	 * technical idempotency keys stay out of the operator-facing representation.
	 */
	import { collectionClient } from '../../lib/collection-client.js';
	import { jobAssignmentLabel } from '../../lib/job-assignment-label.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';

	let { record }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();
</script>

{#if record}
	<CollectionForm
		client={collectionClient}
		collection="suspicion_reviews"
		defaultValues={record}
		disabled
	>
		{#snippet children({ Field })}
			<Field name="basis_hash" hidden />
			<Field name="source_key" hidden />
			<Grid minimum="compact">
				<Column span="all">
					<Field
						name="job_assignment_id"
						label={t('component.job_assignment')}
						relationOptions={{
							label: jobAssignmentLabel,
							orderBy: { dispatched_at: 'desc' },
							limit: 500
						}}
					/>
				</Column>
				<Field name="suspicious" label={t('component.suspicion_review_decision')} />
				<Field name="reviewed_at" label={t('component.suspicion_reviewed_at')} />
				<Column span="all">
					<Field name="reason" label={t('component.suspicion_judgement')} />
				</Column>
				<Column span="all">
					<Field name="basis" label={t('component.suspicion_basis')} />
				</Column>
				<Field
					name="evidence_id"
					label={t('component.evidence')}
					relationOptions={{
						label: (evidence) =>
							typeof evidence.summary === 'string' && evidence.summary !== ''
								? evidence.summary
								: t('component.evidence'),
						limit: 500
					}}
				/>
				<Field name="model" label={t('component.suspicion_review_model')} />
			</Grid>
		{/snippet}
	</CollectionForm>
{:else}
	<p class="text-sm text-muted-foreground">
		{t('component.suspicion_review_read_only')}
	</p>
{/if}
