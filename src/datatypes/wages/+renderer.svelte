<script lang="ts">
	/**
	 * Regional minimum wages of one settings version (RFC 0001 §4): one row per region, in the
	 * version's currency. A company names its region and a scheme's floor or cap reads the wage
	 * through `minimum_wage(region)`, so a region with no row refuses the run rather than guessing.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import { wagesValueSchema } from './+definition.js';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import type { RendererProps } from './$types.js';

	type Wages = Schema.Schema.Type<typeof wagesValueSchema>;
	type WageRow = { readonly region: string; readonly amount: number };

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const rows = $derived<WageRow[]>(
		Object.entries(((props.value ?? null) as Wages | null)?.by_region ?? {}).map(
			([region, amount]) => ({ region, amount })
		)
	);

	function emit(next: WageRow[]): void {
		if (props.mode !== 'edit') return;
		props.onValueChange({
			by_region: Object.fromEntries(next.map((row) => [row.region.trim(), row.amount]))
		});
	}
</script>

{#if props.mode === 'display'}
	<span>{t('renderer.minimum_wage.region_count', { count: rows.length })}</span>
{:else}
	<Stack gap="sm">
		{#each rows as row, index (index)}
			<Grid gap="sm" minimum="compact">
				<label class="text-sm font-medium">
					<Stack gap="xs">
						{t('component.region')}
						<Input
							value={row.region}
							{disabled}
							placeholder={'MY'}
							oninput={(event) =>
								emit(
									rows.map((entry, position) =>
										position === index ? { ...entry, region: event.currentTarget.value } : entry
									)
								)}
						/>
					</Stack>
				</label>
				<label class="text-sm font-medium">
					<Stack gap="xs">
						{t('renderer.minimum_wage.amount')}
						<Input
							type="number"
							min="0"
							step="0.01"
							value={row.amount}
							{disabled}
							oninput={(event) =>
								emit(
									rows.map((entry, position) =>
										position === index
											? { ...entry, amount: numberFrom(event.currentTarget.value, 0) }
											: entry
									)
								)}
						/>
					</Stack>
				</label>
				<div class="flex items-end">
					<Button
						variant="ghost"
						size="sm"
						{disabled}
						onclick={() => emit(rows.filter((_entry, position) => position !== index))}
					>
						{t('component.remove')}
					</Button>
				</div>
			</Grid>
		{/each}
		{#if rows.length === 0}
			<p class="text-meta">{t('renderer.minimum_wage.empty')}</p>
		{/if}
		<div>
			<Button
				variant="outline"
				size="sm"
				{disabled}
				onclick={() => emit([...rows, { region: '', amount: 0 }])}
			>
				{t('renderer.minimum_wage.add_region')}
			</Button>
		</div>
	</Stack>
{/if}
