<script lang="ts">
	/**
	 * One observed holiday of one entity. The entity is the page's, not a choice: the table this form opens from is
	 * already scoped to one, and offering it again is how a row lands on the wrong calendar. Publishing is a checkbox
	 * over `published_at`.
	 */
	import { t } from '../../../lib/ui/t.js';
	import { Field, Form } from '@norbital-ai/ui';
	import { Column, Grid, Inline } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'jurisdiction_holidays'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
</script>

<RecordShell
	of="jurisdiction_holidays"
	{...record == null ? {} : { id: record.id }}
	mode={view.mode}
>
	<Form of="jurisdiction_holidays" mode={view.mode} {record} {values}>
		<Grid gap="md" minimum="compact">
			{#if record == null}
				<Field name="company_id" label={t('component.company')} />
			{/if}
			<Field name="date" label={t('component.observed_on')} />
			<Field name="kind" label={t('holiday_calendar.kind')} />
			<Field name="given_to" label={t('holiday_calendar.given_to')} />
			<Field name="worksite" label={t('component.worksite')} />
			<Field name="religion" label={t('component.religion')} />
			<Field name="applies_when" label={t('component.applies_when')} />
			<Column span="all"><Field name="name" label={t('component.holiday')} /></Column>
			<Field name="replaces" label={t('holiday_calendar.replaces')} />
			<Column span="all">
				<Field name="published_at">
					{#snippet editor(field)}
						<label class="text-sm">
							<Inline as="span" gap="sm" align="start">
								<input
									type="checkbox"
									checked={field.value != null}
									disabled={field.disabled}
									onchange={(event) =>
										field.onChange(event.currentTarget.checked ? new Date().toISOString() : null)}
								/>
								{t('holiday_calendar.published')}
							</Inline>
						</label>
					{/snippet}
				</Field>
			</Column>
		</Grid>
	</Form>
</RecordShell>
