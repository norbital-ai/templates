<script lang="ts">
	import { client } from '../../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import * as ToggleGroup from '@norbital-ai/ui/toggle-group';
	import { heatmapClass } from '../display-formatters.js';
	import {
		bucketSeasonalHeatmap,
		componentSeasonalityCategories,
		componentSeasonalityDate,
		seasonalityDateWindow,
		seasonalityYears
	} from '../../seasonality.js';

	let { companyId }: { companyId: string } = $props();

	const { t } = useI18n<TenantI18nKeys>();

	const currentYear = new Date().getUTCFullYear();
	const historyYears = seasonalityYears(currentYear);
	const { start: windowStart, endExclusive: windowEnd } = seasonalityDateWindow(currentYear);
	const analyticsQuery = $derived(
		client.db.component_entries.findMany({
			where: { entry_employment: { company_id: { eq: companyId } } },
			columns: { origin: true, event_date: true },
			limit: 5000
		})
	);
	const analytics = $derived.by(() => {
		const rows = analyticsQuery.current;
		if (rows === undefined) return null;
		const dated = rows
			.map((row) => ({
				category: row.origin.kind,
				date: componentSeasonalityDate(row.origin, row.event_date)
			}))
			.filter((row) => row.date >= windowStart && row.date < windowEnd);
		return {
			total: dated.length,
			seasonal_heatmap: bucketSeasonalHeatmap(
				historyYears,
				dated.map((row) => row.date)
			),
			categories: componentSeasonalityCategories.map((category) => {
				const dates = dated.filter((row) => row.category === category).map((row) => row.date);
				return {
					category,
					total: dates.length,
					seasonal_heatmap: bucketSeasonalHeatmap(historyYears, dates)
				};
			})
		};
	});
	let selectedCategory = $state('ALL');
	const selectedAnalytics = $derived.by(() => {
		if (!analytics || selectedCategory === 'ALL') return analytics;
		return analytics.categories?.find((entry) => entry.category === selectedCategory) ?? analytics;
	});
	const heatmapMaximum = $derived(
		Math.max(0, ...(selectedAnalytics?.seasonal_heatmap ?? []).flatMap((row) => row.months))
	);

	function categoryLabel(category: string): string {
		switch (category) {
			case 'RECURRING':
				return t('app.pay_components.category_recurring');
			case 'ONE_OFF':
				return t('app.pay_components.category_one_off');
			case 'CLAIM':
				return t('app.pay_components.category_claim');
			case 'LOAN_INSTALMENT':
				return t('app.pay_components.category_loan_instalment');
			case 'REVERSAL':
				return t('app.pay_components.category_reversal');
			case 'ARREARS':
				return t('app.pay_components.category_arrears');
			case 'MANUAL_ADJUSTMENT':
				return t('app.pay_components.category_manual_adjustment');
			default:
				return t('app.pay_components.category_all');
		}
	}
</script>

<Stack as="section" gap="md" aria-labelledby="pay-component-seasonality-heading">
	<Stack gap="xs">
		<h2 class="text-heading">{t('app.pay_components.activity')}</h2>
		{#if analytics}
			<p class="text-sm text-muted-foreground">
				{t('app.pay_components.activity_description', {
					count: analytics.total.toLocaleString()
				})}
			</p>
		{/if}
	</Stack>
	<Stack gap="md" class="rounded-lg border bg-card p-4 shadow-card">
		<Stack gap="xs">
			<h3 id="pay-component-seasonality-heading" class="font-semibold">
				{t('app.pay_components.chart_title')}
			</h3>
			<p class="text-sm text-muted-foreground">{t('app.pay_components.chart_description')}</p>
		</Stack>
		{#if analytics}
			<ToggleGroup.Root
				type="single"
				bind:value={selectedCategory}
				variant="outline"
				size="sm"
				class="flex-wrap justify-start"
				aria-label={t('app.pay_components.category_filter')}
			>
				<ToggleGroup.Item value="ALL">
					{t('app.pay_components.category_all')}
				</ToggleGroup.Item>
				{#each analytics.categories ?? [] as category (category.category)}
					<ToggleGroup.Item value={category.category}>
						{categoryLabel(category.category)} · {category.total.toLocaleString()}
					</ToggleGroup.Item>
				{/each}
			</ToggleGroup.Root>
			<!-- repository-health:allow UI3 -- this is a derived reporting matrix, not a collection. -->
			<table class="w-full table-fixed border-separate border-spacing-1 text-center text-xs">
				<caption class="sr-only">{t('app.pay_components.chart_description')}</caption>
				<thead class="text-muted-foreground">
					<tr>
						<th class="w-14 pb-1 text-left font-medium">{t('app.pay_components.heatmap_year')}</th>
						{#each Array.from({ length: 12 }, (_value, index) => index + 1) as month (month)}
							<th class="pb-1 font-medium" scope="col">{month}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each selectedAnalytics?.seasonal_heatmap ?? [] as row (row.year)}
						<tr>
							<th class="pr-1 text-left font-medium tabular-nums" scope="row">
								{row.year}
							</th>
							{#each row.months as count, monthIndex (`${row.year}-${monthIndex}`)}
								<td>
									<span
										class="block rounded-sm py-2 font-medium tabular-nums {heatmapClass(
											count,
											heatmapMaximum
										)}"
										title={t('app.pay_components.heatmap_cell', {
											year: row.year,
											month: monthIndex + 1,
											count
										})}
									>
										{count}
									</span>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
			<Inline justify="end" gap="xs" aria-label={t('app.pay_components.heatmap_legend')}>
				<span class="text-meta">{t('app.pay_components.heatmap_fewer')}</span>
				{#each [1, 2, 3, 4, 5] as level (level)}
					<span
						class="size-3 rounded-sm {heatmapClass(
							Math.max(1, Math.ceil((heatmapMaximum * level) / 5)),
							heatmapMaximum
						)}"
					></span>
				{/each}
				<span class="text-meta">{t('app.pay_components.heatmap_more')}</span>
			</Inline>
		{:else if analyticsQuery.error}
			<p class="py-8 text-center text-sm text-destructive">
				{t('app.pay_components.seasonality_error')}
			</p>
		{:else}
			<p class="py-8 text-center text-sm text-muted-foreground">
				{t('app.pay_components.loading_seasonality')}
			</p>
		{/if}
	</Stack>
</Stack>
