<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, Button, Icon, Input, Label, TimeInput, type UiContext } from '@norbital-ai/ui';
	import { Cluster, Grid, Inline, Scroll, Stack, Surface } from '@norbital-ai/ui/layout';
	import { parsePlainTime } from '../../../lib/geo.js';

	type WaypointRow = NonNullable<CustomFieldView<'route_waypoints'>['value']>[number];

	let {
		ctx,
		view
	}: {
		ctx: UiContext & Partial<Pick<PageContext, 't'>>;
		view: CustomFieldView<'route_waypoints'>;
	} = $props();

	const uid = $props.id();
	const t = (key: Parameters<PageContext['t']>[0], values?: Record<string, string | number>) =>
		ctx.t ? ctx.t(key, values) : key;
	const stops = $derived<readonly WaypointRow[]>(view.value ?? []);
	const compact = $derived(view.mode === 'show' && view.dense === true);
	const arrivedCount = $derived(stops.filter((s) => s.status === 'arrived').length);

	const STATUSES = ['pending', 'arrived', 'skipped'] as const;

	function badgeVariant(status: WaypointRow['status']): 'default' | 'outline' {
		if (status === 'arrived') return 'default';
		return 'outline';
	}

	function statusLabel(status: WaypointRow['status']): string {
		if (status === 'arrived') return t('waypoints.status.arrived');
		if (status === 'skipped') return t('waypoints.status.skipped');
		return t('waypoints.status.pending');
	}

	function updateStop(index: number, patch: Partial<WaypointRow>): void {
		if (view.mode !== 'edit') return;
		const next = stops.map((stop, i) => (i === index ? { ...stop, ...patch } : stop));
		view.on_change(next);
	}

	function addStop(): void {
		if (view.mode !== 'edit') return;
		view.on_change([
			...stops,
			{ name: '', lat: 1.3521, lng: 103.8198, status: 'pending' as const }
		]);
	}

	function removeStop(index: number): void {
		if (view.mode !== 'edit') return;
		view.on_change(stops.filter((_, i) => i !== index));
	}
</script>

