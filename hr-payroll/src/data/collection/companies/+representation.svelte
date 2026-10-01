<script lang="ts">
	/**
	 * A company is its identity, the jurisdiction settings lineage it operates under, its declared facts, and its payroll
	 * facts: the attendance cutoff, how often it pays, its workbook and disbursement account, and its risk class. Its
	 * holidays and its scheduling vocabulary are its own tabs. `settings_code` is a lineage, not a row (`MY`, `SG`, or
	 * `SG-norbital` where this entity forked the shared law); the version in force is picked per date from it.
	 */
	import { t } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import { Combobox, Field, Form } from '@norbital-ai/ui';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import DeclaredFactsField from '../../../lib/ui/declared-facts-field.svelte';
	import { createValues } from '../../../lib/ui/create-scope.js';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import HolidaySettings from '../../../lib/ui/holiday-settings.svelte';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import SchedulingSettings from '../../../lib/ui/scheduling-settings.svelte';
	import CodeSelect from '../../../lib/ui/code-select.svelte';
	import { CODED_FIELDS } from '../../../lib/coded-fields.js';

	let { view }: { view: RecordView<'companies'> } = $props();
	const record = $derived(
		view.mode === 'update'
			? (view.record as typeof view.record & { id: string; name: string; settings_code: string })
			: null
	);
	/** The lineages the workspace holds, so the code is chosen rather than guessed. */
	const lineages = liveRows<{ id: string; code: string }>(() =>
		bolt.read('jurisdiction_settings', {
			where: { approval_id: { isNull: true } },
			select: { code: true },
			all: true
		})
	);
	const lineageCodes = $derived(
		[...new Set((lineages.current ?? []).map((version) => version.code))].toSorted()
	);
</script>

{#snippet details()}
	<Form
		of="companies"
		mode={view.mode}
		{...record == null ? { values: createValues(view) } : { id: record.id, record }}
		submit={record ? t('component.save_company') : t('component.create_company')}
	>
		{#snippet children(form)}
			<FormSection
				name="legal_entity"
				first
				title={t('component.legal_entity')}
				hint={t('component.legal_entity_description')}
			>
				<Grid gap="md" minimum="card">
					<Field name="name" label={t('component.legal_name')} />
					<Field name="registration_number" label={t('component.registration_number')} />
					<Field name="settings_code" label={t('component.settings_lineage')}>
						{#snippet editor(field)}
							<Combobox
								class="w-full"
								size="sm"
								clearable
								options={lineageCodes.map((code) => ({ value: code, label: code }))}
								value={typeof field.value === 'string' && field.value !== '' ? field.value : null}
								disabled={field.disabled}
								onChange={(next) => field.onChange(next ?? '')}
							/>
						{/snippet}
					</Field>
					<Field name="region" label={t('component.region')} help={t('component.region_hint')}>
						{#snippet editor(field)}
							<CodeSelect
								settingsCode={String(form.get('settings_code') ?? '')}
								wage="regions"
								value={typeof field.value === 'string' ? field.value : null}
								disabled={field.disabled}
								onChange={(next) => field.onChange(next as never)}
							/>
						{/snippet}
					</Field>
					<Column span="all">
						<Field
							name="facts"
							label={t('component.entity_facts')}
							help={t('component.entity_facts_hint')}
						>
							{#snippet editor(field)}
								<DeclaredFactsField
									view={{
										mode: 'edit',
										name: field.name,
										value: field.value as never,
										disabled: field.disabled,
										onChange: field.onChange as never
									}}
									settingsCode={String(form.get('settings_code') ?? '')}
									schema="facts"
								/>
							{/snippet}
						</Field>
					</Column>
					<Field name="pay_cutoff_day" label={t('component.attendance_cutoff_day')} />
					<Field
						name="late_arrival_grace_minutes"
						label={t('component.late_arrival_grace_minutes')}
					/>
					<Field name="pay_frequency" label={t('component.pay_frequency')} />
					<Field name="workbook_layout" label={t('component.workbook_layout')} />
					<Column span="all"
						><Field
							name="disbursement_account"
							label={t('component.disbursement_account')}
						/></Column
					>
					<Field
						name="risk_class"
						label={t('component.statutory_risk_class')}
						help={t('component.risk_class_hint')}
					>
						{#snippet editor(field)}
							<CodeSelect
								settingsCode={String(form.get('settings_code') ?? '')}
								table={CODED_FIELDS.companies.risk_class}
								value={typeof field.value === 'string' ? field.value : null}
								disabled={field.disabled}
								onChange={(next) => field.onChange(next as never)}
							/>
						{/snippet}
					</Field>
					<Column span="all"
						><Field name="effective_range" label={t('component.effective_period')} /></Column
					>
				</Grid>
			</FormSection>
		{/snippet}
	</Form>
{/snippet}

{#snippet holidays()}
	<!-- Holidays are the entity's; the Google source is the country's public calendar. -->
	{#if record}<HolidaySettings company={record} />{/if}
{/snippet}

{#snippet scheduling()}
	<!-- The roster codes and patterns are the entity's: a new version of the same law keeps them. -->
	{#if record}<SchedulingSettings company={record} />{/if}
{/snippet}

<RecordShell
	of="companies"
	mode={view.mode}
	{...record == null ? {} : { id: record.id }}
	tabs={record == null
		? []
		: [
				{
					name: 'holidays',
					title: t('app.settings.holidays'),
					icon: 'lucide:calendar-x',
					body: holidays
				},
				{
					name: 'scheduling',
					title: t('component.scheduling'),
					icon: 'lucide:calendar-range',
					body: scheduling
				}
			]}
>
	{@render details()}
</RecordShell>
