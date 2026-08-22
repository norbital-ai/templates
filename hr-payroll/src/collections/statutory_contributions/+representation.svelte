<script lang="ts">
	/**
	 * One statutory scheme, and the rate bands that price it.
	 *
	 * `contribution_rates.statutory_contribution_id` points at a scheme — not at a jurisdiction — so a
	 * band is not a sibling of the scheme and cannot be read beside one. A row like "5.5% from RM0 to
	 * RM5,000" is meaningless without the EPF/SOCSO/EIS scheme whose wage ladder it is a rung of, and
	 * the database says so: `contribution_rates_no_overlap` excludes overlaps *within one
	 * contribution*, so the set of bands that must not collide is exactly the set shown below.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';
	import { Column, Cover, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { inForceTodayFilter } from '../../lib/ui/calendar.js';
	import { formatRateAward, formatRateSelector } from '../../lib/ui/display-formatters.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	/*
	 * Bands are effective-dated, so the ladder opens on the rung in force *today* — the one payroll
	 * would actually use — seeded as a removable filter chip rather than a page-level toggle. The
	 * chip says what is being hidden, the operator widens it in place, and clearing it is
	 * remembered. `inForceTodayFilter()` writes the seed in the filter builder's vocabulary — a
	 * plain calendar day — and the existing conversion turns it into the instant `contains_date`
	 * compares against.
	 *
	 * `contribution_rates` carries `effective_range` itself, which is what the seed needs: an
	 * unknown field is skipped in silence, so a seed pointed at a related collection's dating would
	 * look like a working filter while filtering nothing.
	 */

	const payerLabel = $derived(
		record?.payer === 'BOTH' ? 'employee and employer' : (record?.payer?.toLowerCase() ?? 'nobody')
	);
	const keyedByLabel = $derived(
		record?.keyed_by?.toLowerCase().replaceAll('_', ' ') ?? 'nothing yet'
	);
</script>

