<script lang="ts">
	/**
	 * Where one contract stands with one statutory scheme: registered with a reference, or not
	 * registered with a reason, across a window.
	 *
	 * The scheme picker offers the schemes of the version in force today on the page's lineage;
	 * `supersedes_fact_id` is written by the statutory-successor automation and never offered.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';
	import { inForceSettings } from '../../lib/ui/settings-scope.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import FormSection from '../../lib/ui/form-section.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedEmploymentId = $derived(createScope?.employmentId?.());
	const scopedCompanyId = $derived(createScope?.companyId());
	const scopedSettingsCode = $derived(createScope?.settingsCode());
	const formValues = $derived(
		record ?? (scopedEmploymentId ? { employment_id: scopedEmploymentId } : undefined)
	);
	// Schemes reach their version through `contribution_settings`, like the catalogues do through
	// `<catalogue>_settings`; unscoped, the picker offers every scheme of every version.
	const inForceSchemes = $derived(
		scopedSettingsCode == null
			? undefined
			: { contribution_settings: { some: inForceSettings(scopedSettingsCode, todayKey()) } }
	);
</script>

<RecordShell title={record?.summary ?? t('component.create_statutory_fact')}>
	<CollectionForm
		{client}
		collection="employment_statutory_facts"
		defaultValues={formValues}
		submitLabel={record ? t('component.save_registration') : t('component.record_registration')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Field name="supersedes_fact_id" hidden />
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.fact_section_scheme')}
					hint={t('component.fact_section_scheme_hint')}
				>
					<Grid gap="sm" minimum="compact">
						{#if scopedEmploymentId != null}
							<Field name="employment_id" hidden />
						{:else}
							<Field
								name="employment_id"
								label={t('component.employment')}
								relationOptions={employmentRelationOptions(scopedCompanyId)}
							/>
						{/if}
						<Field
							name="statutory_contribution_id"
							label={t('component.statutory_scheme')}
							relationOptions={{
								label: (contribution) =>
									[contribution.code, contribution.name]
										.filter((part) => part != null && part !== '')
										.join(' · ') || '—',
								...(inForceSchemes == null ? {} : { where: inForceSchemes }),
								orderBy: { sequence: 'asc' },
								limit: 500
							}}
						/>
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.registration')}
					hint={t('component.fact_section_registration_hint')}
				>
					<Field name="status" label={t('component.status')} />
				</FormSection>

				<FormSection
					title={t('component.section_period')}
					hint={t('component.section_period_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Column span="all">
							<Field name="effective_range" label={t('component.effective_period')} />
						</Column>
					</Grid>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
