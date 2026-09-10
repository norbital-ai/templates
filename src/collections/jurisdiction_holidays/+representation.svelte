<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { getContext } from 'svelte';
	import { HOLIDAY_COMPANY } from '../../lib/holiday-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const scopedCompany = getContext<(() => string) | undefined>(HOLIDAY_COMPANY);
	const defaults = $derived(
		record ?? (scopedCompany ? { company_id: scopedCompany() } : undefined)
	);
</script>

<RecordShell title={record ? `${record.date} · ${record.name}` : t('holiday_calendar.add')}>
	<Stack gap="md">
		<CollectionForm
			{client}
			collection="jurisdiction_holidays"
			defaultValues={defaults}
			onAfterSubmit={record ? undefined : close}
		>
			{#snippet children({ Field, form })}
				<Field name="source" hidden />
				<!-- The entity is the page's, not a choice: the table this form opens from is already
				     scoped to one, and offering it again is how a row lands on the wrong calendar. -->
				<Field name="company_id" hidden />
				<Grid gap="md" minimum="compact">
					<Field name="date" label={t('component.observed_on')} />
					<Field name="kind" label={t('holiday_calendar.kind')} />
					<Column span="all"><Field name="name" label={t('component.holiday')} /></Column>
					<Field name="original_date" label={t('holiday_calendar.original_date')} />
					<Column span="all">
						<label class="flex items-start gap-2 text-sm">
							<input
								type="checkbox"
								checked={form.values().published_at != null}
								onchange={(event) =>
									form.setValues({
										...form.values(),
										published_at: event.currentTarget.checked ? new Date().toISOString() : null
									})}
							/>
							{t('holiday_calendar.published')}
						</label>
					</Column>
					<Field name="published_at" hidden />
				</Grid>
			{/snippet}
		</CollectionForm>
	</Stack>
</RecordShell>
