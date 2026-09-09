<script lang="ts">
	/**
	 * One settings version's work rules: how a monthly wage becomes a daily and hourly rate, the
	 * overtime regime, and how every scheme charges each of the four pay items work produces.
	 *
	 * `settings_id` is never a field on the Settings page: the page names the version and the form
	 * prefills and hides it. Opened without that scope it keeps a plain version picker.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { RepresentationProps } from './$types.js';
	import FormSection from '../../lib/ui/form-section.svelte';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const settingsId = $derived(createScope?.settingsId?.());
	const formValues = $derived(record ?? (settingsId ? { settings_id: settingsId } : undefined));
</script>

<RecordShell title={record?.code ?? t('app.settings.work_catalogue')}>
	<CollectionForm
		{client}
		collection="work_catalogue"
		defaultValues={formValues}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.work_section_rate')}
					hint={t('component.work_section_rate_hint')}
				>
					<Grid gap="sm" minimum="compact">
						{#if settingsId != null}
							<Field name="settings_id" hidden />
						{:else}
							<Field name="settings_id" label={t('component.settings_version')} />
						{/if}
						<Field name="code" label={t('component.code')} />
						<Field name="proration" label={t('component.proration_basis')} />
						<Field name="ordinary_rate" label={t('component.ordinary_rate')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.settings_section_regime')}
					hint={t('component.work_section_regime_hint')}
				>
					<Field name="regime" label={t('component.settings_section_regime')} />
				</FormSection>

				<FormSection
					title={t('component.section_contributions')}
					hint={t('component.work_section_contributions_hint')}
				>
					<Stack gap="sm">
						<Field name="salary" label={t('work.output_salary')} />
						<Field name="overtime" label={t('work.output_overtime')} />
						<Field name="overtime_excess" label={t('work.output_overtime_excess')} />
						<Field name="absence" label={t('work.output_absence')} />
					</Stack>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
