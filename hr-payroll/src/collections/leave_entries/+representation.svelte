<script lang="ts">
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { client } from '../../lib/workspace-client.js';
	import type { RepresentationProps } from './$types.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { defaultTimeOffEvent } from '../../datatypes/leave_event/+definition.js';
	import {
		employmentRelationOptions,
		hrCreateScope,
		inForceCatalogue
	} from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const scope = hrCreateScope();
	const employmentId = $derived(scope?.employmentId?.());
	const defaultValues = $derived(
		record ?? {
			...(employmentId == null ? {} : { employment_id: employmentId }),
			event: defaultTimeOffEvent(todayKey())
		}
	);
</script>

<RecordShell title={record?.reference ?? t('component.create_leave_entry')}>
	<CollectionForm
		{client}
		collection="leave_entries"
		{defaultValues}
		disabled={record != null}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Grid gap="md" minimum="panel">
				<Field
					name="employment_id"
					label={t('component.person')}
					hidden={employmentId != null}
					relationOptions={employmentRelationOptions(scope?.companyId())}
				/>
				<Field
					name="leave_catalogue_id"
					label={t('component.catalogue_leave')}
					relationOptions={{
						label: (row) => [row.code, row.name].filter(Boolean).join(' · '),
						where: { ...inForceCatalogue('leave_catalogue_settings', scope?.settingsCode()) },
						orderBy: { code: 'asc' },
						limit: 500
					}}
				/>
				<Field name="reference" label={t('component.reference')} />
				<Field name="certificate_file" label={t('component.certificate')} />
				<Column span="all"><Field name="event" label={t('leave.activity')} /></Column>
				<!-- Resolved and frozen by the before hook; callers never supply them. -->
				<Field name="leave_code" hidden />
				<Field name="charges" hidden />
				<Field name="allocations" hidden />
			</Grid>
		{/snippet}
	</CollectionForm>
	{#if record != null}<p class="text-meta">{t('leave.immutable')}</p>{/if}
</RecordShell>
