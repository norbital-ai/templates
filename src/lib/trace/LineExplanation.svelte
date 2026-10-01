<script lang="ts">
	/**
	 * "Why is this number": one payslip line's evaluation trace (`payslip_explanations`, recorded by
	 * `lib/trace/record.ts` as the run priced it), as compact rows — each stored expression with its
	 * result, then the inputs it read, the table rows it looked up and every rounding. Read only when opened.
	 */
	import InfoTip from '../ui/InfoTip.svelte';
	import { Inline } from '@norbital-ai/ui/layout';
	import { t } from '../ui/t.js';
	import { bolt } from '$bolt';
	import { Button, Icon, Popover } from '@norbital-ai/ui';
	import { Scroll } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import * as Predicate from 'effect/Predicate';
	import { live, liveRows } from '../ui/live.svelte.js';
	import { formatCalendarDate, formatNumeric } from '../ui/display-formatters.js';
	import { CATALOGUE_COLLECTIONS } from '../rule-map/graph.js';
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
		/** Published catalogue or work-rule paths that priced this line. */
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
					tables: true,
					work_rules: true
				})
	);
	const scheme = liveRows(() =>
		!open || line.kind !== 'STATUTORY' || traces[0] == null
			? null
			: bolt.read('statutory_contributions', {
					where: {
						settings_id: { eq: traces[0].settings_id as never },
						code: { eq: line.code },
						approval_id: { isNull: true }
					},
					select: { name: true, authority: true },
					all: true
				})
	);
	const catalogueAuthorities = CATALOGUE_COLLECTIONS.map((collection) => ({
		collection,
		rows: liveRows<{ name: string; authority?: string | null }>(() =>
			!open || traces[0] == null || !config.includes(`${collection}:${line.code}`)
				? null
				: (bolt.read(collection, {
						where: {
							settings_id: { eq: traces[0].settings_id },
							code: { eq: line.code },
							approval_id: { isNull: true }
						},
						select: { name: true, authority: true },
						all: true
					} as never) as never)
		)
	}));
	const authorities = $derived(
		[
			...(scheme.current ?? []),
			...(config.some((path) => path.startsWith('work_rules.')) &&
			version.current?.work_rules?.authority
				? [{ name: t('component.work_rules'), authority: version.current.work_rules.authority }]
				: []),
			...catalogueAuthorities.flatMap(({ rows }) => rows.current ?? [])
		].filter((row) => row.authority != null && row.authority !== '')
	);
	const tableLabel = (name: string) =>
		(version.current?.tables ?? []).find((table) => table.name === name)?.label ?? name;

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
				<Icon name="lucide:info" class="size-3.5" />
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
				<Inline gap="xs" align="center"
					><p class="font-medium">{title}</p>
					<InfoTip label={title}>{t('component.trace_help')}</InfoTip></Inline
				>
				{#if version.current}
					<p class="text-meta" data-trace-version>{version.current.name}</p>
				{/if}
			</div>

			{#if explanation.loading}
				<p class="text-meta">…</p>
			{:else if traces.length === 0}
				<p class="text-meta">{t('component.line_why_none')}</p>
			{:else}
				{#if authorities.length > 0}
					<details>
						<summary>{t('component.rule_map_citation')}</summary>
						{#each authorities as source, index (index)}<p class="whitespace-pre-wrap py-1">
								{source.name}: {source.authority}
							</p>{/each}
					</details>
				{/if}
				{#each traces as trace, part (part)}
					{#if trace.line.part}<p class="font-medium">{trace.line.part}</p>{/if}
					<table class="w-full border-collapse tabular-nums">
						<tbody>
							{#each trace.steps as step, index (index)}
								<tr class="border-t border-border align-top" data-trace-step>
									<td class="w-6 py-1 pr-2 text-muted-foreground">{index + 1}</td>
									<td class="py-1 pr-2">
										<Inline gap="xs" align="center"
											><code class="font-mono break-words whitespace-pre-wrap"
												>{step.expression}</code
											><InfoTip label={t('component.rule_calculation')}
												>{t('component.trace_step_help')}</InfoTip
											></Inline
										>
										{#each step.reads as read (read.path)}
											<p class="text-muted-foreground" data-trace-read>
												<span class="font-mono">{read.path}</span> = {shown(read.value)}
												{#if read.effective_from}· {formatCalendarDate(read.effective_from)}{/if}
												{#if read.evidence}· {read.evidence}{/if}
											</p>
										{/each}
										{#each step.tables as lookup, at (at)}
											<p class="text-muted-foreground" data-trace-table>
												<InfoTip label={tableLabel(lookup.name)}
													>{t('component.trace_table_help')}</InfoTip
												>
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
