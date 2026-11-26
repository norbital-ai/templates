<script lang="ts">
	/**
	 * Project Hub → Sustainability tab: embodied carbon KPIs, by-discipline chart, and item table.
	 */
	import type { Row } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Chart,
		EmptyState,
		Spinner,
		Surface,
		Table,
		Tabs,
		enum_text
	} from '@norbital-ai/ui';
	import { Bound, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { computeProjectCarbon } from '../../../services/commercial/analytics.js';
	import { formatCarbon, toNumber } from '../../../services/commercial/decimal.js';

	let { ctx, record }: { ctx: PageContext; record: Row<'projects'> } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};

	const carbonQuery = $derived(
		ctx.query({
			cost_estimates: {
				where: { project_id: { eq: record.id } },
				fields: ['status', 'bim_assets'],
				limit: 1
			},
			adhoc_costs: {
				where: { project_id: { eq: record.id } },
				fields: ['status', 'qty', 'catalog_item_id'],
				limit: 300
			},
			item_matrix: {
				fields: ['code', 'name', 'discipline', 'unit', 'carbon_factor'],
				limit: 500
			}
		})
	);

	const singleEstimate = $derived(carbonQuery.current?.cost_estimates.rows[0] ?? null);
	const carbon = $derived.by(() => {
		const data = carbonQuery.current;
		if (!data) return null;
		const bimAssets =
			singleEstimate && singleEstimate.status !== 'void' ? (singleEstimate.bim_assets ?? []) : [];
		const matrixById = new Map(data.item_matrix.rows.map((m) => [m.id, m] as const));
		return computeProjectCarbon({
			bim_assets: bimAssets,
			adhoc_costs: data.adhoc_costs.rows.map((c) => ({
				status: c.status,
				qty: c.qty,
				item: matrixById.get(c.catalog_item_id) ?? null
			}))
		});
	});
	const disciplineLabel = (value: string) =>
		enum_text(value, { t: rawT, model: 'item_matrix', field: 'discipline' });
	const carbonByDiscipline = $derived.by(() => {
		const tonnes = new Map<string, number>();
		for (const r of carbon?.rows ?? []) {
			tonnes.set(r.discipline, (tonnes.get(r.discipline) ?? 0) + toNumber(r.carbon) / 1000);
		}
		return [...tonnes].map(([discipline, value]) => ({
			discipline: disciplineLabel(discipline),
			[t('sustainability.series_carbon')]: Math.round(value * 10) / 10
		}));
	});
	const carbonRows = $derived(
		(carbon?.rows ?? []).map((r) => ({
			...r,
			id: r.code,
			source_label:
				r.source === 'adhoc_catalog'
					? t('priced_lines.badge_catalog')
					: t('priced_lines.badge_bim'),
			discipline_label: disciplineLabel(r.discipline),
			unit_label: enum_text(r.unit, { t: rawT, model: 'item_matrix', field: 'unit' })
		}))
	);
</script>

{#snippet sustainabilityOverviewTab()}
	<Scroll name={t('sustainability.overview')} size="fill" inset>
		<Stack gap="md">
			{#if singleEstimate && (singleEstimate.status === 'void' || record.bim_costing_dirty)}
				<Alert.Root><Alert.Title>{t('sustainability.model_out_of_date')}</Alert.Title></Alert.Root>
			{/if}
			{#if carbonQuery.loading && !carbonQuery.current}
				<Inline gap="sm" align="center" aria-busy="true">
					<Spinner />
					<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
				</Inline>
			{:else if carbonQuery.error}
				<Alert.Root variant="destructive"
					><Alert.Title>{carbonQuery.error.message}</Alert.Title></Alert.Root
				>
			{:else if carbon && carbon.rows.length > 0}
				<Surface tone="card" padding="md" radius="control">
					<Stack gap="md" divided>
						<Grid minimum="card" gap="md">
							<Stack gap="xs">
								<span class="text-meta">{t('sustainability.total')}</span>
								<span class="text-sm font-medium tabular-nums text-primary"
									>{formatCarbon(carbon.total)}</span
								>
							</Stack>
							{#if toNumber(carbon.model) !== 0 && toNumber(carbon.other) !== 0}
								<Stack gap="xs">
									<span class="text-meta">{t('sustainability.from_model')}</span>
									<span class="text-label tabular-nums">{formatCarbon(carbon.model)}</span>
								</Stack>
								<Stack gap="xs">
									<span class="text-meta">{t('sustainability.from_other')}</span>
									<span class="text-label tabular-nums">{formatCarbon(carbon.other)}</span>
								</Stack>
							{/if}
							{#if carbon.uncounted > 0}
								<Stack gap="xs">
									<span class="text-meta">{t('sustainability.uncounted')}</span>
									<span class="text-label tabular-nums">{carbon.uncounted}</span>
								</Stack>
							{/if}
						</Grid>
						<Bound height="18rem">
							<Chart
								{ctx}
								of={carbonByDiscipline}
								x="discipline"
								y={t('sustainability.series_carbon')}
								kind="bar"
								title={t('sustainability.chart_title')}
							/>
						</Bound>
					</Stack>
				</Surface>
			{:else}
				<EmptyState
					variant="card"
					title={t('sustainability.overview')}
					hint={t('sustainability.empty')}
				/>
			{/if}
		</Stack>
	</Scroll>
{/snippet}

{#snippet carbonItemsTab()}
	<Table
		{ctx}
		of={carbonRows}
		controlled
		toolbar={{
			title: t('sustainability.by_item'),
			description: t('sustainability.by_item_description')
		}}
		columns={[
			{ field: 'code', label: t('commercial.col_code') },
			{ field: 'name', label: t('commercial.col_item') },
			{ field: 'source_label', label: t('priced_lines.col_source') },
			{ field: 'discipline_label', label: t('models.item_matrix.fields.discipline') },
			{
				field: 'quantity',
				label: t('sustainability.col_quantity'),
				kind: { kind: 'decimal', scale: 3 },
				align: 'end'
			},
			{ field: 'unit_label', label: t('models.item_matrix.fields.unit') },
			{
				field: 'carbon_factor',
				label: t('models.item_matrix.fields.carbon_factor'),
				kind: { kind: 'decimal', scale: 3 },
				align: 'end'
			},
			{
				field: 'carbon',
				label: t('bim_costing.col_carbon'),
				kind: { kind: 'decimal', scale: 2 },
				align: 'end'
			}
		]}
	/>
{/snippet}

<Tabs
	level={2}
	tabs={[
		{
			name: 'overview',
			title: t('sustainability.overview'),
			icon: 'lucide:layout-dashboard',
			body: sustainabilityOverviewTab
		},
		{
			name: 'by_item',
			title: t('sustainability.by_item'),
			icon: 'lucide:list',
			body: carbonItemsTab
		}
	]}
/>
