<script lang="ts">
	/**
	 * Picking a visit's start: the next two weeks as a calendar (a day nobody can take is greyed out), then the chosen day
	 * as a timeline of hours with its open starts, and the visit's span once one is picked.
	 */
	import { Grid, Stack } from '@norbital-ai/ui/layout';

	type Day = { readonly day: string; readonly starts: readonly string[] };
	let {
		days,
		minutes,
		value,
		locale,
		onPick,
		t
	}: {
		days: readonly Day[];
		/** How long the visit takes: its end is shown beside the start. */
		minutes: number;
		value: string | null;
		locale: string;
		onPick: (start: string | null) => void;
		t: (key: string) => string;
	} = $props();

	const DAY_MS = 86_400_000;
	/** A calendar date's midnight UTC: date arithmetic that no time zone shifts. */
	const at = (d: string) => Date.parse(`${d}T00:00:00Z`);
	const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
	const fmt = (o: Intl.DateTimeFormatOptions, utc = false) =>
		new Intl.DateTimeFormat(locale, utc ? { ...o, timeZone: 'UTC' } : o);

	const starts = $derived(new Map(days.map((d) => [d.day, d.starts])));
	const today = $derived(days[0]?.day ?? '');
	let picked = $state<string | null>(null);
	/** The day shown: the one picked, else the first with an opening. */
	const day = $derived(picked ?? days.find((d) => d.starts.length > 0)?.day ?? today);

	/** Monday-first weeks covering the two weeks offered; cells outside them are blank. */
	const cells = $derived.by(() => {
		if (days.length === 0) return [];
		const first = at(days[0]!.day),
			last = at(days.at(-1)!.day);
		const from = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY_MS;
		const to = last + ((7 - new Date(last).getUTCDay()) % 7) * DAY_MS;
		const out: { day: string; inside: boolean }[] = [];
		for (let ms = from; ms <= to; ms += DAY_MS)
			out.push({ day: iso(ms), inside: ms >= first && ms <= last });
		return out;
	});
	// 1 January 2024 was a Monday
	const weekdays = $derived(
		Array.from({ length: 7 }, (_, i) =>
			fmt({ weekday: 'narrow' }, true).format(at('2024-01-01') + i * DAY_MS)
		)
	);
	const month = $derived.by(() => {
		if (days.length === 0) return '';
		const f = fmt({ month: 'long', year: 'numeric' }, true);
		const a = f.format(at(days[0]!.day)),
			b = f.format(at(days.at(-1)!.day));
		return a === b ? a : `${fmt({ month: 'long' }, true).format(at(days[0]!.day))} – ${b}`;
	});

	/** The day's starts by part of the day: morning, afternoon, evening. */
	const PARTS = [
		{ from: 0, key: 'app.portal.morning' },
		{ from: 12, key: 'app.portal.afternoon' },
		{ from: 17, key: 'app.portal.evening' }
	];
	const parts = $derived(
		PARTS.map((p, i) => ({
			key: p.key,
			starts: (starts.get(day) ?? []).filter((s) => {
				const h = new Date(s).getHours();
				return h >= p.from && h < (PARTS[i + 1]?.from ?? 24);
			})
		})).filter((p) => p.starts.length > 0)
	);
	const time = (s: string) => fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(s));
	const span = $derived(
		value === null
			? null
			: `${fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(value))} · ${time(value)} – ${time(new Date(Date.parse(value) + minutes * 60_000).toISOString())}`
	);
</script>

<Stack gap="lg">
	<Stack gap="sm">
		<p class="text-sm font-semibold">{month}</p>
		<Grid tracks="repeat(7, minmax(0, 1fr))" gap="xs" class="text-center" aria-label={month}>
			{#each weekdays as w, i (i)}
				<span class="pb-1 text-xs font-medium text-muted-foreground">{w}</span>
			{/each}
			{#each cells as c (c.day)}
				{@const open = c.inside ? (starts.get(c.day)?.length ?? 0) : 0}
				{#if !c.inside}
					<span></span>
				{:else}
					<button
						type="button"
						disabled={open === 0}
						aria-pressed={c.day === day}
						aria-label={fmt({ weekday: 'long', day: 'numeric', month: 'long' }, true).format(
							at(c.day)
						)}
						onclick={() => {
							picked = c.day;
							if (value !== null && !(starts.get(c.day) ?? []).includes(value)) onPick(null);
						}}
						class="aspect-square rounded-lg border text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:border-transparent disabled:text-muted-foreground/50 disabled:hover:bg-transparent aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
					>
						<Stack as="span" gap="xs" align="center" justify="center" fill>
							<span class="font-semibold tabular-nums"
								>{fmt({ day: 'numeric' }, true).format(at(c.day))}</span
							>
							<!-- a dot where a helper is free -->
							<span
								class={[
									'size-1 rounded-full',
									open > 0 ? 'bg-current opacity-60' : 'bg-transparent'
								]}
							></span>
						</Stack>
					</button>
				{/if}
			{/each}
		</Grid>
	</Stack>

	<Stack gap="sm">
		<p class="text-sm font-semibold">
			{fmt({ weekday: 'long', day: 'numeric', month: 'long' }, true).format(at(day))}
		</p>
		<!-- the day as a timeline: a rail down the day's parts, each with its open starts in even columns -->
		<Stack gap="md" class="border-l-2 pl-4">
			{#each parts as part (part.key)}
				<Stack gap="sm">
					<p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{t(part.key)}
					</p>
					<Grid tracks="repeat(3, minmax(0, 1fr))" gap="sm">
						{#each part.starts as s (s)}
							<button
								type="button"
								aria-pressed={value === s}
								onclick={() => onPick(s)}
								class="h-10 rounded-md border text-sm font-medium tabular-nums transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
							>
								{time(s)}
							</button>
						{/each}
					</Grid>
				</Stack>
			{/each}
		</Stack>
	</Stack>

	{#if span !== null}
		<Stack gap="xs" class="rounded-lg border bg-muted/40 px-4 py-3">
			<p class="text-caption">{t('app.portal.your_visit')}</p>
			<p class="text-sm font-semibold">{span}</p>
		</Stack>
	{/if}
</Stack>
