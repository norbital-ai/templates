<script lang="ts">
	/**
	 * One settings version's work rules: how a monthly wage becomes a daily and hourly rate; the
	 * overtime regime (coverage, rules, limits, rest, holiday precedence); how every scheme charges
	 * the four pay lines work produces; and the one citation for the row.
	 *
	 * Segments are tabs, not stacked sections, so one panel is on screen at a time and the regime
	 * is not buried under three screens of paragraphs. The dialog chrome names the record.
	 *
	 * `settings_id` is never a field on the Settings page: the page names the version and the form
	 * prefills and hides it. Opened without that scope it keeps a plain version picker.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import type { RepresentationProps } from './$types.js';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const settingsId = $derived(createScope?.settingsId?.());
	const formValues = $derived(record ?? (settingsId ? { settings_id: settingsId } : undefined));
</script>

<CollectionForm
	{client}
	collection="work_catalogue"
	defaultValues={formValues}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		{#snippet rate()}
			<Stack gap="sm">
				<p class="text-meta">{t('component.work_section_rate_hint')}</p>
				<Grid gap="md" minimum="card">
					{#if settingsId != null}
						<Field name="settings_id" hidden />
					{:else}
						<Field name="settings_id" label={t('component.settings_version')} />
					{/if}
					<Field name="proration" label={t('component.proration_basis')} />
					<Column span="all"
						><Field name="ordinary_rate" label={t('component.ordinary_rate')} /></Column
					>
				</Grid>
			</Stack>
		{/snippet}

		{#snippet overtime()}
			<Stack gap="sm">
				<p class="text-meta">{t('component.work_section_overtime_hint')}</p>
				<Field name="regime" label={t('component.settings_section_regime')} />
			</Stack>
		{/snippet}

		{#snippet contributions()}
			<Stack gap="sm">
				<p class="text-meta">{t('component.work_section_contributions_hint')}</p>
				<Field name="treatments" label={t('component.contribution_treatments')} />
			</Stack>
		{/snippet}

		{#snippet citation()}
			<Stack gap="sm">
				<p class="text-meta">{t('component.work_section_citation_hint')}</p>
				<Field name="authority" label={t('component.authority')} />
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
					name: 'rate',
					label: t('component.work_section_rate'),
					icon: 'lucide:circle-dollar-sign',
					content: rate
				},
				{
					name: 'overtime',
					label: t('component.work_section_overtime'),
					icon: 'lucide:timer',
					content: overtime
				},
				{
					name: 'contributions',
					label: t('component.section_contributions'),
					icon: 'lucide:landmark',
					content: contributions
				},
				{
					name: 'citation',
					label: t('component.work_section_citation'),
					icon: 'lucide:scale',
					content: citation
				}
			] satisfies TabConfig[]}
		/>
	{/snippet}
</CollectionForm>
