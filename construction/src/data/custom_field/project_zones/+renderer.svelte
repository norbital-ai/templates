<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Button,
		FieldControl,
		Icon,
		Input,
		Surface,
		type UiContext
	} from '@norbital-ai/ui';
	import { Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';

	type Zone = {
		readonly code: string;
		readonly name: string;
		readonly elevation_m?: number | null;
		readonly grid_axis?: string | null;
	};

	let {
		view,
		ctx
	}: {
		view: CustomFieldView<'project_zones'>;
		ctx: UiContext & Partial<Pick<PageContext, 't'>>;
	} = $props();

	const uid = $props.id();
	const t = (key: Parameters<PageContext['t']>[0]) => ctx.t?.(key) ?? key;
	const zones = $derived<readonly Zone[]>(view.value ?? []);

	function emit(next: readonly Zone[]): void {
		if (view.mode !== 'edit') return;
		view.on_change(next.length === 0 ? null : [...next]);
	}

	function addZone(): void {
		emit([...zones, { code: '', name: '', elevation_m: null, grid_axis: null }]);
	}

	function removeZone(index: number): void {
		emit(zones.filter((_, i) => i !== index));
	}

	function updateZone(index: number, patch: Partial<Zone>): void {
		emit(zones.map((z, i) => (i === index ? { ...z, ...patch } : z)));
	}
</script>

{#if view.mode === 'show'}
	{#if zones.length === 0}
		<span class="text-sm text-muted-foreground">{t('component.no_value')}</span>
	{:else}
		<Cluster gap="xs">
			{#each zones as zone, idx (zone.code + idx)}
				<Badge variant="outline">
					{`${zone.code}${zone.name ? ` · ${zone.name}` : ''}${zone.grid_axis ? ` (${zone.grid_axis})` : ''}`}
				</Badge>
			{/each}
		</Cluster>
	{/if}
{:else}
	<Stack gap="sm">
		{#each zones as zone, idx (idx)}
			<Surface tone="subtle" padding="sm" radius="control">
				<Stack gap="sm">
					<Grid minimum="compact" gap="sm">
						<FieldControl id={`${uid}-zn-code-${idx}`} label={t('zones.code')}>
							<Input
								id={`${uid}-zn-code-${idx}`}
								value={zone.code}
								disabled={view.disabled}
								oninput={(e) => updateZone(idx, { code: e.currentTarget.value })}
							/>
						</FieldControl>
						<FieldControl id={`${uid}-zn-name-${idx}`} label={t('zones.name')}>
							<Input
								id={`${uid}-zn-name-${idx}`}
								value={zone.name}
								disabled={view.disabled}
								oninput={(e) => updateZone(idx, { name: e.currentTarget.value })}
							/>
						</FieldControl>
						<FieldControl id={`${uid}-zn-grid-${idx}`} label={t('zones.grid_axis')}>
							<Input
								id={`${uid}-zn-grid-${idx}`}
								value={zone.grid_axis ?? ''}
								disabled={view.disabled}
								oninput={(e) => updateZone(idx, { grid_axis: e.currentTarget.value || null })}
							/>
						</FieldControl>
						<FieldControl id={`${uid}-zn-elev-${idx}`} label={t('zones.elevation_m')}>
							<Input
								id={`${uid}-zn-elev-${idx}`}
								type="number"
								step="any"
								value={zone.elevation_m ?? ''}
								disabled={view.disabled}
								oninput={(e) => {
									const raw = e.currentTarget.value;
									const parsed = raw === '' ? null : Number.parseFloat(raw);
									if (parsed !== null && !Number.isFinite(parsed)) return;
									updateZone(idx, { elevation_m: parsed });
								}}
							/>
						</FieldControl>
					</Grid>
					<Inline justify="end">
						<Button
							size="icon"
							variant="ghost"
							disabled={view.disabled}
							hint={t('zones.remove')}
							onclick={() => removeZone(idx)}
						>
							<Icon name="lucide:trash-2" class="size-4" />
						</Button>
					</Inline>
				</Stack>
			</Surface>
		{/each}
		<div>
			<Button variant="outline" disabled={view.disabled} onclick={addZone}>
				<Icon name="lucide:plus" class="size-3.5" />
				{t('zones.add')}
			</Button>
		</div>
	</Stack>
{/if}
