<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import {
		Badge,
		Field,
		RecordForm,
		type RecordView,
		Section,
		Show,
		Surface
	} from '@norbital-ai/ui';
	import { formatCarbon, toNumber } from '../../../../lib/commercial.js';

	let { view, ctx }: { view: RecordView<'cost_estimates'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const money = { kind: 'money', currency: 'currency' } as const;

	const hideProject = $derived(
		record !== null || (view.mode === 'create' && view.values.project_id != null)
	);
</script>

<RecordForm
	{ctx}
	{view}
	subtitle={['status', 'currency']}
	{...record ? { runs: [{ ctx, automation: 'analyze_bim_file', limit: 5 }] } : {}}
>
	{#if record && (record.bim_asset_count > 0 || toNumber(record.bim_subtotal) !== 0 || toNumber(record.total_estimate) !== 0)}
		<Surface tone="card" padding="md" radius="control">
			<Grid minimum="card" gap="md">
				{#if record.bim_asset_count > 0}
					<Stack gap="xs">
						<span class="text-meta">{t('bim_costing.coverage')}</span>
						<Inline gap="xs" align="center">
							<span class="text-label tabular-nums">
								{`${record.classified_asset_count} / ${record.bim_asset_count}`}
							</span>
							{#if record.unmatched_asset_count > 0}
								<Badge variant="warning">
									{t('bim_costing.unmatched_badge', { count: record.unmatched_asset_count })}
								</Badge>
							{/if}
						</Inline>
					</Stack>
				{/if}
				{#if toNumber(record.bim_subtotal) !== 0}
					<Stack gap="xs">
						<span class="text-meta">{t('bim_costing.bim_subtotal')}</span>
						<span class="text-label tabular-nums">
							<Show {ctx} kind={money} value={record.bim_subtotal} row={record} />
						</span>
					</Stack>
				{/if}
				{#if toNumber(record.contingency_amount) !== 0}
					<Stack gap="xs">
						<span class="text-meta">{t('bim_costing.contingency')}</span>
						<span class="text-label tabular-nums">
							<Show {ctx} kind={money} value={record.contingency_amount} row={record} />
						</span>
					</Stack>
				{/if}
				{#if toNumber(record.total_estimate) !== 0}
					<Stack gap="xs">
						<span class="text-meta">{t('bim_costing.total_estimate')}</span>
						<span class="text-sm font-medium tabular-nums text-primary">
							<Show {ctx} kind={money} value={record.total_estimate} row={record} />
						</span>
					</Stack>
				{/if}
				{#if toNumber(record.carbon_total) !== 0}
					<Stack gap="xs">
						<span class="text-meta">{t('bim_costing.carbon_total')}</span>
						<span class="text-label tabular-nums">{formatCarbon(record.carbon_total)}</span>
					</Stack>
				{/if}
			</Grid>
		</Surface>
	{/if}

	<Section icon="lucide:calculator" first name="estimate" title={t('section.cost_estimate')}>
		<Grid minimum="card">
			<Field {ctx} name="title" />
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="currency" />
			<Field {ctx} name="contingency_pct" />
			{#if record}
				<Field {ctx} name="contingency_amount" readonly />
				{#if record.analyzed_at != null}
					<Field {ctx} name="analyzed_at" readonly />
				{/if}
			{/if}
		</Grid>
	</Section>

	<Section icon="lucide:box" name="bim_takeoff" title={t('section.bim_asset_takeoff')}>
		<Field {ctx} name="bim_assets" />
	</Section>

	<Section icon="lucide:file-text" name="notes" title={t('section.notes')} default_open={false}>
		<Field {ctx} name="notes" />
	</Section>
</RecordForm>
