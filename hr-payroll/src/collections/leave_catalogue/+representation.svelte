<script lang="ts">
	/**
	 * One row of a settings version's leave catalogue. A statutory row cites its authority and its
	 * eligibility is one CEL expression over the person, which the write hook compiles. Sealed with
	 * its version.
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
	import FormSection from '../../lib/ui/form-section.svelte';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const settingsId = $derived(createScope?.settingsId?.());
	const formValues = $derived(record ?? (settingsId ? { settings_id: settingsId } : undefined));
</script>

<RecordShell
	title={record ? `${record.code} · ${record.name}` : t('component.create_catalogue_leave')}
>
	<CollectionForm
		{client}
		collection="leave_catalogue"
		defaultValues={formValues}
		submitLabel={record
			? t('component.save_catalogue_leave')
			: t('component.create_catalogue_leave')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.leave_section_identity')}
					hint={t('component.leave_section_identity_hint')}
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
						<Field name="name" label={t('component.name')} />
						<Field name="is_statutory" label={t('component.is_statutory')} />
						<Field name="authority" label={t('component.authority')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.who_may_take_it')}
					hint={t('component.leave_section_who_hint')}
				>
					<Field
						name="eligibility"
						label={t('component.who_receives')}
						placeholder={t('component.eligibility_placeholder')}
					/>
				</FormSection>

				<FormSection
					title={t('component.leave_section_entitlement')}
					hint={t('component.leave_section_entitlement_hint')}
				>
					<Field name="entitlement" label={t('component.entitlement_matrix')} />
				</FormSection>

				<FormSection
					title={t('component.leave_section_pay')}
					hint={t('component.leave_section_pay_hint')}
				>
					<Stack gap="sm">
						<Field name="payroll_effect" label={t('component.effect_on_pay')} />
						<Grid gap="sm" minimum="compact">
							<Field
								name="requires_certificate_after_days"
								label={t('component.certificate_required_after_days')}
							/>
						</Grid>
					</Stack>
				</FormSection>

				<FormSection
					title={t('component.section_contributions')}
					hint={t('component.leave_section_contributions_hint')}
				>
					<Field name="encashment" label={t('leave.encashment_output')} />
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
