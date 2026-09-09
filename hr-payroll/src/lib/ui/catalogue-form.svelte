<script lang="ts">
	/**
	 * The one form behind the four money catalogues: claims, allowances, payments and loans. They
	 * are the same row shape in four tables, and the family is the table rather than a column, so
	 * the form takes the collection name and nothing else varies but a section title.
	 *
	 * `settings_id` is never a field on the Settings page: the page names the version and the form
	 * prefills and hides it. Opened without that scope it keeps a plain version picker.
	 */
	import { client } from '../workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import FormSection from './form-section.svelte';
	import { hrCreateScope } from './create-scope.js';

	type Collection =
		'claim_catalogue' | 'allowance_catalogue' | 'payment_catalogue' | 'loan_catalogue';
	let {
		collection,
		record,
		close
	}: { collection: Collection; record: WorkspaceRow<Collection> | null; close: () => void } =
		$props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const settingsId = $derived(createScope?.settingsId?.());
	const formValues = $derived(record ?? (settingsId ? { settings_id: settingsId } : undefined));
	const loan = $derived(collection === 'loan_catalogue');
</script>

<RecordShell title={record?.code ?? t('component.create_catalogue_component')}>
	<CollectionForm
		{client}
		{collection}
		defaultValues={formValues}
		submitLabel={record
			? t('component.save_catalogue_component')
			: t('component.create_catalogue_component')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.catalogue_section_pay_line')}
					hint={t('component.catalogue_section_pay_line_hint')}
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
									limit: 500
								}}
							/>
						{/if}
						<Field name="code" label={t('component.code')} />
						<Field name="is_statutory" label={t('component.is_statutory')} />
						{#if loan}
							<Field name="sequence" label={t('component.order')} />
						{/if}
						<Column span="all"><Field name="policy" label={t('component.economic_type')} /></Column>
					</Grid>
				</FormSection>

				<FormSection
					title={loan
						? t('component.catalogue_section_who')
						: t('component.catalogue_section_who_order')}
					hint={t('component.catalogue_section_who_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Column span="all"
							><Field name="eligibility" label={t('component.who_receives')} /></Column
						>
						{#if !loan}
							<Field name="sequence" label={t('component.order')} />
						{/if}
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.catalogue_section_limits')}
					hint={t('component.catalogue_section_limits_hint')}
				>
					<Field name="definition" label={t('component.how_calculated')} />
				</FormSection>

				<FormSection
					title={t('component.section_contributions')}
					hint={t('component.catalogue_section_contributions_hint')}
				>
					<Field name="contribution_treatments" label={t('component.contribution_treatments')} />
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
