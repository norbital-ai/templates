<script lang="ts">
	/**
	 * One statutory scheme, and the rate bands that price it. A row like "5.5% from RM0 to RM5,000"
	 * is meaningless without the EPF/SOCSO/EIS scheme whose wage ladder it is a rung of, so the bands
	 * are the scheme's own `bands` column; the datatype refuses two rungs that overlap.
	 *
	 * `settings_id` is never a field on the Settings page: the page names the version and the form
	 * prefills and hides it. Opened without that scope it keeps a plain version picker.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { TabConfig } from '@norbital-ai/ui/tabs';
	import FormSection from '../../lib/ui/form-section.svelte';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const settingsId = $derived(createScope?.settingsId?.());
	const formValues = $derived(record ?? (settingsId ? { settings_id: settingsId } : undefined));

	const payerLabel = $derived(
		record?.payer === 'BOTH' ? 'employee and employer' : (record?.payer?.toLowerCase() ?? 'nobody')
	);
	const keyedByLabel = $derived(
		record?.keyed_by?.toLowerCase().replaceAll('_', ' ') ?? 'nothing yet'
	);
	const subtitle = $derived(
		record == null
			? undefined
			: t('component.scheme_subtitle', {
					payer: payerLabel,
					step: record.sequence,
					keyed_by: keyedByLabel
				})
	);
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
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.scheme_section_order')}
					hint={t('component.scheme_section_order_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="sequence" label={t('component.order')} />
						<Field name="rounding" label={t('component.rounding')} />
						<Field name="payer" label={t('component.paid_by')} />
						<Field name="keyed_by" label={t('component.bands_keyed_by')} />
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
					<Field
						name="relief_for"
						label={t('component.gives_relief_for')}
						relationOptions={{
							label: (contribution) =>
								[contribution.code, contribution.name]
									.filter((part) => part != null && part !== '')
									.join(' · ') || '—',
							orderBy: { sequence: 'asc' },
							limit: 500
						}}
					/>
					<Field name="special_rules" label={t('component.named_special_rules')} />
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
{/snippet}

<!-- Tab content must be snippets (TabConfig.content); the shell always renders tabs so no snippet is ever render-called elsewhere. -->
<RecordShell
	title={record ? `${record.code} · ${record.name}` : t('component.create_scheme')}
	{subtitle}
	tabs={[
		{
			name: 'scheme',
			label: t('component.scheme_section_identity'),
			icon: 'lucide:landmark',
			content: scheme
		}
	] satisfies TabConfig[]}
/>
