<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { Result, Schema } from 'effect';
	import HolidayImportReview from '../../lib/ui/holiday-import-review.svelte';
	import { holidayImportReviewSchema } from '../../datatypes/holiday_import_review/+definition.js';
	import { holidayObservationInputSchema } from '../../datatypes/holiday_observations/+definition.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const published = $derived(record?.published_at != null);
	const decodeReview = Schema.decodeUnknownResult(holidayImportReviewSchema);
	const decodeObservations = Schema.decodeUnknownResult(
		Schema.Array(holidayObservationInputSchema)
	);
</script>

<RecordShell title={t('holiday_calendar.title')}>
	<Stack gap="md">
		{#if published}<p class="text-sm text-muted-foreground">
				{t('holiday_calendar.published_hint')}
			</p>{/if}
		<CollectionForm
			{client}
			collection="jurisdiction_holiday_calendars"
			defaultValues={record ?? { revision: 1, observations: [] }}
			disabled={published}
			onAfterSubmit={record ? undefined : close}
		>
			{#snippet children({ Field, form })}
				<Field name="published_at" hidden />
				<Field name="import_review" hidden />
				<Grid gap="md" minimum="compact">
					<Field name="jurisdiction_code" label={t('holiday_calendar.jurisdiction')} />
					<Field name="year" label={t('holiday_calendar.year')} />
					<Field name="revision" label={t('holiday_calendar.revision')} />
					<Column span="all"
						><Field name="observations" label={t('holiday_calendar.observations')} /></Column
					>
					<Column span="all">
						{#if form.values().import_review != null}
							{@const review = decodeReview(form.values().import_review)}
							{@const observations = decodeObservations(form.values().observations ?? [])}
							{#if Result.isSuccess(review) && Result.isSuccess(observations)}
								<HolidayImportReview
									review={review.success}
									observations={observations.success}
									disabled={published}
									onchange={(value) => form.setValues({ ...form.values(), ...value })}
								/>
							{:else}
								<p class="text-sm text-destructive" role="alert">
									{Result.isFailure(review)
										? review.failure.message
										: Result.isFailure(observations)
											? observations.failure.message
											: ''}
								</p>
							{/if}
						{/if}
					</Column>
					<Column span="all">
						<label class="flex items-start gap-2 text-sm">
							<input
								type="checkbox"
								disabled={published}
								checked={form.values().published_at != null}
								onchange={(event) =>
									form.setValues({
										...form.values(),
										published_at: event.currentTarget.checked ? new Date().toISOString() : null
									})}
							/>
							{t('holiday_calendar.publish_on_save')}
						</label>
					</Column>
				</Grid>
			{/snippet}
		</CollectionForm>
	</Stack>
</RecordShell>
