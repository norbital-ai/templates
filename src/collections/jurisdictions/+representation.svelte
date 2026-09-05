<script lang="ts">
	/**
	 * One versioned statutory profile, edited as one unit while it is a DRAFT.
	 *
	 * Working-time coverage, prices, limits and the statutory leave floors are attributes of the
	 * version. They are not sibling collections with independent dates, which prevents payroll from
	 * assembling one result out of incompatible law revisions. Contribution schemes remain separate
	 * because they are independently versioned programs and own genuine rate-band collections, but
	 * they are scoped to this profile and sealed with it.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { JURISDICTION_OPERATOR_HIDDEN_FIELDS } from './operator-form.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Column, Cover, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import * as Table from '@norbital-ai/ui/table';
	import {
		formatNumeric,
		formatRateAward,
		formatRateSelector
	} from '../../lib/ui/display-formatters.js';
	import { statutoryCatalogueProfile } from '../../lib/statutory_profile.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const familyQuery = $derived(
		record?.supersedes_id == null
			? null
			: client.db.jurisdictions.findMany({
					where: { code: { eq: record.code } },
					columns: { id: true, supersedes_id: true },
					limit: 500
				})
	);
	const catalogueId = $derived(
		record == null
			? null
			: record.supersedes_id == null
				? record.id
				: familyQuery?.current == null
					? null
					: statutoryCatalogueProfile(familyQuery.current, record).id
	);
	const revisions = $derived(record?.revision?.contributions ?? []);
	const revisedSchemes = $derived(
		revisions.length === 0
			? null
			: client.db.statutory_contributions.findMany({
					where: { id: { in: revisions.map((row) => row.statutory_contribution_id) } },
					columns: { id: true, code: true, name: true },
					limit: 500
				})
	);
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
			{#each JURISDICTION_OPERATOR_HIDDEN_FIELDS as name (name)}
				<Field {name} hidden />
			{/each}
			<Stack gap="lg">
				<Stack as="section" gap="sm">
					<Stack gap="xs">
						<h3 class="text-sm font-semibold">Identity and validity</h3>
						<p class="text-meta">
							The profile version payroll selects for a pay date. A change of law enacts a new
							version; sealing freezes this one.
						</p>
					</Stack>
					<Grid gap="md" minimum="panel">
						<Field name="code" />
						<Field name="name" />
						<Field name="lifecycle" />
						<Field name="currency" />
						<Field name="tax_year_start_month" label={t('component.tax_year_start_month')} />
						<Column span="all"
							><Field name="effective_range" label={t('component.effective_period')} /></Column
						>
					</Grid>
				</Stack>

				<Stack as="section" gap="sm" class="border-t border-border pt-5">
					<Stack gap="xs">
						<h3 class="text-sm font-semibold">Ordinary pay</h3>
						<p class="text-meta">The basis payroll uses before overtime and contributions.</p>
					</Stack>
					<Grid gap="md" minimum="panel">
						<Field name="proration" label={t('component.proration_basis')} />
						<Field name="ordinary_rate_basis" label={t('component.ordinary_rate_basis')} />
						<Field name="ordinary_rate_divisor" label={t('component.ordinary_rate_divisor')} />
					</Grid>
				</Stack>

				<Stack as="section" gap="sm" class="border-t border-border pt-5">
					<Stack gap="xs">
						<h3 class="text-sm font-semibold">Working time</h3>
						<p class="text-meta">
							Eligibility, overtime pricing, limits, and rest-break compliance.
						</p>
					</Stack>
					<Field name="regime" label={t('component.regime')} />
				</Stack>

				<Stack as="section" gap="sm" class="border-t border-border pt-5">
					<Stack gap="xs">
						<h3 class="text-sm font-semibold">Statutory leave floors</h3>
						<p class="text-meta">
							The minimum days per canonical kind this version states, with the service ladder and
							child scaling the law conditions.
						</p>
					</Stack>
					<Field name="statutory_leave" />
					<Field name="research_urls" />
					<Field name="revision" readonly={record?.lifecycle !== 'DRAFT'} />
				</Stack>
			</Stack>
		{/snippet}
	</CollectionForm>
{/snippet}

{#snippet contributions()}
	{#if familyQuery?.error}
		<p role="alert">{familyQuery.error.message}</p>
	{:else if record && catalogueId == null}
		<p>{t('component.loading')}</p>
	{:else if record && catalogueId}
		{#if revisions.length > 0}
			<Stack gap="md">
				<h3 class="text-sm font-semibold">{t('component.revision_rates')}</h3>
				{#each revisions as revision (revision.statutory_contribution_id)}
					{@const scheme = revisedSchemes?.current?.find(
						(row) => row.id === revision.statutory_contribution_id
					)}
					<Stack gap="sm">
						<h4 class="text-sm font-medium">
							{scheme ? `${scheme.code} · ${scheme.name}` : t('component.loading')}
						</h4>
						<p class="text-meta">{revision.authority}</p>
						<Table.Root>
							<Table.Header
								><Table.Row
									><Table.Head>{t('component.applies_to')}</Table.Head><Table.Head
										>{t('component.award')}</Table.Head
									></Table.Row
								></Table.Header
							>
							<Table.Body
								>{#each revision.rates as rate}<Table.Row
										><Table.Cell>{formatRateSelector(rate.selector, t)}</Table.Cell><Table.Cell
											>{formatRateAward(rate.award, t)}</Table.Cell
										></Table.Row
									>{/each}</Table.Body
							>
						</Table.Root>
					</Stack>
				{/each}
			</Stack>
		{/if}
		<CollectionTable
			{client}
			collection="statutory_contributions"
			view="jurisdictions:contributions"
			title={record.supersedes_id
				? t('component.base_contribution_catalogue')
				: t('component.statutory_contributions')}
			description={t('component.statutory_contributions_description')}
			query={{
				where: { statutory_profile_id: { eq: catalogueId } },
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
					label: 'Payroll rules',
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
