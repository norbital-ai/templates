<script lang="ts">
	/**
	 * "Why is this number": one payslip line's evaluation trace (`payslip_explanations`, recorded by
	 * `lib/trace/record.ts` as the run priced it), as compact rows — each stored expression with its
	 * result, then the inputs it read, the table rows it looked up and every rounding. The citation
	 * is the tracker rows whose `config_path` names the line (`config`). Read only when opened.
	 */
	import { t } from '../ui/t.js';
	import { bolt } from '$bolt';
	import { Button, Icon, Popover } from '@norbital-ai/ui';
	import { Scroll } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import * as Predicate from 'effect/Predicate';
	import { live, liveRows } from '../ui/live.svelte.js';
	import { formatCalendarDate, formatNumeric } from '../ui/display-formatters.js';
	import { citationParts, rowsForNode } from '../rule-map/tracker.js';
	import { lineageTracker } from '../rule-map/tracker-files.js';
	import { tracesOf, type LineTrace, type TracedLine, type TraceStep } from './record.js';

	let {
		payslipId,
		line,
		title,
		config = []
	}: {
		readonly payslipId: string;
		readonly line: Omit<TracedLine, 'part' | 'employment_id'>;
		/** The line as the payslip prints it. */
		readonly title: string;
		/** Tracker `config_path`s naming this line (`statutory_contributions:<code>`, …). */
		readonly config?: readonly string[];
	} = $props();
	let open = $state(false);
	const explanation = liveRows<{ lines: readonly LineTrace[] }>(() =>
		open
			? (bolt.read('payslip_explanations', {
					where: { payslip_id: { eq: payslipId } },
					select: { lines: true },
					limit: 1
				} as never) as never)
			: null
	);
	const traces = $derived(tracesOf(explanation.current?.[0]?.lines ?? [], line));
	const version = live(() =>
		traces[0] == null
			? null
			: bolt.get('jurisdiction_settings', traces[0].settings_id as never, {
					name: true,
					code: true,
					jurisdiction_code: true,
					tables: true
				})
	);
	const tableLabel = (name: string) =>
		(version.current?.tables ?? []).find((table) => table.name === name)?.label ?? name;
	const citations = $derived(
		version.current == null || config.length === 0
			? Promise.resolve([])
			: lineageTracker(version.current).then((rows) => rowsForNode(rows, config))
	);

	/** A value as text: a number with its separators, anything else as recorded. */
	const shown = (value: unknown): string =>
		value == null || value === ''
			? '—'
			: Predicate.isNumber(value) || /^-?\d+(\.\d+)?$/.test(String(value))
				? formatNumeric(value)
				: String(value);
	const BOOKKEEPING = new Set(['code', 'label', 'parent_code', 'range_from', 'range_to']);
	const decodeRow = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
	const one = (row: Readonly<Record<string, unknown>>) =>
		[
			row.range_from != null || row.range_to != null
				? `${shown(row.range_from)} – ${shown(row.range_to)}`
				: (row.label ?? row.code),
			...Object.entries(row)
				.filter(([key, value]) => !BOOKKEEPING.has(key) && value != null)
				.map(([key, value]) => `${key} ${shown(value)}`)
		]
			.filter((part) => part != null && part !== '')
			.join(' · ');
	/** The recorded JSON text of a lookup, or the text itself where it is not JSON. */
	const parsedRow = (json: string): unknown => {
		try {
			const parsed: unknown = JSON.parse(json);
			return parsed;
		} catch {
			return json;
		}
	};
	/** A looked-up row as `from – to · column value …`; a `bands()` result is each row in turn. */
	function rowText(json: string): string {
		if (json === '') return '—';
		const parsed = parsedRow(json);
		return (Array.isArray(parsed) ? parsed : [parsed])
			.map((row) => {
				const decoded = decodeRow(row);
				return decoded._tag === 'Some' ? one(decoded.value) : String(row);
			})
			.join(' | ');
	}
	const result = (step: TraceStep) => step.error ?? shown(step.value);
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon"
				class="size-6 text-muted-foreground"
				aria-label={t('component.line_why')}
			>
				<Icon name="lucide:circle-help" class="size-3.5" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end" sideOffset={6} class="p-0 text-xs">
		<Scroll
			name={t('component.line_why')}
			max="standard"
			layout="stack"
			gap="sm"
			class="w-[40rem] max-w-[90vw] p-3"
		>
			<div>
				<p class="font-medium">{title}</p>
				{#if version.current}
					<p class="text-meta" data-trace-version>{version.current.name}</p>
				{/if}
			</div>
			{#await citations then rows}
				{#if rows.length > 0}
					<ul class="text-meta" data-trace-citations>
						{#each rows.slice(0, 3) as row (row.id)}
							{@const cite = citationParts(row.citation || row.provision)}
							<li class="line-clamp-2">
								{#if cite.url}<a class="underline" href={cite.url} target="_blank" rel="noreferrer"
										>{cite.title}</a
									>{:else}{cite.title}{/if}
								{#if row.effective_from}· {formatCalendarDate(row.effective_from)}{/if}
							</li>
						{/each}
					</ul>
				{/if}
			{/await}
			{#if explanation.loading}
				<p class="text-meta">…</p>
			{:else if traces.length === 0}
				<p class="text-meta">{t('component.line_why_none')}</p>
			{:else}
				{#each traces as trace, part (part)}
					{#if trace.line.part}<p class="font-medium">{trace.line.part}</p>{/if}
					<table class="w-full border-collapse tabular-nums">
						<tbody>
							{#each trace.steps as step, index (index)}
								<tr class="border-t border-border align-top" data-trace-step>
									<td class="w-6 py-1 pr-2 text-muted-foreground">{index + 1}</td>
									<td class="py-1 pr-2">
										<code class="font-mono break-words whitespace-pre-wrap">{step.expression}</code>
										{#each step.reads as read (read.path)}
											<p class="text-muted-foreground" data-trace-read>
												<span class="font-mono">{read.path}</span> = {shown(read.value)}
												{#if read.effective_from}· {formatCalendarDate(read.effective_from)}{/if}
												{#if read.evidence}· {read.evidence}{/if}
											</p>
										{/each}
										{#each step.tables as lookup, at (at)}
											<p class="text-muted-foreground" data-trace-table>
												{tableLabel(lookup.name)}{lookup.value == null
													? ''
													: ` @ ${shown(lookup.value)}`} → {rowText(lookup.row)}
											</p>
										{/each}
										{#each step.rounding as round, at (at)}
											<p class="text-muted-foreground" data-trace-rounding>
												{shown(round.value)} → {shown(round.result)} ({round.mode}, {round.step})
											</p>
										{/each}
									</td>
									<td class="py-1 text-right font-medium whitespace-nowrap">= {result(step)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if trace.skipped + trace.omitted > 0}
						<p class="text-meta">
							{t('component.line_why_skipped', { skipped: trace.skipped, omitted: trace.omitted })}
						</p>
					{/if}
				{/each}
			{/if}
		</Scroll>
	</Popover.Content>
</Popover.Root>
