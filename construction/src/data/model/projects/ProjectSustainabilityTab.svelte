<script lang="ts">
	/**
	 * Project Hub → Sustainability tab:
	 * 1. `Overview` — BCA Green Mark 2021 WLC KPIs (embodied carbon intensity vs typology baseline,
	 *    site A4–A5 / Scope 1 & 2 emissions, C&D waste diversion), discipline chart, and PDF report previewer.
	 * 2. `Carbon by item` — searchable, filterable `<Table>` with EN 15978 lifecycle stage, EPD source & recycled %.
	 * 3. `Site logs` — periodic site energy, diesel, A4 transport, water/NEWater, and C&D waste ledger.
	 */
	import type { Row } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Badge,
		Button,
		Chart,
		EmptyState,
		Icon,
		Spinner,
		Surface,
		Table,
		Tabs,
		enum_text
	} from '@norbital-ai/ui';
	import { Bound, Cluster, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { computeProjectCarbon } from '../../../services/commercial/analytics.js';
	import { formatCarbon, toNumber } from '../../../services/commercial/decimal.js';
	import {
		BCA_CARBON_BASELINES,
		summarizeSiteSustainability
	} from '../../../services/reports/report-document.js';
	import ReportPreviewDialog from '../../../services/reports/ReportPreviewDialog.svelte';

	let {
		ctx,
		record,
		today,
		onCreateSustainabilityLog
	}: {
		ctx: PageContext;
		record: Row<'projects'>;
		today: string;
		onCreateSustainabilityLog: () => void;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};

	const canCreateLog = $derived(ctx.catalog?.sustainability_logs?.create !== undefined);
	let reportPreviewOpen = $state(false);

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
				fields: [
					'code',
					'name',
					'discipline',
					'unit',
					'carbon_factor',
					'carbon_stage',
					'epd_reference',
					'recycled_content_pct'
				],
				limit: 500
			},
			sustainability_logs: {
				where: { project_id: { eq: record.id } },
				fields: [
					'reporting_period',
					'electricity_kwh',
					'diesel_litres',
					'transport_tco2e',
					'water_m3',
					'newater_m3',
					'waste_generated_t',
					'waste_diverted_t',
					'waste_hazardous_t',
					'notes'
				],
				limit: 500
			}
		})
	);

	const singleEstimate = $derived(carbonQuery.current?.cost_estimates.rows[0] ?? null);
	const matrixByCode = $derived(
		new Map((carbonQuery.current?.item_matrix.rows ?? []).map((m) => [m.code, m] as const))
	);
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
	const siteSummary = $derived(
		summarizeSiteSustainability(carbonQuery.current?.sustainability_logs.rows ?? [])
	);
	const gfaNum = $derived(record.gfa_m2 != null ? toNumber(record.gfa_m2) : 0);
	const carbonIntensity = $derived(
		carbon && gfaNum > 0 ? Math.round((toNumber(carbon.total) / gfaNum) * 10) / 10 : null
	);
	const bcaBaseline = $derived(
		record.building_typology ? (BCA_CARBON_BASELINES[record.building_typology] ?? null) : null
	);
	const baselineDelta = $derived.by(() => {
		if (carbonIntensity === null || bcaBaseline === null || bcaBaseline <= 0) return null;
		const pct = Math.round(((bcaBaseline - carbonIntensity) / bcaBaseline) * 1000) / 10;
		return `${pct >= 0 ? '−' : '+'}${Math.abs(pct)}%`;
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
		(carbon?.rows ?? []).map((r) => {
			const meta = matrixByCode.get(r.code);
			return {
				...r,
				id: r.code,
				source_label:
					r.source === 'adhoc_catalog'
						? t('priced_lines.badge_catalog')
						: t('priced_lines.badge_bim'),
				discipline_label: disciplineLabel(r.discipline),
				unit_label: enum_text(r.unit, { t: rawT, model: 'item_matrix', field: 'unit' }),
				stage_label: enum_text(meta?.carbon_stage ?? 'a1_a3', {
					t: rawT,
					model: 'item_matrix',
					field: 'carbon_stage'
				}),
				epd_reference: meta?.epd_reference ?? t('component.no_value'),
				recycled_pct:
					meta?.recycled_content_pct != null
						? `${meta.recycled_content_pct}%`
						: t('component.no_value')
			};
		})
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
			{:else}
				<Surface tone="card" padding="md" radius="control">
					<Stack gap="md" divided>
						<Cluster align="center" justify="between" gap="sm">
							<Cluster align="center" gap="xs">
								<Icon name="lucide:leaf" class="size-4 text-muted-foreground" />
								<span class="text-label">{t('project.tab_sustainability')}</span>
								{#if record.green_mark_target}
									<Badge variant="outline">
										{enum_text(record.green_mark_target, {
											t: rawT,
											model: 'projects',
											field: 'green_mark_target'
										})}
									</Badge>
								{/if}
								{#if record.gfa_m2}
									<Badge variant="outline" class="font-mono text-tiny">
										{`${record.gfa_m2} m²`}
									</Badge>
								{/if}
							</Cluster>
							<Button variant="brand" onclick={() => (reportPreviewOpen = true)}>
								<Icon name="lucide:file-text" class="size-3.5" />
								{t('reports.preview_export')}
							</Button>
						</Cluster>

						<Grid minimum="card" gap="md">
							<Stack gap="xs">
								<span class="text-meta">{t('sustainability.total')}</span>
								<span class="text-sm font-medium tabular-nums text-primary">
									{carbon ? formatCarbon(carbon.total) : t('component.no_value')}
								</span>
							</Stack>
							<Stack gap="xs">
								<span class="text-meta">{t('sustainability.intensity_label')}</span>
								<span class="text-label tabular-nums">
									{carbonIntensity !== null
										? `${carbonIntensity} kgCO₂e/m²`
										: t('component.no_value')}
								</span>
								{#if bcaBaseline !== null && baselineDelta !== null}
									<span class="text-micro text-muted-foreground">
										{t('sustainability.baseline_vs', {
											baseline: `${bcaBaseline} kgCO₂e/m²`,
											delta: baselineDelta
										})}
									</span>
								{/if}
							</Stack>
							<Stack gap="xs">
								<span class="text-meta">{t('sustainability.site_emissions')}</span>
								<span class="text-label tabular-nums">{`${siteSummary.a4_a5_tco2e} tCO₂e`}</span>
							</Stack>
							<Stack gap="xs">
								<span class="text-meta">{t('sustainability.waste_diverted')}</span>
								<span class="text-label tabular-nums">{`${siteSummary.waste_diversion_pct}%`}</span>
							</Stack>
							{#if carbon && toNumber(carbon.model) !== 0 && toNumber(carbon.other) !== 0}
								<Stack gap="xs">
									<span class="text-meta">{t('sustainability.from_model')}</span>
									<span class="text-label tabular-nums">{formatCarbon(carbon.model)}</span>
								</Stack>
								<Stack gap="xs">
									<span class="text-meta">{t('sustainability.from_other')}</span>
									<span class="text-label tabular-nums">{formatCarbon(carbon.other)}</span>
								</Stack>
							{/if}
							{#if carbon && carbon.uncounted > 0}
								<Stack gap="xs">
									<span class="text-meta">{t('sustainability.uncounted')}</span>
									<span class="text-label tabular-nums">{carbon.uncounted}</span>
								</Stack>
							{/if}
						</Grid>

						{#if carbon && carbon.rows.length > 0}
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
						{:else}
							<EmptyState
								variant="card"
								title={t('sustainability.overview')}
								hint={t('sustainability.empty')}
							/>
						{/if}
					</Stack>
				</Surface>
			{/if}
		</Stack>
	</Scroll>
{/snippet}

{#snippet carbonItemsTab()}
	<Table
		{ctx}
		of={carbonRows}
		key={`project:carbon-items:${record.id}`}
		toolbar={{
			title: t('sustainability.by_item'),
			description: t('sustainability.by_item_description'),
			export: true,
			select: false,
			new: false
		}}
		columns={[
			{ field: 'code', label: t('commercial.col_code'), width: 120 },
			{ field: 'name', label: t('commercial.col_item'), width: 220 },
			{ field: 'source_label', label: t('priced_lines.col_source'), width: 92 },
			{ field: 'discipline_label', label: t('models.item_matrix.fields.discipline'), width: 112 },
			{ field: 'stage_label', label: t('sustainability.col_stage'), width: 88 },
			{
				field: 'quantity',
				label: t('sustainability.col_quantity'),
				kind: { kind: 'decimal', scale: 3 },
				align: 'end',
				width: 100
			},
			{ field: 'unit_label', label: t('models.item_matrix.fields.unit'), width: 64 },
			{
				field: 'carbon_factor',
				label: t('models.item_matrix.fields.carbon_factor'),
				kind: { kind: 'decimal', scale: 3 },
				align: 'end',
				width: 112
			},
			{
				field: 'carbon',
				label: t('bim_costing.col_carbon'),
				kind: { kind: 'decimal', scale: 2 },
				align: 'end',
				width: 116
			},
			{ field: 'epd_reference', label: t('sustainability.col_epd'), width: 180, hide: 'narrow' },
			{
				field: 'recycled_pct',
				label: t('sustainability.col_recycled'),
				align: 'end',
				width: 88,
				hide: 'narrow'
			}
		]}
	/>
{/snippet}

{#snippet siteLogsTab()}
	<Table
		{ctx}
		of="sustainability_logs"
		key={`project:sustainability-logs:${record.id}`}
		where={{ project_id: { eq: record.id } }}
		toolbar={{
			title: t('sustainability.logs_title'),
			description: t('sustainability.logs_description'),
			new: canCreateLog ? onCreateSustainabilityLog : false
		}}
		columns={[
			'reporting_period',
			'electricity_kwh',
			'diesel_litres',
			'transport_tco2e',
			'water_m3',
			'newater_m3',
			'waste_generated_t',
			'waste_diverted_t'
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
		},
		{
			name: 'site_logs',
			title: t('sustainability.logs_title'),
			icon: 'lucide:activity',
			body: siteLogsTab
		}
	]}
/>

{#if reportPreviewOpen}
	<ReportPreviewDialog
		{ctx}
		projectId={record.id}
		kind="sustainability_report"
		{today}
		onClose={() => (reportPreviewOpen = false)}
	/>
{/if}
