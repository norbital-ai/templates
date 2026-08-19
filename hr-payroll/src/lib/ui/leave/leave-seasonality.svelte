<script lang="ts">
	import { client } from '../../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Inline, Stack } from '@norbital-ai/ui/layout';

	let { companyId }: { companyId: string } = $props();

	const { t } = useI18n<TenantI18nKeys>();

	// The parent keys this instance on companyId. Wrapping invoke in `$derived` resubscribed
	// the heatmap to every load and left it on the error state.
	// svelte-ignore state_referenced_locally
	const analyticsQuery = client.invoke.approval_analytics({
		subject: 'LEAVE',
		company_id: companyId
	});
	const analytics = $derived(analyticsQuery.current ?? null);
	const heatmapMaximum = $derived(
		Math.max(0, ...(analytics?.seasonal_heatmap ?? []).flatMap((row) => row.months))
	);

	function heatmapClass(count: number): string {
		if (count === 0 || heatmapMaximum === 0) return 'bg-muted/35 text-muted-foreground';
		const level = Math.ceil((count / heatmapMaximum) * 5);
		switch (level) {
			case 1:
				return 'bg-primary/10 text-foreground';
			case 2:
				return 'bg-primary/25 text-foreground';
			case 3:
				return 'bg-primary/45 text-primary-foreground';
			case 4:
				return 'bg-primary/70 text-primary-foreground';
			default:
				return 'bg-primary text-primary-foreground';
		}
	}
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
			<!-- stupidity:allow UI3 -- this is a derived reporting matrix, not a collection. -->
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
										class="block rounded-sm py-2 font-medium tabular-nums {heatmapClass(count)}"
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
							Math.max(1, Math.ceil((heatmapMaximum * level) / 5))
						)}"
					></span>
				{/each}
				<span class="text-meta">{t('app.leave.heatmap_more')}</span>
			</Inline>
		{:else if analyticsQuery.error}
			<Stack gap="sm" class="py-8">
				<p class="text-center text-sm text-destructive">
					{t('app.leave.seasonality_error')}
				</p>
				<Inline justify="center">
					<Button
						size="sm"
						variant="outline"
						disabled={analyticsQuery.loading}
						onclick={() => void analyticsQuery.refresh()}
					>
						{t('app.leave.seasonality_retry')}
					</Button>
				</Inline>
			</Stack>
		{:else}
			<p class="py-8 text-center text-sm text-muted-foreground">
				{t('app.leave.loading_seasonality')}
			</p>
		{/if}
	</Stack>
</Stack>
