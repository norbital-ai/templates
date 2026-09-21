<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import FormSection from '../../lib/ui/form-section.svelte';
	import EffectiveRangeRenderer from '../../lib/ui/effective-range-renderer.svelte';
	import EntityFactsRenderer from '../../datatypes/entity_facts/+renderer.svelte';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId?.());
	const formValues = $derived(
		record ?? (scopedCompanyId == null ? undefined : { company_id: scopedCompanyId })
	);

	/** Each entity's lineage, so a revision's facts render the declarations that govern it. */
	const companiesQuery = $derived(
		client.db.companies.findMany({
			columns: { id: true, name: true, settings_code: true },
			orderBy: { name: 'asc' },
			limit: 1000
		})
	);
	const settingsCodeOf = (companyId: unknown): string =>
		String(
			(companiesQuery.current ?? []).find((row) => row.id === String(companyId ?? ''))
				?.settings_code ?? ''
		);
</script>

{#snippet form()}
	<CollectionForm
		{client}
		collection="company_facts"
		defaultValues={formValues}
		submitLabel={record
			? t('component.save_entity_fact_revision')
			: t('component.record_entity_fact_revision')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field, form })}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.entity_fact_revision')}
					hint={t('component.entity_fact_revision_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field
							name="company_id"
							label={t('component.company')}
							hidden={scopedCompanyId != null}
							relationOptions={{ label: (row: Record<string, unknown>) => String(row.name ?? '') }}
						/>
						<Column span="all">
							<Field
								name="effective_range"
								label={t('component.section_period')}
								renderer={EffectiveRangeRenderer}
							/>
						</Column>
						<Column span="all">
							<Field
								name="facts"
								renderer={EntityFactsRenderer}
								rendererProps={{ settingsCode: settingsCodeOf(form.values().company_id) }}
								label={t('component.entity_facts')}
								description={t('component.entity_facts_hint')}
							/>
						</Column>
					</Grid>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
{/snippet}

<RecordShell>{@render form()}</RecordShell>
