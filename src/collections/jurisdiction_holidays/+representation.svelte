<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { getContext } from 'svelte';
	import { HOLIDAY_JURISDICTION } from '../../lib/holiday-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const consumed = $derived(record?.consumed_at != null);
	const scopedJurisdiction = getContext<(() => string) | undefined>(HOLIDAY_JURISDICTION);
	const defaults = $derived(
		record ?? (scopedJurisdiction ? { jurisdiction_code: scopedJurisdiction() } : undefined)
	);
</script>

<RecordShell title={record ? `${record.date} · ${record.name}` : t('holiday_calendar.add')}>
	<Stack gap="md">
		{#if consumed}<p class="text-sm text-muted-foreground">
				{t('holiday_calendar.consumed_hint')}
			</p>{/if}
		<CollectionForm
			{client}
			collection="jurisdiction_holidays"
			defaultValues={defaults}
			onAfterSubmit={record ? undefined : close}
		>
			{#snippet children({ Field, form })}
				<Field name="consumed_at" hidden />
				<Field name="source" hidden />
				<Grid gap="md" minimum="compact">
					<Field
						name="jurisdiction_code"
						label={t('holiday_calendar.jurisdiction')}
						readonly={consumed}
					/>
					<Field name="date" label={t('component.observed_on')} readonly={consumed} />
					<Column span="all"
						><Field name="name" label={t('component.holiday')} readonly={consumed} /></Column
					>
					<Field
						name="original_date"
						label={t('holiday_calendar.original_date')}
						readonly={consumed}
					/>
					<Column span="all">
						<label class="flex items-start gap-2 text-sm">
							<input
								type="checkbox"
								disabled={consumed && form.values().published_at != null}
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
