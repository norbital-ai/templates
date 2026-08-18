<script lang="ts">
	import { Result, Schema } from 'effect';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { payCalendarSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	/**
	 * A calendar is read far more often than it is written, and what an operator needs to read is
	 * whether the instalments still tile the month. The display is therefore the windows and their
	 * pay dates in order — `1–15 paid 15 · 16–end paid 30` — rather than a count of them.
	 */
	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(payCalendarSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? (parsed.success as Value) : null);

	type Entry = Value[number];
	type Window = Entry['instalments'][number];

	function day(value: number): string {
		return value >= 31 ? 'end' : String(value);
	}

	const summary = $derived.by(() => {
		if (current === null || current.length === 0) return 'Monthly only';
		return current
			.map(
				(entry: Entry) =>
					`${entry.pay_frequency}: ` +
					entry.instalments
						.map(
							(instalment: Window) =>
								`${instalment.start_day}–${day(instalment.end_day)} paid ${day(instalment.pay_day)}`
						)
						.join(' · ')
			)
			.join(' | ');
	});

	function patch(entryIndex: number, instalmentIndex: number, change: Partial<Window>): void {
		if (props.mode !== 'edit' || current === null) return;
		props.onValueChange(
			current.map((entry: Entry, index: number) =>
				index !== entryIndex
					? entry
					: {
							...entry,
							instalments: entry.instalments.map((instalment: Window, position: number) =>
								position === instalmentIndex ? { ...instalment, ...change } : instalment
							)
						}
			)
		);
	}

	function dayFrom(raw: string, fallback: number): number {
		const next = Math.trunc(Number(raw));
		return Number.isFinite(next) && next >= 1 && next <= 31 ? next : fallback;
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else if current === null || current.length === 0}
	<span class="text-sm text-muted-foreground">
		Monthly only — this company's cutoff day and pay day describe its whole calendar.
	</span>
{:else}
	<Stack gap="sm">
		{#each current as entry, entryIndex (entry.pay_frequency)}
			<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
				<span class="text-sm font-medium">{entry.pay_frequency}</span>
				{#each entry.instalments as instalment, instalmentIndex (instalmentIndex)}
					<label class="grid gap-1.5 text-sm font-medium">
						From day
						<Input
							type="number"
							min="1"
							max="31"
							step="1"
							value={instalment.start_day}
							{disabled}
							oninput={(event) =>
								patch(entryIndex, instalmentIndex, {
									start_day: dayFrom(event.currentTarget.value, instalment.start_day)
								})}
						/>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						To day
						<Input
							type="number"
							min="1"
							max="31"
							step="1"
							value={instalment.end_day}
							{disabled}
							oninput={(event) =>
								patch(entryIndex, instalmentIndex, {
									end_day: dayFrom(event.currentTarget.value, instalment.end_day)
								})}
						/>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						Paid on day
						<Input
							type="number"
							min="1"
							max="31"
							step="1"
							value={instalment.pay_day}
							{disabled}
							oninput={(event) =>
								patch(entryIndex, instalmentIndex, {
									pay_day: dayFrom(event.currentTarget.value, instalment.pay_day)
								})}
						/>
					</label>
				{/each}
			</Grid>
		{/each}
	</Stack>
{/if}
