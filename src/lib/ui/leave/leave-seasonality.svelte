<script lang="ts">
	import { client } from '../../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { formatDateISO } from '@norbital-ai/std/date';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { heatmapClass } from '../display-formatters.js';
	import {
		bucketSeasonalHeatmap,
		seasonalityDateWindow,
		seasonalityYears
	} from '../../seasonality.js';

	let { companyId }: { companyId: string } = $props();

	const { t } = useI18n<TenantI18nKeys>();

	const currentYear = new Date().getUTCFullYear();
	const historyYears = seasonalityYears(currentYear);
	const { start: windowStart, endExclusive: windowEnd } = seasonalityDateWindow(currentYear);
	const companyScope = $derived({
		leave_request_employment: { company_id: { eq: companyId } }
	} as const);
	const analyticsQuery = $derived(
		client.db.leave_requests.findMany({
			where: { ...companyScope, kind: { eq: 'TIME_OFF' } },
			columns: { from_date: true },
			limit: 5000
		})
	);
	const analytics = $derived.by(() => {
		const rows = analyticsQuery.current;
		if (rows === undefined) return null;
		const seasonalRows = rows.filter((row) => {
			const date = row.from_date == null ? '' : formatDateISO(row.from_date);
			return date >= windowStart && date < windowEnd;
		});
		return {
			total: rows.length,
			seasonal_heatmap: bucketSeasonalHeatmap(
				historyYears,
				seasonalRows.map((row) => row.from_date)
			)
		};
	});
	const heatmapMaximum = $derived(
		Math.max(0, ...(analytics?.seasonal_heatmap ?? []).flatMap((row) => row.months))
	);
</script>

<Stack as="section" gap="md" aria-labelledby="leave-seasonality-heading">
	<Stack gap="xs">
		<h2 class="text-heading">{t('app.leave.leave_activity')}</h2>
		{#if analytics}
			<p class="text-sm text-muted-foreground">
				{t('app.leave.leave_activity_description', {
					count: analytics.total.toLocaleString()
				})}
			</p>
		{/if}
	</Stack>
	<Stack gap="md" class="rounded-lg border bg-card p-4 shadow-card">
		<Stack gap="xs">
			<h3 id="leave-seasonality-heading" class="font-semibold">
				{t('app.leave.chart_title')}
			</h3>
			<p class="text-sm text-muted-foreground">{t('app.leave.chart_description')}</p>
		</Stack>
		{#if analytics}
			<!-- repository-health:allow UI3 -- this is a derived reporting matrix, not a collection. -->
			<table class="w-full table-fixed border-separate border-spacing-1 text-center text-xs">
				<caption class="sr-only">{t('app.leave.chart_description')}</caption>
				<thead class="text-muted-foreground">
					<tr>
						<th class="w-14 pb-1 text-left font-medium">{t('app.leave.heatmap_year')}</th>
						{#each Array.from({ length: 12 }, (_value, index) => index + 1) as month (month)}
							<th class="pb-1 font-medium" scope="col">{month}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each analytics.seasonal_heatmap as row (row.year)}
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
										title={t('app.leave.heatmap_cell', {
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
			<Inline justify="end" gap="xs" aria-label={t('app.leave.heatmap_legend')}>
				<span class="text-meta">{t('app.leave.heatmap_fewer')}</span>
				{#each [1, 2, 3, 4, 5] as level (level)}
					<span
						class="size-3 rounded-sm {heatmapClass(
							Math.max(1, Math.ceil((heatmapMaximum * level) / 5)),
							heatmapMaximum
						)}"
					></span>
				{/each}
				<span class="text-meta">{t('app.leave.heatmap_more')}</span>
			</Inline>
		{:else if analyticsQuery.error}
			<p class="py-8 text-center text-sm text-destructive">
				{t('app.leave.seasonality_error')}
			</p>
		{:else}
			<p class="py-8 text-center text-sm text-muted-foreground">
				{t('app.leave.loading_seasonality')}
			</p>
		{/if}
	</Stack>
</Stack>
