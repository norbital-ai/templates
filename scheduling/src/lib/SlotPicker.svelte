<script lang="ts">
	/**
	 * Interactive appointment slot picker: horizontal day strip showing open slot counts, followed by
	 * selectable start times grouped into morning, afternoon, and evening with end-time preview.
	 */
	import { DateTime } from 'effect';
	import { create_radio_group } from '@norbital-ai/ui/behaviors';
	import { Bound, Grid, Scroll, Stack, Surface } from '@norbital-ai/ui/layout';
	import { formatCalendarDate, formatInstant } from './format.js';

	type Day = {
		readonly day: string;
		readonly starts: readonly string[];
	};
	type SlotCopy =
		| 'app.portal.morning'
		| 'app.portal.afternoon'
		| 'app.portal.evening'
		| 'app.portal.your_appointment'
		| 'app.portal.starts_count';

	let {
		days,
		minutes,
		value,
		locale,
		zone,
		onPick,
		t
	}: {
		days: readonly Day[];
		minutes: number;
		value: string | null;
		locale: string;
		zone: string;
		onPick: (start: string | null) => void;
		t: (key: SlotCopy, values?: Record<string, string | number>) => string;
	} = $props();

	const starts = $derived(new Map(days.map((d) => [d.day, d.starts])));
	const firstDay = $derived(days[0]?.day ?? '');
	let picked = $state<string | null>(null);
	const day = $derived(
		(picked !== null && starts.has(picked) ? picked : null) ??
			days.find((d) => d.starts.length > 0)?.day ??
			firstDay
	);

	const month = $derived.by(() => {
		const first = days.at(0);
		const last = days.at(-1);
		if (first === undefined || last === undefined) return '';
		const a = formatCalendarDate(first.day, { month: 'long', year: 'numeric' }, locale);
		const b = formatCalendarDate(last.day, { month: 'long', year: 'numeric' }, locale);
		return a === b ? a : `${formatCalendarDate(first.day, { month: 'long' }, locale)} – ${b}`;
	});

	const PARTS: readonly { readonly from: number; readonly key: SlotCopy }[] = [
		{ from: 0, key: 'app.portal.morning' },
		{ from: 12, key: 'app.portal.afternoon' },
		{ from: 17, key: 'app.portal.evening' }
	];

	const parts = $derived(
		PARTS.map((p, i) => ({
			key: p.key,
			starts: (starts.get(day) ?? []).filter((s) => {
				const h = DateTime.toParts(DateTime.makeZonedUnsafe(s, { timeZone: zone })).hour;
				return h >= p.from && h < (PARTS[i + 1]?.from ?? 24);
			})
		})).filter((p) => p.starts.length > 0)
	);

	const endIso = (start: string): string =>
		DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(start), { minutes }));

	const timeLabel = (iso: string): string =>
		formatInstant(iso, zone, { hour: 'numeric', minute: '2-digit' }, locale);

	const span = $derived(
		value === null
			? null
			: `${formatInstant(value, zone, { weekday: 'long', day: 'numeric', month: 'long' }, locale)} · ${timeLabel(value)} – ${timeLabel(endIso(value))}`
	);

	const dayGroup = create_radio_group({
		items: () => days.map((d) => d.day),
		value: () => day,
		disabled: (d) => (starts.get(d)?.length ?? 0) === 0,
		on_change: (next) => {
			picked = next;
			const dayStarts = starts.get(next) ?? [];
			if (value !== null && !dayStarts.includes(value)) onPick(null);
		},
		orientation: 'horizontal',
		control: { id: 'slot-picker:day', label: 'Appointment day' }
	});

	const slotGroup = create_radio_group({
		items: () => starts.get(day) ?? [],
		value: () => value ?? undefined,
		on_change: (next) => onPick(next),
		orientation: 'horizontal',
		control: { id: 'slot-picker:time', label: 'Appointment time' }
	});
</script>

<Stack gap="lg">
	<Stack gap="sm">
		<p class="text-label">{month}</p>
		<Scroll
			name="slot-days"
			axis="x"
			layout="inline"
			gap="xs"
			{...dayGroup.root_attrs()}
			aria-label={month}
		>
			{#each days as d (d.day)}
				{@const open = d.starts.length}
				{@const selected = d.day === day}
				<span class="shrink-0">
					<Bound
						as="button"
						{...dayGroup.item_attrs(d.day)}
						{@attach dayGroup.item(d.day)}
						pad="sm"
						disabled={open === 0}
						aria-label={formatCalendarDate(
							d.day,
							{ weekday: 'long', day: 'numeric', month: 'long' },
							locale
						)}
						class={[
							'rounded-control border text-center transition-colors disabled:cursor-not-allowed disabled:border-dashed disabled:bg-transparent disabled:text-content-tertiary',
							selected
								? 'border-brand bg-brand text-brand-foreground'
								: 'border-border-control bg-surface-card text-content-primary hover:bg-surface-hover'
						]}
					>
						<Stack as="span" gap="none" align="center">
							<span class="text-xs">
								{formatCalendarDate(d.day, { weekday: 'short' }, locale)}
							</span>
							<span class="text-base font-medium tabular-nums">
								{formatCalendarDate(d.day, { day: 'numeric' }, locale)}
							</span>
							<span class="text-xs tabular-nums">
								{open === 0 ? '—' : t('app.portal.starts_count', { count: open })}
							</span>
						</Stack>
					</Bound>
				</span>
			{/each}
		</Scroll>
	</Stack>

	{#if day !== ''}
		<Stack
			gap="md"
			{...slotGroup.root_attrs()}
			aria-label={formatCalendarDate(
				day,
				{ weekday: 'long', day: 'numeric', month: 'long' },
				locale
			)}
		>
			<p class="text-label">
				{formatCalendarDate(day, { weekday: 'long', day: 'numeric', month: 'long' }, locale)}
			</p>
			{#each parts as part (part.key)}
				<Stack gap="sm">
					<p class="text-overline">
						{t(part.key)} · {part.starts.length}
					</p>
					<Grid tracks="repeat(auto-fill, minmax(6.5rem, 1fr))" gap="sm">
						{#each part.starts as s (s)}
							{@const active = value === s}
							<Bound
								as="button"
								{...slotGroup.item_attrs(s)}
								{@attach slotGroup.item(s)}
								pad="xs"
								class={[
									'rounded-control border text-center tabular-nums transition-colors',
									active
										? 'border-brand bg-brand text-brand-foreground'
										: 'border-border-control bg-surface-card text-content-primary hover:border-brand hover:bg-surface-hover'
								]}
							>
								<Stack as="span" gap="none" align="center">
									<span class="text-sm font-medium">{timeLabel(s)}</span>
									<span
										class={active
											? 'text-xs text-brand-foreground'
											: 'text-xs text-muted-foreground'}
									>
										– {timeLabel(endIso(s))}
									</span>
								</Stack>
							</Bound>
						{/each}
					</Grid>
				</Stack>
			{/each}
		</Stack>
	{/if}

	{#if span !== null}
		<Surface tone="subtle" padding="sm" radius="control" role="status">
			<Stack gap="xs">
				<p class="text-caption">{t('app.portal.your_appointment')}</p>
				<p class="text-label">{span}</p>
			</Stack>
		</Surface>
	{/if}
</Stack>
