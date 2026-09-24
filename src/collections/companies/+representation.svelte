<script lang="ts">
	/**
	 * A company is its identity, the jurisdiction settings lineage it operates under, and three
	 * payroll facts: the attendance cutoff, how often it pays, and the risk class its regime rates it
	 * in. The risk class is a plain field with its hint: deciding whether to show it meant reading
	 * every version's scheme rules on this form, a query past the sync engine's initial-answer
	 * ceiling on a lineage the size of Malaysia's.
	 *
	 * `settings_code` is a lineage, not a row: `MY`, `SG`, or `SG-norbital` where this entity forked
	 * the shared law. The picker offers every lineage the workspace holds and the version in force
	 * is picked per date from it, so a change of law never touches the company row.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { FieldDescription, FieldLegend, FieldSet } from '@norbital-ai/ui/field';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { TabConfig } from '@norbital-ai/ui/tabs';
	import HolidaySettings from '../../lib/ui/holiday-settings.svelte';
	import SchedulingSettings from '../../lib/ui/scheduling-settings.svelte';
	import EffectiveRangeRenderer from '../../lib/ui/effective-range-renderer.svelte';
	import EntityFactsRenderer from '../../datatypes/entity_facts/+renderer.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	/** The lineages the workspace holds, so the code is chosen rather than typed. */
	const lineagesQuery = $derived(
		client.db.jurisdiction_settings.findMany({
			where: { approval_id: { isNull: true } },
			columns: { code: true, name: true },
			orderBy: { code: 'asc' },
			limit: 500
		})
	);
	const lineageCodes = $derived([
		...new Set((lineagesQuery.current ?? []).map((version) => version.code))
	]);
</script>

{#snippet details()}
	<CollectionForm
		{client}
		collection="companies"
		defaultValues={record ?? undefined}
		submitLabel={record ? t('component.save_company') : t('component.create_company')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field, form })}
			<!-- The entity's Google holiday source is set on the Holidays tab, not here; the form
			     still declares it, because a mutable field it never names is a runtime refusal. -->
			<Field name="holiday_source" hidden />
			<FieldSet>
				<FieldLegend>{t('component.legal_entity')}</FieldLegend>
				<FieldDescription>{t('component.legal_entity_description')}</FieldDescription>
				<Grid gap="md" minimum="panel">
					<Field name="name" label={t('component.legal_name')} />
					<Field name="registration_number" label={t('component.registration_number')} />
					<Field
						name="settings_code"
						label={t('component.settings_lineage')}
						placeholder={lineageCodes.join(', ')}
						description={t('component.settings_lineage_hint')}
					/>
					<Field
						name="region"
						label={t('component.region')}
						description={t('component.region_hint')}
					/>
					<Column span="all">
						<Field
							name="facts"
							renderer={EntityFactsRenderer}
							rendererProps={{ settingsCode: String(form.values().settings_code ?? '') }}
							label={t('component.entity_facts')}
							description={t('component.entity_facts_hint')}
						/>
					</Column>
					<Field name="pay_cutoff_day" label={t('component.attendance_cutoff_day')} />
					<Field name="pay_frequency" label={t('component.pay_frequency')} />
					<Field name="workbook_layout" label={t('component.workbook_layout')} />
					<Column span="all">
						<Field name="disbursement_account" label={t('component.disbursement_account')} />
					</Column>
					<Field
						name="risk_class"
						label={t('component.statutory_risk_class')}
						placeholder={t('component.risk_class_hint', { class_iv: 'IV', class_i: 'I' })}
					/>
					<Column span="all">
						<Field
							name="effective_range"
							renderer={EffectiveRangeRenderer}
							label={t('component.effective_period')}
						/>
					</Column>
				</Grid>
			</FieldSet>
		{/snippet}
	</CollectionForm>
{/snippet}

{#snippet holidays()}
	<!-- Holidays are the entity's; the Google source is the country's public calendar, and the
	     spreadsheet import is the table's own operation. -->
	<HolidaySettings company={record!} />
{/snippet}

{#snippet scheduling()}
	<!-- The roster codes and patterns are the entity's: a new version of the same law keeps them,
	     and two entities of one jurisdiction each keep their own. -->
	<SchedulingSettings company={record!} />
{/snippet}

<RecordShell
	tabs={record == null
		? undefined
		: ([
				{
					name: 'details',
					label: t('component.legal_entity'),
					icon: 'lucide:building-2',
					content: details
				},
				{
					name: 'holidays',
					label: t('app.settings.holidays'),
					icon: 'lucide:calendar-x',
					content: holidays
				},
				{
					name: 'scheduling',
					label: t('component.scheduling'),
					icon: 'lucide:calendar-range',
					content: scheduling
				}
			] satisfies TabConfig[])}
>
	{#if record == null}
		{@render details()}
	{/if}
</RecordShell>