{#snippet scheme()}
	<CollectionForm
		{client}
		collection="statutory_contributions"
		defaultValues={record ?? undefined}
		submitLabel={record ? t('component.save_scheme') : t('component.create_scheme')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<Stack as="section" gap="sm">
					<Stack gap="xs">
						<h3 class="text-sm font-semibold">Scheme identity</h3>
						<p class="text-meta">The authority, jurisdiction, and period this scheme belongs to.</p>
					</Stack>
					<Grid gap="md" minimum="panel">
						<Field
							name="jurisdiction_id"
							label={t('component.jurisdiction')}
							renderer={RelationshipRenderer}
							rendererProps={{
								target: 'jurisdictions',
								options: {
									label: (jurisdiction) =>
										[jurisdiction.code, jurisdiction.name]
											.filter((part) => part != null && part !== '')
											.join(' · ') || '—',
									orderBy: { code: 'asc' },
									limit: 200
								}
							}}
						/>
						<Field name="code" />
						<Field name="name" />
						<Field name="authority" />
						<Column span="all">
							<Field name="effective_range" label={t('component.effective_period')} />
						</Column>
					</Grid>
				</Stack>

				<Stack as="section" gap="sm" class="border-t border-border pt-5">
					<Stack gap="xs">
						<h3 class="text-sm font-semibold">Calculation</h3>
						<p class="text-meta">
							Who pays, how rate bands are selected, and when the scheme applies.
						</p>
					</Stack>
					<Grid gap="md" minimum="panel">
						<Field name="payer" label={t('component.paid_by')} />
						<Field name="keyed_by" label={t('component.bands_keyed_by')} />
						<Field name="rounding" />
						<Field name="sequence" label={t('component.applied_at')} />
					</Grid>
				</Stack>

				<Stack as="section" gap="sm" class="border-t border-border pt-5">
					<Stack gap="xs">
						<h3 class="text-sm font-semibold">Relief and named rules</h3>
						<p class="text-meta">Only configure exceptions the scheme explicitly declares.</p>
					</Stack>
					<Field
						name="relief_for"
						label={t('component.gives_relief_for')}
						renderer={RelationshipRenderer}
						rendererProps={{
							target: 'statutory_contributions',
							multiple: true,
							options: {
								label: (contribution) =>
									[contribution.code, contribution.name]
										.filter((part) => part != null && part !== '')
										.join(' · ') || '—',
								orderBy: { sequence: 'asc' },
								limit: 500
							}
						}}
					/>
					<Field name="special_rules" label={t('component.named_special_rules')} />
				</Stack>

				{#if !record}
					<Stack as="section" gap="sm" class="border-t border-border pt-5">
						<h3 class="text-sm font-semibold">Overtime chargeability</h3>
						<Field name="overtime_treatments" label="Derived overtime" />
						<Field name="overtime_excess_treatments" label="Excess overtime" />
					</Stack>
				{/if}
			</Stack>
		{/snippet}
	</CollectionForm>
{/snippet}

{#snippet overtimeTreatments()}
	{#if record}
		<CollectionForm
			{client}
			collection="statutory_contributions"
			defaultValues={record}
			submitLabel={t('component.save_scheme')}
		>
			{#snippet children({ Field })}
				<Stack gap="lg">
					<Stack as="section" gap="sm">
						<Stack gap="xs">
							<h3 class="text-sm font-semibold">Derived overtime</h3>
							<p class="text-meta">How this scheme charges ordinary derived overtime over time.</p>
						</Stack>
						<Field name="overtime_treatments" label="Overtime positions" />
					</Stack>
					<Stack as="section" gap="sm" class="border-t border-border pt-5">
						<Stack gap="xs">
							<h3 class="text-sm font-semibold">Excess overtime</h3>
							<p class="text-meta">
								How reclassified overtime beyond a total-hours limit is charged.
							</p>
						</Stack>
						<Field name="overtime_excess_treatments" label="Excess overtime positions" />
					</Stack>
				</Stack>
			{/snippet}
		</CollectionForm>
	{/if}
{/snippet}

{#snippet rates()}
	{#if record}
		<CollectionTable
			{client}
			collection="contribution_rates"
			view="statutory_contributions:rates"
			title={t('component.rate_bands')}
			description={t('component.rate_bands_description')}
			initialFilters={inForceTodayFilter()}
			query={{
				where: { statutory_contribution_id: { eq: record.id } },
				orderBy: { created_at: 'desc' }
			}}
		>
			{#snippet columns({ Column: TableColumn })}
				<TableColumn
					name="selector"
					label={t('component.applies_to')}
					card="title"
					render={({ value }) => formatRateSelector(value, t)}
				/>
				<TableColumn
					name="award"
					label={t('component.award')}
					card="subtitle"
					render={({ value }) => formatRateAward(value, t)}
				/>
				<TableColumn name="effective_range" label={t('component.effective')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#if record}
	{#snippet schemeSummary()}
		<Stack gap="xs">
			<Inline gap="sm" align="baseline">
				<h2 class="truncate text-heading">{record.code} · {record.name}</h2>
				<span class="text-sm text-muted-foreground">{record.authority}</span>
			</Inline>
			<p class="text-sm text-muted-foreground">
				Paid by {payerLabel}, applied at step {record.sequence}, with bands keyed by {keyedByLabel}.
				End-date a band and insert a successor; never update one in place.
			</p>
		</Stack>
	{/snippet}

	<Cover as="main" gap="md" top={schemeSummary}>
		<!-- The detail sheet already insets this surface; the list must not inset itself again. -->
		<Tabs
			animate={false}
			listClass="mx-0 w-full"
			contentPadding={false}
			config={[
				{ name: 'scheme', label: 'Scheme', icon: 'lucide:landmark', content: scheme },
				{
					name: 'overtime',
					label: 'Overtime',
					icon: 'lucide:clock-arrow-up',
					content: overtimeTreatments
				},
				{ name: 'rates', label: 'Rate bands', icon: 'lucide:percent', content: rates }
			] satisfies TabConfig[]}
		/>
	</Cover>
{:else}
	{@render scheme()}
{/if}
