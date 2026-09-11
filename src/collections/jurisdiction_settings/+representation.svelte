<script lang="ts">
	/**
	 * One jurisdiction settings version: the payroll scalars the engine reads, edited as one unit
	 * while the version is a draft and shown read-only once it is sealed. Schemes remain separate
	 * rows because they own genuine rate-band collections, but they belong to this version and
	 * are sealed with it.
	 *
	 * `embedded` is the Settings timeline's use: the form alone, under the timeline's own tabs.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { TabConfig } from '@norbital-ai/ui/tabs';
	import { setContext } from 'svelte';
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close, embedded = false }: RepresentationProps & { embedded?: boolean } = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const sealed = $derived(record?.sealed_at != null);
	const voided = $derived(record?.voided_at != null);
	/**
	 * The scope the schemes table hands to the form it opens. Every row under this version belongs
	 * to it: offering the version picker would let a scheme be filed into a different version than
	 * the one on screen — and the table it lands in then does not contain it. Same rule the Settings
	 * page states for the catalogues it draws.
	 */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => undefined,
		settingsCode: () => (record?.code == null ? undefined : String(record.code)),
		settingsId: () => record?.id
	});
</script>

{#snippet snapshot()}
	<Stack gap="sm">
		{#if record && sealed}
			<p class="text-sm text-muted-foreground" data-settings-sealed-note>
				{voided
					? t('component.settings_voided_note', { reason: record.void_reason ?? '' })
					: t('component.settings_sealed_note')}
			</p>
		{/if}
		<CollectionForm
			{client}
			collection="jurisdiction_settings"
			defaultValues={record ?? undefined}
			disabled={sealed}
			submitLabel={record ? t('component.save_settings') : t('component.create_settings')}
			onAfterSubmit={record ? undefined : close}
		>
			{#snippet children({ Field })}
				<Field name="sealed_at" hidden />
				<Field name="voided_at" hidden />
				<Field name="void_reason" hidden />
				<Field name="cloned_from_id" hidden />
				<Field name="research_notes" hidden />
				<Stack gap="lg">
					<Stack as="section" gap="sm">
						<Stack gap="xs">
							<h3 class="text-sm font-semibold">{t('component.settings_section_identity')}</h3>
							<p class="text-meta">{t('component.settings_section_identity_hint')}</p>
						</Stack>
						<Grid gap="sm" minimum="compact">
							<Field name="code" label={t('component.settings_lineage')} />
							<Field name="jurisdiction_code" label={t('holiday_calendar.jurisdiction')} />
							<Field name="name" />
							<Field name="currency" />
							<Field name="tax_year_start_month" label={t('component.tax_year_start_month')} />
							<Column span="all">
								<Field
									name="effective_range"
									label={t('component.effective_period')}
									description={t('component.effective_period_hint')}
								/>
							</Column>
							<Column span="all">
								<Field
									name="minimum_wages"
									label={t('component.minimum_wages')}
									description={t('component.minimum_wages_hint')}
								/>
							</Column>
						</Grid>
					</Stack>

					<Stack as="section" gap="sm">
						<Stack gap="xs">
							<h3 class="text-sm font-semibold">{t('component.settings_section_changes')}</h3>
							<p class="text-meta">{t('component.settings_section_changes_hint')}</p>
						</Stack>
						<!-- Declared on both branches: a mutable field the form never names is refused. -->
						<Field name="change_summary" label={t('component.change_summary')} hidden={sealed} />
						{#if sealed}
							{#if record?.change_summary}
								<p class="text-sm whitespace-pre-line" data-settings-change-summary>
									{record.change_summary}
								</p>
							{:else}
								<p class="text-sm text-muted-foreground" data-settings-change-summary-missing>
									{t('component.settings_change_summary_missing')}
								</p>
							{/if}
						{/if}
					</Stack>

					<Stack as="section" gap="sm">
						<Stack gap="xs">
							<h3 class="text-sm font-semibold">{t('component.research_urls')}</h3>
							<p class="text-meta">{t('component.settings_section_sources_hint')}</p>
						</Stack>
						<Field name="research_urls" label={t('component.research_urls')} />
					</Stack>
				</Stack>
			{/snippet}
		</CollectionForm>
	</Stack>
{/snippet}

{#snippet contributions()}
	{#if record}
		<CollectionTable
			{client}
			collection="statutory_contributions"
			view="jurisdiction_settings:contributions"
			title={t('component.statutory_contributions')}
			description={t('component.statutory_contributions_description')}
			query={{
				where: { settings_id: { eq: record.id } },
				orderBy: { sequence: 'asc' }
			}}
		>
			{#snippet columns({ Column: TableColumn })}
				<TableColumn name="code" card="title" />
				<TableColumn name="name" card="subtitle" />
				<TableColumn name="is_statutory" label={t('component.is_statutory')} card="badge" />
				<TableColumn name="authority" />
				<TableColumn name="rounding" />
				<TableColumn name="sequence" label={t('component.applied_at')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#if embedded}
	{@render snapshot()}
{:else}
	<!-- Tab content must be snippets (TabConfig.content); the shell always renders tabs so no snippet is ever render-called elsewhere. -->
	<RecordShell
		title={record ? `${record.code} · ${record.name}` : t('component.create_settings')}
		tabs={[
			{
				name: 'snapshot',
				label: t('component.payroll_rules'),
				icon: 'lucide:scale',
				content: snapshot
			},
			...(record
				? [
						{
							name: 'contributions',
							label: t('component.statutory_contributions'),
							icon: 'lucide:landmark',
							content: contributions
						}
					]
				: [])
		] satisfies TabConfig[]}
	/>
{/if}
