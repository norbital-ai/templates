<script lang="ts">
	/**
	 * One photo and its captured evidence facts, read only.
	 *
	 * Nothing here is written by hand — the ingest pipeline hashes the image and records what it
	 * matched — so this panel explains a result rather than offering to change one. The auto form
	 * offered all four uuid columns as editable text boxes: the two links, the stored image, and the
	 * list of evidence this photo duplicates.
	 *
	 * `matched_evidence_ids` points back at this same collection, so each match reads as the other
	 * photo's own `summary` — which is why that column had to exist before this panel could.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { collectionClient } from '../../lib/collection-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';

	let { record }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();
	const suspicionReadAccessQuery = client.system.access.explain({
		action: 'read',
		resource: 'suspicious_activity_logs'
	});
	const mayReadReviewFacts = $derived(suspicionReadAccessQuery.current?.allowed === true);
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/field-operations/record-media/photo_evidence-banner.svg"
	/>
</svelte:head>

{#if record}
	<CollectionForm
		client={collectionClient}
		collection="photo_evidence"
		defaultValues={record}
		disabled
	>
		{#snippet children({ Field })}
			<Grid minimum="compact">
				<!-- A file() column: the value carries the file's own name, which is what DataRenderer
				paints, so no key or id reaches the operator. -->
				<Column span="all"><Field name="photo" label={t('component.photo')} /></Column>
				<Field
					name="job_assignment_id"
					label={t('component.job_assignment')}
					renderer={RelationshipRenderer}
					rendererProps={{
						target: 'job_assignments',
						options: {
							label: (record) => {
								const dispatched = record.dispatched_at;
								const when = dispatched == null ? null : String(dispatched).slice(0, 10);
								return (
									[when, record.status].filter((part) => part != null && part !== '').join(' · ') ||
									'—'
								);
							},
							orderBy: { dispatched_at: 'desc' },
							limit: 500
						}
					}}
				/>
				<Field
					name="variation_request_id"
					label={t('component.variation_request')}
					renderer={RelationshipRenderer}
					rendererProps={{
						target: 'variation_requests',
						options: {
							label: (record) =>
								record.title != null && record.title !== '' ? String(record.title) : '—',
							orderBy: { requested_at: 'desc' },
							limit: 500
						}
					}}
				/>
				{#if mayReadReviewFacts}
					<Column span="all"><Field name="source" label={t('component.source')} /></Column>
					<Column span="all"><Field name="flags" label={t('component.integrity_flags')} /></Column>
					<Column span="all">
						<Field
							name="matched_evidence_ids"
							label={t('component.duplicates_of')}
							renderer={RelationshipRenderer}
							rendererProps={{
								target: 'photo_evidence',
								multiple: true,
								options: {
									label: (record) =>
										record.summary != null && record.summary !== '' ? String(record.summary) : '—',
									limit: 500
								}
							}}
						/>
					</Column>
				{/if}
			</Grid>
		{/snippet}
	</CollectionForm>
{:else}
	<p class="text-sm text-muted-foreground">
		{t('component.evidence_write_only')}
	</p>
{/if}
