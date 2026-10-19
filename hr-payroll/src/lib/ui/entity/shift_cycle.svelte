<script lang="ts">
	/**
	 * One shift pattern's cycle as a strip of its days, each naming its shift definition. Machine ids stay in the
	 * value; the strip shows codes. A cycle is any length — a 4-day 2-on-2-off, a 7-day week, a 14-day day/night
	 * rotation — and day 1 is the day the pattern's effective range opens, so a date's place in the cycle is fixed.
	 * An unassigned day stays empty for the roster to project.
	 */
	import { bolt } from '$bolt';
	import { Button, Combobox, Label } from '@norbital-ai/ui';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import Icon from '@iconify/svelte';
	import { Schema } from 'effect';
	import type { Json } from '@norbital-ai/ui';

	let {
		days,
		definitions,
		onChange,
		disabled = false
	}: {
		days: readonly Json[];
		definitions: readonly { readonly id: string; readonly code?: string }[];
		onChange: (days: Json[]) => void;
		disabled?: boolean;
	} = $props();
	const t = bolt.t;

	const Day = Schema.Struct({ roster_code_id: Schema.optional(Schema.String) });
	const WEEKDAYS = [
		'component.weekday_mon_short',
		'component.weekday_tue_short',
		'component.weekday_wed_short',
		'component.weekday_thu_short',
		'component.weekday_fri_short',
		'component.weekday_sat_short',
		'component.weekday_sun_short'
	] as const;
	const MAX_DAYS = 56;

	const options = $derived(
		definitions
			.filter((row) => row.id != null)
			.map((row) => ({ value: String(row.id), label: row.code ?? String(row.id) }))
	);
	const codeOf = (id: string | undefined): string =>
		definitions.find((row) => row.id === id)?.code ?? id ?? t('entity_facts.unassigned');

	/** A cycle that is whole weeks reads as weeks and weekdays; any other length counts days. */
	const labelOf = (index: number): string => {
		const key = WEEKDAYS[index % 7];
		const weekday = key == null ? '' : t(key);
		if (days.length % 7 !== 0) return `${t('shift_pattern.day')} ${index + 1}`;
		return days.length > 7 ? `W${Math.floor(index / 7) + 1} ${weekday}` : weekday;
	};

	const setDay = (day: number, id: string | null) => {
		const next = [...days];
		const held: Record<string, Json> = {};
		if (id != null) held['roster_code_id'] = id;
		next[day] = held;
		onChange(next);
	};
	const grow = () => onChange([...days, {}]);
	const shrink = () => onChange(days.slice(0, -1));
</script>

<Stack gap="sm">
	<Cluster gap="sm" justify="between" align="baseline">
		<p class="text-meta">{t('shift_pattern.cycle_length', { days: days.length })}</p>
		<Cluster gap="xs">
			<Button
				variant="ghost"
				size="sm"
				{disabled}
				onclick={shrink}
				title={t('shift_pattern.remove_day')}
				aria-label={t('shift_pattern.remove_day')}
			>
				<Icon icon="lucide:minus" />
			</Button>
			<Button
				variant="ghost"
				size="sm"
				disabled={disabled || days.length >= MAX_DAYS}
				onclick={grow}
				title={t('shift_pattern.add_day')}
				aria-label={t('shift_pattern.add_day')}
			>
				<Icon icon="lucide:plus" />
			</Button>
		</Cluster>
	</Cluster>
	<Grid tracks="repeat(auto-fit, minmax(6.5rem, 1fr))" gap="xs">
		{#each days as day, dayIndex (dayIndex)}
			{@const current = Schema.is(Day)(day) ? day.roster_code_id : undefined}
			<Stack gap="xs">
				<Label>{labelOf(dayIndex)}</Label>
				<Combobox
					{options}
					value={current ?? null}
					placeholder={codeOf(current)}
					{disabled}
					onChange={(next) => setDay(dayIndex, next)}
				/>
			</Stack>
		{/each}
	</Grid>
	<p class="text-meta">{t('shift_pattern.cycle_hint')}</p>
</Stack>