{#if view.mode === 'edit'}
	<Stack gap="sm">
		{#if stops.length === 0}
			<p class="text-meta">{t('waypoints.empty')}</p>
		{:else}
			{#each stops as stop, idx (idx)}
				<Surface tone="subtle" padding="sm" radius="control">
					<Stack gap="sm">
						<Inline justify="between" align="center" gap="sm">
							<span class="text-overline">{t('waypoints.stop_index', { index: idx + 1 })}</span>
							<Button variant="ghost" disabled={view.disabled} onclick={() => removeStop(idx)}>
								<Icon name="lucide:trash-2" class="size-3.5" />
								{t('waypoints.remove')}
							</Button>
						</Inline>
						<Grid minimum="card" gap="sm">
							<Stack gap="xs">
								<Label for={`${uid}-name-${idx}`}>{t('waypoints.col_stop')}</Label>
								<Input
									id={`${uid}-name-${idx}`}
									value={stop.name}
									disabled={view.disabled}
									oninput={(e) => updateStop(idx, { name: e.currentTarget.value })}
								/>
							</Stack>
							<Stack gap="xs">
								<Label for={`${uid}-lat-${idx}`}>{t('waypoints.col_lat')}</Label>
								<Input
									id={`${uid}-lat-${idx}`}
									type="number"
									min="-90"
									max="90"
									step="0.0001"
									value={String(stop.lat)}
									disabled={view.disabled}
									oninput={(e) => {
										const raw = e.currentTarget.value.trim();
										if (raw === '') return;
										const n = Number(raw);
										if (Number.isFinite(n) && n >= -90 && n <= 90) updateStop(idx, { lat: n });
									}}
								/>
							</Stack>
							<Stack gap="xs">
								<Label for={`${uid}-lng-${idx}`}>{t('waypoints.col_lng')}</Label>
								<Input
									id={`${uid}-lng-${idx}`}
									type="number"
									min="-180"
									max="180"
									step="0.0001"
									value={String(stop.lng)}
									disabled={view.disabled}
									oninput={(e) => {
										const raw = e.currentTarget.value.trim();
										if (raw === '') return;
										const n = Number(raw);
										if (Number.isFinite(n) && n >= -180 && n <= 180) updateStop(idx, { lng: n });
									}}
								/>
							</Stack>
							<Stack gap="xs">
								<Label for={`${uid}-eta-${idx}`}>{t('waypoints.col_eta')}</Label>
								<TimeInput
									{ctx}
									of="time"
									id={`${uid}-eta-${idx}`}
									value={stop.eta ?? null}
									disabled={view.disabled}
									on_change={(next: string | null) =>
										updateStop(idx, { eta: parsePlainTime(next) })}
								/>
							</Stack>
							<Stack gap="xs">
								<Label for={`${uid}-arrived-${idx}`}>{t('waypoints.col_arrived_at')}</Label>
								<TimeInput
									{ctx}
									of="time"
									id={`${uid}-arrived-${idx}`}
									value={stop.arrived_at ?? null}
									disabled={view.disabled}
									on_change={(next: string | null) =>
										updateStop(idx, { arrived_at: parsePlainTime(next) })}
								/>
							</Stack>
							<Stack gap="xs">
								<span id={`${uid}-status-${idx}`} class="text-label">
									{t('waypoints.col_status')}
								</span>
								<div role="group" aria-labelledby={`${uid}-status-${idx}`}>
									<Cluster gap="xs">
										{#each STATUSES as s (s)}
											<Button
												variant={(stop.status ?? 'pending') === s ? 'default' : 'outline'}
												aria-pressed={(stop.status ?? 'pending') === s}
												disabled={view.disabled}
												onclick={() => updateStop(idx, { status: s })}
											>
												{statusLabel(s)}
											</Button>
										{/each}
									</Cluster>
								</div>
							</Stack>
						</Grid>
					</Stack>
				</Surface>
			{/each}
		{/if}
		<Inline>
			<Button variant="outline" disabled={view.disabled} onclick={addStop}>
				<Icon name="lucide:plus" class="size-3.5" />
				{t('waypoints.add')}
			</Button>
		</Inline>
	</Stack>
{:else if stops.length === 0}
	<span class="text-meta">{t('waypoints.empty')}</span>
{:else if compact}
	<span class="text-label">
		{t('waypoints.compact_summary', { arrived: arrivedCount, total: stops.length })}
	</span>
{:else}
	<Surface tone="card" padding="none" radius="control">
		<Scroll name={t('models.routes.fields.waypoints')} axis="x">
			<table class="w-full text-left text-sm">
				<thead
					class="border-b border-border-subtle bg-surface-subtle text-micro text-muted-foreground"
				>
					<tr>
						<th class="px-3 py-2">#</th>
						<th class="px-3 py-2">{t('waypoints.col_stop')}</th>
						<th class="px-3 py-2">{t('waypoints.col_coords')}</th>
						<th class="px-3 py-2">{t('waypoints.col_eta')}</th>
						<th class="px-3 py-2">{t('waypoints.col_arrived_at')}</th>
						<th class="px-3 py-2">{t('waypoints.col_status')}</th>
					</tr>
				</thead>
				<tbody>
					{#each stops as stop, idx (idx)}
						<tr class="border-t border-border-subtle">
							<td class="px-3 py-2 text-meta">{idx + 1}</td>
							<td class="px-3 py-2 text-label">{stop.name}</td>
							<td class="px-3 py-2 font-mono text-xs text-muted-foreground">
								{stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}
							</td>
							<td class="px-3 py-2 text-meta">{stop.eta ?? '—'}</td>
							<td class="px-3 py-2 text-meta">{stop.arrived_at ?? '—'}</td>
							<td class="px-3 py-2">
								<Badge variant={badgeVariant(stop.status)}>
									{statusLabel(stop.status)}
								</Badge>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Scroll>
	</Surface>
{/if}
