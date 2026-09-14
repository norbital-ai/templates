<script lang="ts">
	/**
	 * One statutory scheme: the expressions that price it and the bands that select them. A row like
	 * "5.5% from RM0 to RM5,000" is meaningless without the EPF/SOCSO/EIS scheme whose ladder it is a
	 * rung of, so the bands are the scheme's own `bands` column; the datatype compiles every
	 * expression against the scheme context when the row is written.
	 *
	 * `settings_id` is never a field on the Settings page: the page names the version and the form
	 * prefills and hides it. Opened without that scope it keeps a plain version picker.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { TabConfig } from '@norbital-ai/ui/tabs';
	import FormSection from '../../lib/ui/form-section.svelte';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const settingsId = $derived(createScope?.settingsId?.());
	const formValues = $derived(record ?? (settingsId ? { settings_id: settingsId } : undefined));
</script>

{#snippet scheme()}
	<CollectionForm
		{client}
		collection="statutory_contributions"
		defaultValues={formValues}
		submitLabel={record ? t('component.save_scheme') : t('component.create_scheme')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.scheme_section_identity')}
					hint={t('component.scheme_section_identity_hint')}
				>
					<Grid gap="sm" minimum="compact">
						{#if settingsId != null}
							<Field name="settings_id" hidden />
						{:else}
							<Field
								name="settings_id"
								label={t('component.settings_version')}
								relationOptions={{
									label: (version) =>
										[version.code, version.name, version.sealed_at ? 'sealed' : 'draft']
											.filter((part) => part != null && part !== '')
											.join(' · ') || '—',
									orderBy: { code: 'asc' },
									limit: 200
								}}
							/>
						{/if}
						<Field name="code" label={t('component.code')} />
						<Field name="name" label={t('component.name')} />
						<Field name="is_statutory" label={t('component.is_statutory')} />
						<Field name="authority" label={t('component.authority')} />
						<Column span="all">
							<Stack gap="xs">
								<Field
									name="eligibility"
									label={t('component.who_receives')}
									placeholder={'employee.citizenship != "FOREIGNER"'}
								/>
								<p class="text-meta">{t('component.scheme_eligibility_hint')}</p>
							</Stack>
						</Column>
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.scheme_section_order')}
					hint={t('component.scheme_section_order_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="sequence" label={t('component.order')} />
						<Field name="assessment_period" label={t('component.assessment_period')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.scheme_section_bands')}
					hint={t('component.scheme_section_bands_hint')}
				>
					<Field name="bands" label={t('component.rate_bands')} />
				</FormSection>

				<FormSection
					title={t('component.scheme_section_exceptions')}
					hint={t('component.scheme_section_exceptions_hint')}
				>
					<Field name="rules" label={t('component.scheme_rules')} />
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
{/snippet}

<!-- Tab content must be snippets (TabConfig.content); the shell always renders tabs so no snippet is ever render-called elsewhere. -->
<RecordShell
	title={record ? `${record.code} · ${record.name}` : t('component.create_scheme')}
	tabs={[
		{
			name: 'scheme',
			label: t('component.scheme_section_identity'),
			icon: 'lucide:landmark',
			content: scheme
		}
	] satisfies TabConfig[]}
/>
