<script lang="ts">
	/**
	 * A suspicion's judgement is immutable after creation. Existing rows are therefore presented as
	 * an audit record; the only lifecycle write is the explicit resolution action on the assignment's
	 * restricted Suspicion logs tab, where the evidence is visible beside it.
	 */
	import { collectionClient } from '../../lib/collection-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import Icon from '@iconify/svelte';
	import { formatSingaporeInstant } from '../../lib/format-singapore-instant.js';

	let { record, close }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();
</script>

{#if record}
	<Stack gap="md">
		<Inline align="center" gap="sm">
			<Icon
				icon={record.resolved_at == null ? 'lucide:shield-alert' : 'lucide:shield-check'}
				class={record.resolved_at == null
					? 'size-4 shrink-0 text-warning'
					: 'size-4 shrink-0 text-muted-foreground'}
				aria-hidden="true"
			/>
			<h3 class="text-sm font-semibold">
				{record.resolved_at == null
					? t('component.suspicion_open')
					: t('component.suspicion_resolved')}
			</h3>
		</Inline>
		<section aria-labelledby="suspicion-judgement-heading">
			<Stack gap="xs">
				<h4 id="suspicion-judgement-heading" class="text-xs font-medium text-muted-foreground">
					{t('component.suspicion_judgement')}
				</h4>
				<p class="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
					{record.reason}
				</p>
			</Stack>
		</section>
		{#if record.basis}
			<section aria-labelledby="suspicion-basis-heading">
				<Stack gap="xs">
					<h4 id="suspicion-basis-heading" class="text-xs font-medium text-muted-foreground">
						{t('component.suspicion_basis')}
					</h4>
					<p class="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
						{record.basis}
					</p>
				</Stack>
			</section>
		{/if}
		{#if record.resolved_at != null && record.resolution}
			<section aria-labelledby="suspicion-resolution-heading">
				<Stack gap="xs">
					<h4 id="suspicion-resolution-heading" class="text-xs font-medium text-muted-foreground">
						{t('component.suspicion_resolution')}
					</h4>
					<p class="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
						{record.resolution}
					</p>
					<p class="text-meta">
						{t('component.suspicion_resolved_at', {
							instant: formatSingaporeInstant(record.resolved_at, t('component.not_recorded'))
						})}
					</p>
				</Stack>
			</section>
		{:else if record.resolved_at != null}
			<p class="text-sm text-muted-foreground">
				{t('component.suspicion_resolution_missing')}
			</p>
		{:else}
			<p class="text-sm text-muted-foreground">
				{t('component.suspicion_resolve_from_assignment')}
			</p>
		{/if}
	</Stack>
{:else}
	<CollectionForm
		client={collectionClient}
		collection="suspicious_activity_logs"
		onAfterSubmit={close}
	>
		{#snippet children({ Field })}
			<Field name="origin" hidden />
			<Field name="basis" hidden />
			<Field name="review_id" hidden />
			<Field name="evidence_id" hidden />
			<Field name="resolution" hidden />
			<Field name="resolved_at" hidden />
			<Field name="resolved_by" hidden />
			<Grid minimum="panel">
				<Field
					name="job_assignment_id"
					label={t('component.job_assignment')}
					relationOptions={{
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
					}}
				/>
				<Field name="reason" label={t('component.suspicion_judgement')} />
			</Grid>
		{/snippet}
	</CollectionForm>
{/if}
