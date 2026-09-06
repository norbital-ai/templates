<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Cluster, Cover, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { Badge } from '@norbital-ai/ui/badge';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import * as Sheet from '@norbital-ai/ui/sheet';
	import { inForceTodayFilter } from '../../lib/ui/calendar.js';
	import { formatEffectiveRange } from '../../lib/ui/display-formatters.js';
	import JurisdictionRepresentation from '../../collections/jurisdictions/+representation.svelte';

	const { t } = useI18n<TenantI18nKeys>();

	let formOpen = $state(false);
	let openJurisdiction = $state<WorkspaceRow<'jurisdictions'> | null>(null);

	const jurisdictionsQuery = $derived(
		client.db.jurisdictions.findMany({
			where: { approval_id: { isNull: true } },
			orderBy: { code: 'asc' },
			limit: 200
		})
	);
	const jurisdictionRows = $derived(jurisdictionsQuery.current ?? []);
	const jurisdictionsUnknown = $derived(
		jurisdictionsQuery.loading && jurisdictionsQuery.current === undefined
	);

	function openJurisdictionForm(row: WorkspaceRow<'jurisdictions'>): void {
		openJurisdiction = row;
		formOpen = true;
	}

	function onJurisdictionFormOpenChange(next: boolean): void {
		formOpen = next;
		if (!next) openJurisdiction = null;
	}
</script>

<svelte:head>
	<title>Statutory profile</title>
	<meta
		name="description"
		content="The regime every payroll is calculated against: jurisdictions with the schemes, rates, overtime rules and limits configured inside them, and the companies bound to each"
	/>
	<meta name="bolt:icon" content="lucide:scale" />
	<meta
		name="bolt:thumbnail"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/settings-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/settings-banner.webp"
	/>
</svelte:head>

{#snippet jurisdictions()}
	<Stack gap="sm">
		<Stack gap="xs">
			<h2 class="text-sm font-semibold">{t('app.settings.jurisdictions_title')}</h2>
			<p class="text-meta">{t('app.settings.jurisdictions_description')}</p>
		</Stack>
		{#if jurisdictionsQuery.error && jurisdictionsQuery.current === undefined}
			<p class="py-8 text-center text-sm text-destructive">{jurisdictionsQuery.error.message}</p>
		{:else if jurisdictionsUnknown}
			<Inline
				justify="center"
				align="center"
				gap="sm"
				class="min-h-48 text-sm text-muted-foreground"
			>
				<Spinner class="size-4" />
				<span>{t('component.loading')}</span>
			</Inline>
		{:else}
			<Stack gap="none" class="overflow-hidden rounded-lg border">
				{#each jurisdictionRows as row (row.id)}
					<button
						type="button"
						data-jurisdiction-row={row.id}
						class="hover:bg-muted/60 focus-visible:bg-muted/60 w-full border-b px-4 py-3 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onclick={() => openJurisdictionForm(row)}
					>
						<Cluster gap="sm" align="center">
							<span class="font-mono text-sm font-medium">{row.code}</span>
							<span class="min-w-0 truncate text-sm">{row.name}</span>
							<Badge variant="outline">{row.lifecycle}</Badge>
							<span class="text-sm text-muted-foreground">{row.currency}</span>
							<span class="text-sm text-muted-foreground"
								>{formatEffectiveRange(row.effective_range)}</span
							>
						</Cluster>
					</button>
				{/each}
			</Stack>
		{/if}
	</Stack>
{/snippet}

{#snippet companies()}
	<CollectionTable
		{client}
		collection="companies"
		view="hr_controller:settings:companies"
		title={t('app.settings.companies_title')}
		description={t('app.settings.companies_description')}
		initialFilters={inForceTodayFilter()}
		query={{ orderBy: { name: 'asc' } }}
	>
		{#snippet columns({ Column })}
			<Column name="name" card="title" />
			<Column name="registration_number" card="subtitle" />
			<Column name="jurisdiction_id" label={t('app.settings.jurisdiction')} />
			<Column name="pay_day" label={t('app.settings.pay_day')} />
			<Column name="effective_range" label={t('component.effective')} />
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet researchSources()}
	<CollectionTable
		{client}
		collection="statutory_research_sources"
		view="hr_controller:settings:research_sources"
		title={t('app.settings.research_sources')}
		description={t('app.settings.research_sources_description')}
	>
		{#snippet columns({ Column })}
			<Column name="title" card="title" />
			<Column name="jurisdiction_code" />
			<Column name="url" />
			<Column name="active" />
			<Column name="rationale" />
		{/snippet}
	</CollectionTable>
{/snippet}

<Cover>
	<Tabs
		animate={false}
		config={[
			{
				name: 'jurisdictions',
				label: t('app.settings.jurisdictions_title'),
				icon: 'lucide:globe',
				content: jurisdictions
			},
			{
				name: 'research_sources',
				label: t('app.settings.research_sources'),
				icon: 'lucide:shield-check',
				content: researchSources
			},
			{
				name: 'companies',
				label: t('app.settings.tab_companies'),
				icon: 'lucide:building-2',
				content: companies
			}
		] satisfies TabConfig[]}
	/>
</Cover>

<Sheet.Root open={formOpen} onOpenChange={onJurisdictionFormOpenChange}>
	<Sheet.Content
		side="right"
		data-jurisdiction-form
		style="--sheet-width: 48rem; --sheet-max-width: 95vw;"
	>
		{#if openJurisdiction}
			<JurisdictionRepresentation
				record={openJurisdiction}
				close={() => onJurisdictionFormOpenChange(false)}
			/>
		{/if}
	</Sheet.Content>
</Sheet.Root>
