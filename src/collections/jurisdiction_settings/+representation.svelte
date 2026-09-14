<script lang="ts">
	/**
	 * One jurisdiction settings version: the payroll scalars the engine reads, edited as one unit
	 * while the version is a draft and shown read-only once it is sealed. Schemes remain separate
	 * rows because they own genuine rate-band collections, but they belong to this version and
	 * are sealed with it.
	 *
	 * The Settings app shows one semantic group at a time, so the form takes the group it is drawn
	 * for: `GENERAL` is the version's own facts (identity, payroll, wages, sources, change note) and
	 * `WORK_RULES` is the day-pricing rules. Every mutable field is still declared exactly once in
	 * every mode — the CollectionForm contract — and the work-rules group is folded back in when the
	 * record is being created, where a caller has no second surface to set it from.
	 *
	 * `embedded` is the Settings timeline's use: the form alone, under the timeline's own tabs.
	 */
	import { client } from '../../lib/workspace-client.js';
	import Icon from '@iconify/svelte';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { TabConfig } from '@norbital-ai/ui/tabs';
	import { Tooltip } from '@norbital-ai/ui/tooltip';
	import { setContext } from 'svelte';
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../../lib/ui/create-scope.js';
	import FormSection from '../../lib/ui/form-section.svelte';
	import CalculationFlow from '../../lib/ui/calculation-flow.svelte';

	type Section = 'GENERAL' | 'WORK_RULES';

	let {
		record,
		close,
		embedded = false,
		section = 'GENERAL'
	}: RepresentationProps & { embedded?: boolean; section?: Section } = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const sealed = $derived(record?.sealed_at != null);
	const voided = $derived(record?.voided_at != null);
	/** A create has one surface only, so it carries both groups; an edit shows the asked-for one. */
	const showGeneral = $derived(section !== 'WORK_RULES' || record == null);
	const showWorkRules = $derived(section === 'WORK_RULES' || record == null);
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
	<CollectionForm
		{client}
		collection="jurisdiction_settings"
		defaultValues={record ?? undefined}
		readonly={sealed}
		submitLabel={record ? t('component.save_settings') : t('component.create_settings')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Field name="sealed_at" hidden />
			<Field name="voided_at" hidden />
			<Field name="void_reason" hidden />
			<Field name="cloned_from_id" hidden />
			{#if showGeneral}
				<Stack gap="lg">
					<FormSection
						first
						title={t('component.settings_section_identity')}
						hint={t('component.settings_section_identity_hint')}
					>
						{#if record && (sealed || voided)}
							<!-- One compact state mark; the sentence lives behind it. -->
							<Tooltip
								side="bottom"
								align="start"
								sideOffset={6}
								contentClass="max-w-96 border bg-popover text-popover-foreground"
								arrowClasses="text-popover"
							>
								{#snippet trigger({ props })}
									<button
										{...props}
										type="button"
										data-settings-sealed-note
										class="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
									>
										<Icon
											icon={voided ? 'lucide:circle-slash' : 'lucide:lock-keyhole'}
											class="size-3 shrink-0"
											aria-hidden="true"
										/>
										{voided
											? t('component.settings_voided_badge')
											: t('component.settings_sealed_badge')}
									</button>
								{/snippet}
								{#snippet content()}
									<p class="px-2.5 py-2 text-left text-xs text-muted-foreground">
										{voided
											? t('component.settings_voided_note', { reason: record.void_reason ?? '' })
											: t('component.settings_sealed_note')}
									</p>
								{/snippet}
							</Tooltip>
						{/if}
						<Grid gap="sm" minimum="panel">
							<Field name="code" label={t('component.settings_lineage')} />
							<Field name="jurisdiction_code" label={t('holiday_calendar.jurisdiction')} />
							<Field name="name" />
							<Field
								name="effective_range"
								label={t('component.effective_period')}
								description={t('component.effective_period_hint')}
							/>
						</Grid>
					</FormSection>

					<FormSection title={t('component.payroll_rules')}>
						<Grid gap="sm" minimum="panel">
							<Field name="payroll" />
							<Field
								name="wages"
								label={t('component.minimum_wage_by_region')}
								description={t('component.minimum_wage_by_region_hint')}
							/>
						</Grid>
					</FormSection>

					{#if record}
						<FormSection
							title={t('component.calculation_flow')}
							hint={t('component.calculation_flow_hint')}
						>
							<CalculationFlow version={record} />
						</FormSection>
					{/if}

					<Stack class="border-t pt-6">
						<Field
							name="change_summary"
							description={t('component.settings_section_changes_hint')}
						/>
					</Stack>

					<Stack class="border-t pt-6">
						<Field
							name="code"
							label={t('component.settings_lineage')}
							description={t('component.settings_lineage_version_hint')}
						/>
					</Stack>
				</Stack>
			{:else}
				<Field name="code" hidden />
				<Field name="jurisdiction_code" hidden />
				<Field name="name" hidden />
				<Field name="effective_range" hidden />
				<Field name="payroll" hidden />
				<Field name="wages" hidden />
				<Field name="change_summary" hidden />
				<Field name="sources" hidden />
			{/if}

			{#if showWorkRules}
				<Stack class={showGeneral ? 'border-t pt-6' : undefined}>
					<Field
						name="work_rules"
						label={t('component.work_rules')}
						description={t('component.work_rules_hint')}
					/>
				</Stack>
			{:else}
				<Field name="work_rules" hidden />
			{/if}
		{/snippet}
	</CollectionForm>
{/snippet}

{#snippet contributions()}
	{#if record}
		<Stack gap="lg">
			<CollectionTable
				{client}
				collection="statutory_contributions"
				view="jurisdiction_settings:contributions"
				title={t('component.statutory_contributions')}
				description={t('component.statutory_contributions_description')}
				query={{
					where: { settings_id: { eq: record.id } },
					orderBy: { code: 'asc' }
				}}
			>
				{#snippet columns({ Column: TableColumn })}
					<TableColumn name="code" card="title" />
					<TableColumn name="name" card="subtitle" />
					<TableColumn name="is_statutory" label={t('component.is_statutory')} card="badge" />
					<TableColumn name="authority" />
					<TableColumn name="assessment_period" />
				{/snippet}
			</CollectionTable>
		</Stack>
	{/if}
{/snippet}

{#if embedded}
	{@render snapshot()}
{:else}
	<!-- Tab content must be snippets (TabConfig.content); the shell always renders tabs so no snippet is ever render-called elsewhere. -->
	<RecordShell
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
