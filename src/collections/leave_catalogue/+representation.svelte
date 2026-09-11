<script lang="ts">
	/**
	 * One row of a settings version's leave catalogue. A statutory row cites its authority and its
	 * eligibility is one CEL expression over the person, which the write hook compiles. Sealed with
	 * its version.
	 *
	 * Segments are tabs, not stacked sections, so one panel is on screen at a time and its fields
	 * spread across the sheet. The dialog chrome names the record; the form adds no heading.
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
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const settingsId = $derived(createScope?.settingsId?.());
	const formValues = $derived(record ?? (settingsId ? { settings_id: settingsId } : undefined));
</script>

<CollectionForm
	{client}
	collection="leave_catalogue"
	defaultValues={formValues}
	submitLabel={record ? t('component.save_catalogue_leave') : t('component.create_catalogue_leave')}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		{#snippet identity()}
			<Stack gap="sm">
				<p class="text-meta">{t('component.leave_section_identity_hint')}</p>
				<Grid gap="md" minimum="card">
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
			</Stack>
		{/snippet}

		{#snippet who()}
			<Stack gap="sm">
				<p class="text-meta">{t('component.leave_section_who_hint')}</p>
				<Field
					name="eligibility"
					label={t('component.who_receives')}
					placeholder={t('component.eligibility_placeholder')}
				/>
			</Stack>
		{/snippet}

		{#snippet entitlement()}
			<Stack gap="sm">
				<p class="text-meta">{t('component.leave_section_entitlement_hint')}</p>
				<Field name="entitlement" label={t('component.entitlement_matrix')} />
			</Stack>
		{/snippet}

		{#snippet pay()}
			<Stack gap="sm">
				<p class="text-meta">{t('component.leave_section_pay_hint')}</p>
				<Grid gap="md" minimum="card">
					<Field name="paid" label={t('component.paid')} />
					<Field
						name="requires_certificate_after_days"
						label={t('component.certificate_required_after_days')}
					/>
				</Grid>
			</Stack>
		{/snippet}

		{#snippet contributions()}
			<Stack gap="sm">
				<p class="text-meta">{t('component.leave_section_contributions_hint')}</p>
				<Field name="treatments" label={t('component.contribution_treatments')} />
			</Stack>
		{/snippet}

		<Tabs
			animate={false}
			listClass="w-full"
			contentPadding={false}
			lazyLoad={false}
			keepAlive
			config={[
				{
					name: 'identity',
					label: t('component.leave_section_identity'),
					icon: 'lucide:tag',
					content: identity
				},
				{
					name: 'who',
					label: t('component.who_may_take_it'),
					icon: 'lucide:users',
					content: who
				},
				{
					name: 'entitlement',
					label: t('component.leave_section_entitlement'),
					icon: 'lucide:calendar-days',
					content: entitlement
				},
				{
					name: 'pay',
					label: t('component.leave_section_pay'),
					icon: 'lucide:circle-dollar-sign',
					content: pay
				},
				{
					name: 'contributions',
					label: t('component.section_contributions'),
					icon: 'lucide:landmark',
					content: contributions
				}
			] satisfies TabConfig[]}
		/>
	{/snippet}
</CollectionForm>
