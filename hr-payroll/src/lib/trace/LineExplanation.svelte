<script lang="ts">
	/**
	 * "Why is this number": one payslip line's evaluation trace (`payslip_explanations`, recorded by
	 * `lib/trace/record.ts` as the run priced it). Each step is one stored expression the line
	 * evaluated, with its value, the inputs it read (revision date and evidence where the run knew
	 * them), the table rows it looked up and every rounding. Read only when opened.
	 */
	import { t } from '../ui/t.js';
	import { bolt } from '$bolt';
	import { Button, Icon, Popover } from '@norbital-ai/ui';
	import { Scroll, Stack } from '@norbital-ai/ui/layout';
	import { live, liveRows } from '../ui/live.svelte.js';
	import { tracesOf, type LineTrace, type TracedLine } from './record.js';

	let { payslipId, line }: { readonly payslipId: string; readonly line: Omit<TracedLine, 'part' | 'employment_id'> } =
		$props();
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
			: bolt.get('jurisdiction_settings', traces[0].settings_id as never, { name: true })
	);
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" size="icon" aria-label={t('component.line_why')}>
				<Icon name="lucide:circle-help" class="size-4" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="start" sideOffset={6} class="p-0 text-xs">
		<Scroll
			name={t('component.line_why')}
			max="standard"
			layout="stack"
			gap="sm"
			class="w-[36rem] max-w-[90vw] p-3"
		>
			<p class="font-medium">{line.code}</p>
			{#if explanation.loading}
				<p class="text-meta">…</p>
			{:else if traces.length === 0}
				<p class="text-meta">{t('component.line_why_none')}</p>
			{:else}
				{#each traces as trace, part (part)}
					{#if trace.line.part}<p class="font-medium">{trace.line.part}</p>{/if}
					<p class="text-meta" data-trace-version>
						{t('component.line_why_version', { name: version.current?.name ?? trace.settings_id })}
					</p>
					<Stack as="ol" gap="sm" class="m-0 list-decimal pl-4">
						{#each trace.steps as step, index (index)}
							<li class="break-words" data-trace-step>
								<pre class="whitespace-pre-wrap break-words font-mono">{step.expression}</pre>
								<p>
									= <span class="font-medium tabular-nums">{step.error ?? step.value}</span>
								</p>
								{#if step.reads.length > 0}
									<ul class="text-muted-foreground">
										{#each step.reads as read (read.path)}
											<li>
												<span class="font-mono">{read.path}</span> = {read.value}
												{#if read.effective_from}· {t('component.line_why_from', {
														date: read.effective_from
													})}{/if}
												{#if read.evidence}· {read.evidence}{/if}
											</li>
										{/each}
									</ul>
								{/if}
								{#each step.tables as lookup, at (at)}
									<p class="font-mono text-muted-foreground">
										{lookup.fn}('{lookup.name}', {lookup.keys}{lookup.value == null
											? ''
											: `, ${lookup.value}`}) → {lookup.row || '—'}
									</p>
								{/each}
								{#each step.rounding as round, at (at)}
									<p class="font-mono text-muted-foreground">
										round({round.value}, {round.step}, '{round.mode}') = {round.result}
									</p>
								{/each}
							</li>
						{/each}
					</Stack>
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
