<script lang="ts">
	/**
	 * Picking a visit's start: the next two weeks as a swipeable strip of days (each with how many starts it has; a day
	 * nobody can take is greyed), then the chosen day's starts by part of the day, each with when the visit would end.
	 */
	import { Grid, Scroll, Stack } from '@norbital-ai/ui/layout';

	type Day = { readonly day: string; readonly starts: readonly string[] };
	type SlotCopy =
		| 'app.portal.morning'
		| 'app.portal.afternoon'
		| 'app.portal.evening'
		| 'app.portal.your_visit'
		| 'app.portal.starts_count';
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
		t: (key: SlotCopy) => string;
	} = $props();

	/** A calendar date's midnight UTC: date arithmetic that no time zone shifts. */
	const at = (d: string) => Date.parse(`${d}T00:00:00Z`);
	const fmt = (o: Intl.DateTimeFormatOptions, utc = false) =>
		new Intl.DateTimeFormat(locale, utc ? { ...o, timeZone: 'UTC' } : o);

	const starts = $derived(new Map(days.map((d) => [d.day, d.starts])));
	const today = $derived(days[0]?.day ?? '');
	let picked = $state<string | null>(null);
	/** The day shown: the one picked, else the first with an opening. */
	const day = $derived(
		(picked !== null && starts.has(picked) ? picked : null) ??
			days.find((d) => d.starts.length > 0)?.day ??
			today
	);
	const month = $derived.by(() => {
		if (days.length === 0) return '';
		const f = fmt({ month: 'long', year: 'numeric' }, true);
		const a = f.format(at(days[0]!.day)),
			b = f.format(at(days.at(-1)!.day));
		return a === b ? a : `${fmt({ month: 'long' }, true).format(at(days[0]!.day))} – ${b}`;
	});

	/** The day's starts by part of the day: morning, afternoon, evening. */
	const PARTS: readonly { from: number; key: SlotCopy }[] = [
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
	const end = (s: string) => new Date(Date.parse(s) + minutes * 60_000).toISOString();
	const span = $derived(
		value === null
			? null
			: `${fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(value))} · ${time(value)} – ${time(end(value))}`
	);
</script>

<Stack gap="lg">
	<Stack gap="sm">
		<p class="text-sm font-semibold">{month}</p>
		<!-- the two weeks as one swipeable strip: each day says how many starts it has; a day nobody can take is greyed -->
		<Scroll name="slot-days" axis="x" gap="xs" class="pb-1">
			{#each days as d (d.day)}
				{@const open = d.starts.length}
				<button
					type="button"
					disabled={open === 0}
					aria-pressed={d.day === day}
					aria-label={fmt({ weekday: 'long', day: 'numeric', month: 'long' }, true).format(
						at(d.day)
					)}
					onclick={() => {
						picked = d.day;
						if (value !== null && !d.starts.includes(value)) onPick(null);
					}}
					class="w-16 shrink-0 rounded-xl border bg-background px-1 py-2 text-center transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:border-dashed disabled:bg-transparent disabled:text-muted-foreground/50 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
				>
					<Stack as="span" gap="none" align="center">
						<span class="text-xs uppercase opacity-80"
							>{fmt({ weekday: 'short' }, true).format(at(d.day))}</span
						>
						<span class="text-lg font-semibold tabular-nums"
							>{fmt({ day: 'numeric' }, true).format(at(d.day))}</span
						>
						<span class="text-xs tabular-nums opacity-80"
							>{open === 0
								? '—'
								: t('app.portal.starts_count').replace('{count}', String(open))}</span
						>
					</Stack>
				</button>
			{/each}
		</Scroll>
	</Stack>

	<Stack gap="md">
		<p class="text-sm font-semibold">
			{fmt({ weekday: 'long', day: 'numeric', month: 'long' }, true).format(at(day))}
		</p>
		{#each parts as part (part.key)}
			<Stack gap="sm">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					{t(part.key)} · {part.starts.length}
				</p>
				<Grid tracks="repeat(auto-fill, minmax(6.5rem, 1fr))" gap="sm">
					{#each part.starts as s (s)}
						<button
							type="button"
							aria-pressed={value === s}
							onclick={() => onPick(s)}
							class="min-h-14 rounded-lg border bg-background px-2 py-1.5 text-center tabular-nums transition-colors hover:border-primary/60 hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
						>
							<Stack as="span" gap="none" align="center">
								<span class="text-sm font-semibold">{time(s)}</span>
								<span class="text-xs opacity-70">– {time(end(s))}</span>
							</Stack>
						</button>
					{/each}
				</Grid>
			</Stack>
		{/each}
	</Stack>

	{#if span !== null}
		<Stack
			gap="xs"
			class="rounded-xl border border-primary/40 bg-primary/5 px-4 py-3"
			role="status"
		>
			<p class="text-caption">{t('app.portal.your_visit')}</p>
			<p class="text-sm font-semibold">{span}</p>
		</Stack>
	{/if}
</Stack>
