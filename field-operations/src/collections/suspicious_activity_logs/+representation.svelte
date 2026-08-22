<script lang="ts">
	/**
	 * A finding raised against one assignment, and the controller's answer to it.
	 *
	 * The auto form painted both uuids as editable text boxes: the assignment the finding hangs on
	 * and the controller who answered. The assignment reads as its own record through the
	 * relationship, and the answer a controller wrote (`resolved_by`) is a person.
	 */
	import { collectionClient } from '../../lib/collection-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';

	let { record, close }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();
</script>

<CollectionForm
	client={collectionClient}
	collection="suspicious_activity_logs"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid minimum="panel">
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
			<Field name="reason" />
			<Field name="resolution" />
			<Column span="all"><Field name="resolved_at" /></Column>
			<Column span="all">
				<Field
					name="resolved_by"
					renderer={RelationshipRenderer}
					rendererProps={{
						target: 'bolt_auth_user',
						options: {
							label: (record) =>
								record.name != null && record.name !== '' ? String(record.name) : '—',
							orderBy: { name: 'asc' },
							limit: 500
						}
					}}
				/>
			</Column>
		</Grid>
	{/snippet}
</CollectionForm>
