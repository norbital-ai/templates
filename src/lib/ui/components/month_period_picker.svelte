<script lang="ts">
	import { t } from '../i18n/t.js';
	import { Inline } from '@norbital-ai/ui/layout';
	import { MonthInput } from '@norbital-ai/ui';
	import { weeklyInstalments } from '../../payroll_engine/foundation.js';

	const period_month = (period: string) => period.slice(0, 7);
	const period_half = (period: string) => (period.endsWith('-2') ? 2 : 1);
	const week_end = (start: string) => {
		const stamp = new Date(`${start}T00:00:00Z`);
		stamp.setUTCDate(stamp.getUTCDate() + 6);
		return stamp.toISOString().slice(0, 10);
	};
	const week_instalments = (period: string) =>
		weeklyInstalments(period_month(period)).map((start, index) => ({
			sequence: index + 1,
			salary: { start, end: week_end(start) }
		}));

	let {
		month,
		onMonthChange,
		halves = false,
		weeks = false,
		ariaLabel = undefined,
		disabled = false
	}: {
		/** The selected period in the entity's grammar: `YYYY-MM`, or `YYYY-MM-1` / `-2`. */
		month: string;
		onMonthChange: (month: string) => void;
		/** Offer the two halves of the month — the entity pays semi-monthly. */
		halves?: boolean;
		/** Offer the weeks paid in the month — the entity pays weekly. */
		weeks?: boolean;
		/** Defaults to the roster month label; the event pages name their pay period instead. */
		ariaLabel?: string;
		disabled?: boolean;
	} = $props();

	const half = $derived(period_half(month));
	const monthWeeks = $derived(weeks ? week_instalments(month) : []);
</script>

{#snippet periodButton(active: boolean, label: string, select: () => void, title?: string)}
	<button
		type="button"
		class="rounded-md border px-2 py-1 text-xs {active
			? 'border-foreground bg-foreground text-background'
			: 'border-border text-muted-foreground hover:bg-muted'}"
		aria-pressed={active}
		{title}
		{disabled}
		onclick={select}
	>
		{label}
	</button>
{/snippet}

<Inline gap="sm" data-month-picker>
	<span class="sr-only">{ariaLabel ?? t('app.scheduling.month_picker')}</span>
	<MonthInput
		value={period_month(month)}
		onChange={(next) => {
			if (next == null) return;
			onMonthChange(
				halves
					? `${next}-${half}`
					: weeks
						? `${next}-${Math.min(half, week_instalments(next).length)}`
						: next
			);
		}}
		{disabled}
	/>
	{#if weeks}
		<Inline
			gap="xs"
			align="stretch"
			role="group"
			aria-label={t('app.scheduling.week_picker')}
			data-week-picker
		>
			{#each monthWeeks as week (week.sequence)}
				{@render periodButton(
					half === week.sequence,
					t('app.scheduling.week_n', { n: week.sequence }),
					() => onMonthChange(`${period_month(month)}-${week.sequence}`),
					`${week.salary.start} – ${week.salary.end}`
				)}
			{/each}
		</Inline>
	{:else if halves}
		<Inline
			gap="xs"
			align="stretch"
			role="group"
			aria-label={t('app.scheduling.half_picker')}
			data-half-picker
		>
			{@render periodButton(half === 1, t('app.scheduling.first_half'), () =>
				onMonthChange(`${period_month(month)}-1`)
			)}
			{@render periodButton(half === 2, t('app.scheduling.second_half'), () =>
				onMonthChange(`${period_month(month)}-2`)
			)}
		</Inline>
	{/if}
</Inline>
