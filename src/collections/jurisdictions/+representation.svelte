<script lang="ts">
	/**
	 * One dated statutory snapshot, edited as one unit.
	 *
	 * Working-time coverage, prices and limits are attributes of the snapshot. They are not
	 * sibling collections with independent dates, which prevents payroll from assembling one result
	 * out of incompatible law revisions. Contribution schemes remain separate because they are
	 * independently versioned programs and own genuine rate-band collections.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Column, Cover, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { inForceTodayFilter } from '../../lib/ui/calendar.js';
	import { formatNumeric } from '../../lib/ui/display-formatters.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

{#snippet snapshot()}
	<CollectionForm
		{client}
		collection="jurisdictions"
		defaultValues={record ?? undefined}
		submitLabel={record ? t('component.save_jurisdiction') : t('component.create_jurisdiction')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Grid gap="md" minimum="panel">
				<Field name="code" />
				<Field name="name" />
				<Field name="currency" />
				<Field name="tax_year_start_month" label={t('component.tax_year_start_month')} />
				<Field name="proration" label={t('component.proration_basis')} />
				<Field name="ordinary_rate_basis" label={t('component.ordinary_rate_basis')} />
				<Field name="ordinary_rate_divisor" label={t('component.ordinary_rate_divisor')} />
				<Column span="all">
					<Field name="effective_range" label={t('component.effective_period')} />
				</Column>
				<Column span="all">
					<Field name="regime" label={t('component.regime')} />
				</Column>
			</Grid>
		{/snippet}
	</CollectionForm>
{/snippet}

{#snippet contributions()}
	{#if record}
		<CollectionTable
			{client}
			collection="statutory_contributions"
			view="jurisdictions:contributions"
			title={t('component.statutory_contributions')}
			description={t('component.statutory_contributions_description')}
			initialFilters={inForceTodayFilter()}
			query={{
				where: { jurisdiction_id: { eq: record.norbital_id } },
				orderBy: { sequence: 'asc' }
			}}
		>
			{#snippet columns({ Column: TableColumn })}
				<TableColumn name="code" card="title" />
				<TableColumn name="name" card="subtitle" />
				<TableColumn name="authority" />
				<TableColumn name="payer" card="badge" />
				<TableColumn name="keyed_by" label={t('component.keyed_by')} />
				<TableColumn name="rounding" />
				<TableColumn name="sequence" label={t('component.applied_at')} />
				<TableColumn name="effective_range" label={t('component.effective')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#if record}
	{#snippet jurisdictionSummary()}
		<Stack gap="xs">
			<Inline gap="sm" align="baseline">
				<h2 class="truncate text-heading">{record.code} · {record.name}</h2>
				<span class="text-sm text-muted-foreground">{record.currency}</span>
			</Inline>
			<p class="text-sm text-muted-foreground">
				{t('component.ordinary_pay_note', {
					divisor: formatNumeric(record.ordinary_rate_divisor),
					unit:
						record.ordinary_rate_basis === 'HOURS_PER_MONTH'
							? t('component.hours_unit')
							: t('component.days_unit')
				})}
			</p>
		</Stack>
	{/snippet}

	<Cover as="main" gap="md" top={jurisdictionSummary}>
		<Tabs
			animate={false}
			listClass="mx-0 w-full"
			contentPadding={false}
			config={[
				{
					name: 'snapshot',
					label: t('component.regime'),
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
	</Cover>
{:else}
	{@render snapshot()}
{/if}
