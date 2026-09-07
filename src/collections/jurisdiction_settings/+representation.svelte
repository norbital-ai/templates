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
	import { formatNumeric } from '../../lib/ui/display-formatters.js';

	let { record, close, embedded = false }: RepresentationProps & { embedded?: boolean } = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const sealed = $derived(record?.sealed_at != null);
	const voided = $derived(record?.voided_at != null);
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
							<h3 class="text-sm font-semibold">{t('component.profile_identity_and_period')}</h3>
							<p class="text-meta">{t('component.profile_identity_and_period_description')}</p>
						</Stack>
						<Grid gap="md" minimum="panel">
							<Field name="code" label={t('component.settings_lineage')} />
							<Field name="name" />
							<Field name="currency" />
							<Field name="tax_year_start_month" label={t('component.tax_year_start_month')} />
							<Column span="all"
								><Field name="effective_range" label={t('component.effective_period')} /></Column
							>
						</Grid>
					</Stack>

					<Stack as="section" gap="sm" class="border-t border-border pt-5">
						<Stack gap="xs">
							<h3 class="text-sm font-semibold">{t('component.pay_derivation')}</h3>
							<p class="text-meta">{t('component.pay_derivation_description')}</p>
						</Stack>
						<Grid gap="md" minimum="panel">
							<Field name="proration" label={t('component.proration_basis')} />
							<Field name="ordinary_rate" label={t('component.ordinary_rate')} />
						</Grid>
					</Stack>

					<Stack as="section" gap="sm" class="border-t border-border pt-5">
						<Stack gap="xs">
							<h3 class="text-sm font-semibold">{t('component.working_time_and_overtime')}</h3>
							<p class="text-meta">{t('component.working_time_and_overtime_description')}</p>
						</Stack>
						<Field name="regime" label={t('component.regime')} />
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
				<TableColumn name="payer" card="badge" />
				<TableColumn name="keyed_by" label={t('component.keyed_by')} />
				<TableColumn name="rounding" />
				<TableColumn name="sequence" label={t('component.applied_at')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#if embedded || !record}
	{@render snapshot()}
{:else}
	<RecordShell
		title={`${record.code} · ${record.name}`}
		subtitle={t('component.ordinary_pay_note', {
			divisor: formatNumeric(record.ordinary_rate?.divisor),
			unit:
				record.ordinary_rate?.per === 'HOUR' ? t('component.hours_unit') : t('component.days_unit')
		})}
		tabs={[
			{
				name: 'snapshot',
				label: t('component.payroll_rules'),
				icon: 'lucide:scale',
				content: snapshot
			},
			{
				name: 'contributions',
				label: t('component.statutory_contributions'),
				icon: 'lucide:landmark',
				content: contributions
			}
		] satisfies TabConfig[]}
	/>
{/if}
