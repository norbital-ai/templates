<script lang="ts">
	/** A dated revision of one establishment, its facts rendered with the `worksite_facts` of the company's lineage. */
	import { t } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import { Field, Form } from '@norbital-ai/ui';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import DeclaredFactsField from '../../../lib/ui/declared-facts-field.svelte';
	import { createValues, hrCreateScope } from '../../../lib/ui/create-scope.js';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { liveRows } from '../../../lib/ui/live.svelte.js';

	let { view }: { view: RecordView<'worksites'> } = $props();
	const scopedCompanyId = hrCreateScope()?.companyId?.();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(createValues(view, { company_id: scopedCompanyId }));
	const companies = liveRows<{ id: string; settings_code: string }>(() =>
		bolt.read('companies', { select: { settings_code: true }, all: true })
	);
	const settingsCodeOf = (companyId: unknown): string =>
		companies.current?.find((row) => row.id === String(companyId ?? ''))?.settings_code ?? '';
</script>

<RecordShell of="worksites" {...record == null ? {} : { id: record.id }} mode={view.mode}>
	<Form
		of="worksites"
		mode={view.mode}
		{record}
		{values}
		submit={record
			? t('component.save_entity_fact_revision')
			: t('component.record_entity_fact_revision')}
	>
		{#snippet children(form)}
			<FormSection first title={t('component.worksite_revision')}>
				<Grid gap="sm" minimum="compact">
					{#if record == null && scopedCompanyId == null}
						<Field name="company_id" label={t('component.company')} />
					{/if}
					{#if record == null}
						<Field name="code" label={t('component.code')} />
					{/if}
					<Field name="name" label={t('component.name')} />
					<Field name="region" label={t('component.region')} />
					<Column span="all">
						<Field name="address" label={t('component.address')} />
					</Column>
					<Column span="all">
						<Field name="effective_range" label={t('component.section_period')} />
					</Column>
					<Column span="all">
						<Field name="facts" label={t('component.entity_facts')}>
							{#snippet editor(field)}
								<DeclaredFactsField
									view={{
										mode: 'edit',
										name: field.name,
										value: field.value as never,
										disabled: field.disabled,
										onChange: field.onChange as never
									}}
									settingsCode={settingsCodeOf(form.get('company_id') ?? record?.company_id)}
									schema="worksite_facts"
								/>
							{/snippet}
						</Field>
					</Column>
				</Grid>
			</FormSection>
		{/snippet}
	</Form>
</RecordShell>
