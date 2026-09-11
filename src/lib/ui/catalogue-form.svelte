<script lang="ts">
	/**
	 * The one form behind the three money catalogues: claims, allowances and payments. One row shape
	 * in three tables, so the family is the table rather than a column and the form takes only the
	 * collection name.
	 *
	 * The loan catalogue used to be here too, as the same row minus four columns. `loan_type` and
	 * `minimum_repayment` ended that: a form serving two row shapes can be typed against only one of
	 * them, and a union narrows `Field` to their intersection. It has `loan-catalogue-form.svelte`.
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

	type Collection = 'claim_catalogue' | 'allowance_catalogue' | 'payment_catalogue';
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
						<Field name="nature" label={t('component.economic_type')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.catalogue_section_who_order')}
					hint={t('component.catalogue_section_who_order_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Column span="all"
							><Field name="eligibility" label={t('component.who_receives')} /></Column
						>
						<Field name="sequence" label={t('component.order')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.catalogue_section_limits')}
					hint={t('component.catalogue_section_limits_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="evidence" label={t('component.evidence')} />
						<Field name="settlement" label={t('component.settlement')} />
						<Column span="all"><Field name="cap" label={t('component.ceiling')} /></Column>
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.section_contributions')}
					hint={t('component.catalogue_section_contributions_hint')}
				>
					<Field
						name="contribution_treatments"
						label={t('component.contribution_treatments')}
						description={t('renderer.contribution_treatments.identity')}
					/>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
