<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { leaveEntitlementSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();
	type Layer = Value['layers'][number];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(leaveEntitlementSchema)(props.value, { onExcessProperty: 'error' })
	);
	const layers = $derived<Layer[]>(Result.isSuccess(parsed) ? [...parsed.success.layers] : []);
	const summary = $derived(
		Result.isSuccess(parsed)
			? `${parsed.success.layers.length} company entitlement band${parsed.success.layers.length === 1 ? '' : 's'}`
			: '—'
	);

	function emit(next: Layer[]): void {
		if (props.mode === 'edit') props.onValueChange({ layers: next });
	}

	function newLayer(): Layer {
		return { level: 'ORGANISATION', band_from: 0, days: 0 };
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="sm" class="rounded-md border border-border bg-muted/20 p-3">
		{#if layers.length === 0}
			<p class="text-sm text-muted-foreground">{t('renderer.leave_entitlement.empty')}</p>
		{/if}
		{#each layers as layer, index (index)}
			<Stack gap="xs" class="rounded-md border border-border bg-card p-3">
				<Cluster justify="between" align="center" gap="sm">
					<span class="text-sm font-medium">Company policy</span>
					<Button
						variant="ghost"
						size="icon"
						{disabled}
						aria-label={t('renderer.leave_entitlement.remove_layer')}
						onclick={() => emit(layers.filter((_, candidate) => candidate !== index))}
					>
						<IconWrapper name="lucide:x" class="size-3.5" />
					</Button>
				</Cluster>
				<Grid gap="sm" minimum="compact">
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{t('renderer.leave_entitlement.band_from')}
							<Input
								type="number"
								min="0"
								step="1"
								value={layer.band_from}
								{disabled}
								oninput={(event) => {
									const next = [...layers];
									next[index] = {
										...layer,
										band_from: Math.max(0, Math.trunc(numberFrom(event.currentTarget.value, 0)))
									};
									emit(next);
								}}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							Days granted
							<Input
								type="number"
								min="0"
								step="0.5"
								value={layer.days}
								{disabled}
								oninput={(event) => {
									const next = [...layers];
									next[index] = {
										...layer,
										days: numberFrom(event.currentTarget.value, 0)
									};
									emit(next);
								}}
							/>
						</Stack>
					</label>
				</Grid>
			</Stack>
		{/each}
		<Cluster gap="xs">
			<Button variant="outline" size="sm" {disabled} onclick={() => emit([...layers, newLayer()])}>
				{t('renderer.leave_entitlement.add_organisation')}
			</Button>
		</Cluster>
	</Stack>
{/if}
