<script lang="ts">
	/**
	 * One observed holiday of one entity. The entity is the page's, not a choice: the table this form opens from is
	 * already scoped to one, and offering it again is how a row lands on the wrong calendar. Publishing is a checkbox
	 * over `published_at`.
	 */
	import { t } from '../../../lib/ui/t.js';
	import { Field, Form, Section } from '@norbital-ai/ui';
	import { Column, Grid, Inline } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import { bolt } from '$bolt';
	import CodeSelect from '../../../lib/ui/code-select.svelte';
	import { CODED_FIELDS } from '../../../lib/coded-fields.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';

	let { view }: { view: RecordView<'jurisdiction_holidays'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	type FormApi = { get(name: string): unknown };
	const companies = liveRows<{ id: string; settings_code: string }>(() =>
		bolt.read('companies', { select: { settings_code: true }, all: true })
	);
	const settingsCodeOf = (companyId: unknown): string =>
		companies.current?.find((row) => row.id === String(companyId ?? ''))?.settings_code ?? '';
</script>

{#snippet coded(form: FormApi, name: 'worksite' | 'religion', label: string)}
	<!-- A local day's worksite is a wage place of the entity's lineage; its religions are RELIGION codes. -->
	<Field {name} {label}>
		{#snippet editor(field)}
			{@const settingsCode = settingsCodeOf(form.get('company_id') ?? record?.company_id)}
			{@const day = typeof form.get('date') === 'string' ? String(form.get('date')) : undefined}
			{#if name === 'worksite'}
				<CodeSelect
					{settingsCode}
					{day}
					wage="places"
					value={typeof field.value === 'string' ? field.value : null}
					disabled={field.disabled}
					onChange={(next) => field.onChange(next as never)}
				/>
			{:else}
				<CodeSelect
					{settingsCode}
					{day}
					table={CODED_FIELDS.jurisdiction_holidays.religion}
					multiple
					value={typeof field.value === 'string' ? field.value : null}
					disabled={field.disabled}
					onChange={(next) => field.onChange(next as never)}
				/>
			{/if}
		{/snippet}
	</Field>
{/snippet}

<RecordShell
	of="jurisdiction_holidays"
	{...record == null ? {} : { id: record.id }}
	mode={view.mode}
>
	<Form of="jurisdiction_holidays" mode={view.mode} {record} {values}>
		{#snippet children(form)}
			<Section first name="jurisdiction_holidays" title={t('component.holiday')}>
				<Grid gap="md" minimum="compact">
					{#if record == null}
						<Field name="company_id" label={t('component.company')} />
					{/if}
					<Field name="date" label={t('component.observed_on')} />
					<Field name="kind" label={t('holiday_calendar.kind')} />
					<Field name="given_to" label={t('holiday_calendar.given_to')} />
					{@render coded(form, 'worksite', t('component.worksite'))}
					{@render coded(form, 'religion', t('component.religion'))}
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
												field.onChange(
													event.currentTarget.checked ? new Date().toISOString() : null
												)}
										/>
										{t('holiday_calendar.published')}
									</Inline>
								</label>
							{/snippet}
						</Field>
					</Column>
				</Grid>
			</Section>
		{/snippet}
	</Form>
</RecordShell>
