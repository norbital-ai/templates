<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	/**
	 * The company's own entitlement layers. The statutory floor is the profile's — versioned and
	 * sealed with the law revision that states it — so this editor mounts the company arms only
	 * (ORGANISATION, EMPLOYEE); what belongs only to this shape is the service band and the number
	 * of days. There is no authority and no effective range: the profile seal is the version.
	 */
	import LayerLevelPicker, {
		type PolicyLayerLevel
	} from '../../lib/ui/policy-layers/layer-level-picker.svelte';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { leaveEntitlementSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();

	type Layer = Value['layers'][number];

	const LAYER_LEVELS = ['ORGANISATION', 'EMPLOYEE'] as const;

	type LeaveEntitlementRendererProps = RendererProps & {
		/** The leave type being edited, which is what scopes the people an EMPLOYEE layer may name. */
		readonly row?: Record<string, unknown>;
	};

	let props: LeaveEntitlementRendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const companyId = $derived(
		typeof props.row?.company_id === 'string' ? props.row.company_id : null
	);
	const parsed = $derived(
		Schema.decodeUnknownResult(leaveEntitlementSchema)(props.value, { onExcessProperty: 'error' })
	);
	const layers = $derived<Layer[]>(Result.isSuccess(parsed) ? [...parsed.success.layers] : []);
	/*
	 * The count stays a static sentence. Naming the people behind the EMPLOYEE layers would mount
	 * one lookup per row of the leave-types table — the N+1 `controller-surfaces.md` §5 forbids —
	 * and they are named in the editor, where a single scoped query answers all of them at once.
	 */
	const summary = $derived(
		Result.isSuccess(parsed)
			? `${parsed.success.layers.length} organisation / employee entitlement layer${parsed.success.layers.length === 1 ? '' : 's'}`
			: '—'
	);

	function emit(next: Layer[]): void {
		if (props.mode === 'edit') props.onValueChange({ layers: next });
	}

	function newLayer(level: PolicyLayerLevel): Layer {
		switch (level) {
			case 'ORGANISATION':
				return { level: 'ORGANISATION', band_from: 0, days: 0 };
			case 'EMPLOYEE':
				return { level: 'EMPLOYEE', employment_id: '', band_from: 0, days: 0 };
		}
	}

	/**
	 * Move a layer to another arm, carrying everything the arms share.
	 *
	 * Written out rather than spread so the EMPLOYEE arm's extra field is added and dropped
	 * explicitly: a spread would leave it behind on a row that does not declare it, which
	 * `strictObject` rejects only at save time, long after the operator has moved on.
	 */
	function atLevel(layer: Layer, level: PolicyLayerLevel): Layer {
		const { band_from, days } = layer;
		switch (level) {
			case 'ORGANISATION':
				return { level: 'ORGANISATION', band_from, days };
			case 'EMPLOYEE':
				return {
					level: 'EMPLOYEE',
					employment_id: layer.level === 'EMPLOYEE' ? layer.employment_id : '',
					band_from,
					days
				};
		}
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
					<LayerLevelPicker
						levels={LAYER_LEVELS}
						level={layer.level}
						employmentId={layer.level === 'EMPLOYEE' ? layer.employment_id : null}
						{companyId}
						{disabled}
						onLevelChange={(level) => {
							const next = [...layers];
							next[index] = atLevel(layer, level);
							emit(next);
						}}
						onEmploymentChange={(employment) => {
							if (layer.level !== 'EMPLOYEE') return;
							const next = [...layers];
							next[index] = { ...layer, employment_id: employment };
							emit(next);
						}}
					/>
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
									next[index] = { ...layer, days: numberFrom(event.currentTarget.value, 0) };
									emit(next);
								}}
							/>
						</Stack>
					</label>
				</Grid>
			</Stack>
		{/each}
		<Cluster gap="xs">
			<Button
				variant="outline"
				size="sm"
				{disabled}
				onclick={() => emit([...layers, newLayer('ORGANISATION')])}
			>
				{t('renderer.leave_entitlement.add_organisation')}
			</Button>
			<Button
				variant="outline"
				size="sm"
				{disabled}
				onclick={() => emit([...layers, newLayer('EMPLOYEE')])}
			>
				{t('renderer.leave_entitlement.add_employee')}
			</Button>
		</Cluster>
	</Stack>
{/if}
