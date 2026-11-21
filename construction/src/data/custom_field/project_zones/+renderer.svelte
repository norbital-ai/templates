<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, Button, Icon, Input, type UiContext } from '@norbital-ai/ui';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';

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
		<Inline gap="xs" class="flex-wrap">
			{#each zones as zone, idx (zone.code + idx)}
				<Badge variant="outline">
					{`${zone.code}${zone.name ? ` · ${zone.name}` : ''}${zone.grid_axis ? ` (${zone.grid_axis})` : ''}`}
				</Badge>
			{/each}
		</Inline>
	{/if}
{:else}
	<Stack gap="sm">
		{#each zones as zone, idx (idx)}
			<div class="rounded-md border border-border bg-muted/20 p-3">
				<Grid minimum="compact" gap="sm">
					<Input
						placeholder={t('zones.code')}
						value={zone.code}
						disabled={view.disabled}
						oninput={(e) => updateZone(idx, { code: e.currentTarget.value })}
					/>
					<Input
						placeholder={t('zones.name')}
						value={zone.name}
						disabled={view.disabled}
						oninput={(e) => updateZone(idx, { name: e.currentTarget.value })}
					/>
					<Input
						placeholder={t('zones.grid_axis')}
						value={zone.grid_axis ?? ''}
						disabled={view.disabled}
						oninput={(e) => updateZone(idx, { grid_axis: e.currentTarget.value || null })}
					/>
					<Inline gap="xs" align="center">
						<Input
							type="number"
							step="any"
							placeholder={t('zones.elevation_m')}
							value={zone.elevation_m ?? ''}
							disabled={view.disabled}
							oninput={(e) => {
								const raw = e.currentTarget.value;
								const parsed = raw === '' ? null : Number.parseFloat(raw);
								if (parsed !== null && !Number.isFinite(parsed)) return;
								updateZone(idx, { elevation_m: parsed });
							}}
						/>
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
				</Grid>
			</div>
		{/each}
		<div>
			<Button variant="outline" disabled={view.disabled} onclick={addZone}>
				<Icon name="lucide:plus" class="size-3.5" />
				{t('zones.add')}
			</Button>
		</div>
	</Stack>
{/if}
