<script lang="ts">
	/**
	 * The loan catalogue's own form.
	 *
	 * It used to share `catalogue-form.svelte` with claims, allowances and payments, on the strength
	 * of a loan row being that row minus a nature, evidence, a ceiling and a settlement route — a
	 * subset, so one `CollectionForm` cast to a money catalogue could type every field. `loan_type`
	 * and `minimum_repayment` ended the subset: a form serving two row shapes can only be typed
	 * against one of them, and a union narrows `Field` to what they have in common, which is neither.
	 *
	 * So the two are two forms; both present their segments as tabs. The dialog chrome names the
	 * record, so the form adds no heading of its own. `settings_id` is never a field on the Settings
	 * page: the page names the version and the form prefills and hides it.
	 */
	import { client } from '../workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { hrCreateScope } from './create-scope.js';

	let { record, close }: { record: WorkspaceRow<'loan_catalogue'> | null; close: () => void } =
		$props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const settingsId = $derived(createScope?.settingsId?.());
	const formValues = $derived(record ?? (settingsId ? { settings_id: settingsId } : undefined));
</script>

<CollectionForm
	{client}
	collection="loan_catalogue"
	defaultValues={formValues}
	submitLabel={record
		? t('component.save_catalogue_component')
		: t('component.create_catalogue_component')}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		{#snippet payLine()}
			<Stack gap="sm">
				<p class="text-meta">{t('component.catalogue_section_pay_line_loan_hint')}</p>
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
					<Field name="sequence" label={t('component.order')} />
					<!-- Only a debt has these: whose it is, and the least a month may recover. -->
					<Field name="loan_type" label={t('component.loan_type')} />
					<Field
						name="minimum_repayment"
						label={t('component.minimum_repayment')}
						placeholder={t('component.minimum_repayment_hint')}
					/>
				</Grid>
			</Stack>
		{/snippet}

		{#snippet who()}
			<Stack gap="sm">
				<p class="text-meta">{t('component.catalogue_section_who_hint')}</p>
				<Grid gap="md" minimum="card">
					<Column span="all"
						><Field name="eligibility" label={t('component.who_receives')} /></Column
					>
				</Grid>
			</Stack>
		{/snippet}

		{#snippet contributions()}
			<Stack gap="sm">
				<p class="text-meta">{t('component.catalogue_section_contributions_hint')}</p>
				<Field
					name="contribution_treatments"
					label={t('component.contribution_treatments')}
					description={t('renderer.contribution_treatments.identity')}
				/>
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
					name: 'pay_line',
					label: t('component.catalogue_section_pay_line'),
					icon: 'lucide:tag',
					content: payLine
				},
				{
					name: 'who',
					label: t('component.catalogue_section_who'),
					icon: 'lucide:users',
					content: who
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
