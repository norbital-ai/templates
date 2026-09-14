<script lang="ts">
	/**
	 * The bands of one catalogue row (RFC 0001 §4, §9).
	 *
	 * A catalogue prices its entries through ordered bands over the entry context: the first band
	 * whose `when` holds governs, its `amount` is the money the line settles, and its optional
	 * `limit` is an entitlement ceiling. Each band also states the statutory schemes it opts into.
	 * A catalogue with no bands settles the entry's own amount unchanged.
	 *
	 * Every expression is compiled live against the entry context as it is typed; the Fields panel
	 * beside each one lists the members that context carries, straight from `EXPRESSION_CONTEXTS`.
	 * The datatype's own write-time filter still owns the refusal.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import type { CatalogueBand } from './+definition.js';
	import type { Entitlement } from '../entitlement/+definition.js';
	import StatutoryOptIns from '../../lib/ui/statutory-opt-ins.svelte';
	import ExpressionFields from '../../lib/ui/expression-fields.svelte';
	import { numberOrExpression } from '../../lib/ui/renderer-input.js';
	import type { RendererProps } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const rows = $derived<CatalogueBand[]>(props.value ?? []);

	const periodOptions = $derived(
		(['CALENDAR_YEAR', 'MONTH', 'LIFETIME', 'PER_EVENT'] as const).map((period) => ({
			value: period,
			label: t(`renderer.catalogue_band.period.${period}`)
		}))
	);
	const exceedOptions = $derived([
		{ value: 'BLOCK' as const, label: t('renderer.catalogue_band.exceed_block') },
		{ value: 'ALLOW' as const, label: t('renderer.catalogue_band.exceed_allow') }
	]);

	function defaultLimit(): Entitlement {
		return { period: 'CALENDAR_YEAR', on_exceed: 'BLOCK', amount: 0 };
	}
	function emit(next: CatalogueBand[]): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
	function edit(index: number, change: Partial<CatalogueBand>): void {
		emit(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
	}
	function setLimit(index: number, limit: Entitlement | null): void {
		edit(index, { limit });
	}
</script>

{#if props.mode === 'display'}
	<span>{t('renderer.catalogue_band.summary', { count: rows.length })}</span>
{:else}
	<Stack gap="lg">
		<p class="text-meta">{t('renderer.catalogue_band.identity')}</p>
		{#each rows as row, index (index)}
			<Stack gap="sm" class="rounded-md border border-border p-3">
				<Grid gap="md" minimum="panel">
					<Stack gap="xs">
						<span class="text-sm font-medium">{t('renderer.catalogue_band.when')}</span>
						<Input
							value={row.when}
							{disabled}
							placeholder={'entry.days > 0.0'}
							oninput={(event) => edit(index, { when: event.currentTarget.value })}
						/>
						<ExpressionFields site="entry" expression={row.when} type="boolean" />
					</Stack>
					<Stack gap="xs">
						<span class="text-sm font-medium">{t('renderer.catalogue_band.amount')}</span>
						<Input
							value={String(row.amount ?? '')}
							{disabled}
							placeholder={t('renderer.catalogue_band.amount_placeholder')}
							oninput={(event) =>
								edit(index, { amount: numberOrExpression(event.currentTarget.value) })}
						/>
						<ExpressionFields site="entry" expression={String(row.amount ?? '')} type="number" />
					</Stack>
				</Grid>
				<Stack gap="sm" class="rounded-md bg-muted/30 p-2">
					<Cluster justify="between" align="center" gap="sm">
						<span class="text-sm font-medium">{t('renderer.catalogue_band.limit')}</span>
						<Button
							variant="ghost"
							size="sm"
							{disabled}
							onclick={() => setLimit(index, row.limit == null ? defaultLimit() : null)}
						>
							{row.limit == null
								? t('renderer.catalogue_band.add_limit')
								: t('renderer.catalogue_band.remove_limit')}
						</Button>
					</Cluster>
					{#if row.limit != null}
						<Grid gap="md" minimum="panel">
							<label class="text-sm font-medium"
								><Stack gap="xs">
									{t('renderer.catalogue_band.limit_period')}
									<Combobox
										options={periodOptions}
										value={row.limit.period}
										{disabled}
										searchable={false}
										onValueChange={(period) => {
											if (period && row.limit != null) setLimit(index, { ...row.limit, period });
										}}
									/>
								</Stack></label
							>
							<label class="text-sm font-medium"
								><Stack gap="xs">
									{t('renderer.catalogue_band.limit_past_ceiling')}
									<Combobox
										options={exceedOptions}
										value={row.limit.on_exceed}
										{disabled}
										searchable={false}
										onValueChange={(on_exceed) => {
											if (on_exceed && row.limit != null)
												setLimit(index, { ...row.limit, on_exceed });
										}}
									/>
								</Stack></label
							>
							<Stack gap="xs">
								<span class="text-sm font-medium">{t('renderer.catalogue_band.limit_amount')}</span>
								<Input
									value={String(row.limit.amount ?? '')}
									{disabled}
									placeholder={t('renderer.catalogue_band.amount_placeholder')}
									oninput={(event) => {
										if (row.limit != null)
											setLimit(index, {
												...row.limit,
												amount: numberOrExpression(event.currentTarget.value)
											});
									}}
								/>
								<ExpressionFields
									site="entry"
									expression={String(row.limit.amount ?? '')}
									type="number"
								/>
							</Stack>
						</Grid>
					{/if}
				</Stack>

				<Stack gap="xs">
					<span class="text-sm font-medium">{t('component.statutory_opt_ins')}</span>
					<StatutoryOptIns
						value={row.statutory_opt_ins}
						{disabled}
						onValueChange={(statutory_opt_ins) => edit(index, { statutory_opt_ins })}
					/>
				</Stack>

				<div>
					<Button
						variant="ghost"
						size="sm"
						{disabled}
						onclick={() => emit(rows.filter((_row, position) => position !== index))}
					>
						{t('renderer.catalogue_band.remove_band')}
					</Button>
				</div>
			</Stack>
		{/each}
		{#if rows.length === 0}
			<p class="text-meta">{t('renderer.catalogue_band.empty')}</p>
		{/if}
		<div>
			<Button
				variant="outline"
				size="sm"
				{disabled}
				onclick={() => emit([...rows, { when: '', amount: 0, limit: null, statutory_opt_ins: [] }])}
			>
				{t('renderer.catalogue_band.add_band')}
			</Button>
		</div>
	</Stack>
{/if}
