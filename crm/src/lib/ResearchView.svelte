<script lang="ts">
	/**
	 * Renders Company Research as structured Markdown with Wikipedia-style clickable `[n]` citation popovers
	 * and a linked References section below. Also provides a helper for formatted Use Cases sharing those citations.
	 */
	import { Button, Icon, Popover, ReadonlyMarkdown } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import type { Reference } from './research.js';
	import { linkCitations, parseResearch, parseUseCase } from './research.js';

	let {
		research,
		useCases,
		mode = 'research',
		emptyText,
		copyLabel = 'Copy',
		copiedLabel = 'Copied',
		openSourceLabel = 'Open source'
	}: {
		research: string | null | undefined;
		useCases?: readonly string[] | null | undefined;
		mode?: 'research' | 'use_cases';
		emptyText: string;
		copyLabel?: string;
		copiedLabel?: string;
		openSourceLabel?: string;
	} = $props();

	const parsed = $derived(parseResearch(research));
	let activeRef = $state<Reference | null>(null);
	let popoverOpen = $state(false);
	let anchor = $state<HTMLElement | null>(null);
	let copiedIndex = $state<number | null>(null);

	function handleCitationClick(event: MouseEvent) {
		const target = event.target instanceof HTMLElement ? event.target.closest('a') : null;
		const href = target?.getAttribute('href') ?? '';
		if (!href.startsWith('#hq-ref-')) return;
		event.preventDefault();
		const n = Number(href.slice('#hq-ref-'.length));
		const found = parsed.byNumber.get(n);
		if (found === undefined || !(target instanceof HTMLElement)) return;
		anchor = target;
		activeRef = found;
		popoverOpen = true;
	}

	async function copyUseCase(text: string, index: number) {
		try {
			await navigator.clipboard.writeText(text);
			copiedIndex = index;
			setTimeout(() => {
				if (copiedIndex === index) copiedIndex = null;
			}, 1500);
		} catch {
			// Clipboard unavailable in restricted contexts.
		}
	}
</script>

{#if mode === 'research'}
	{#if !research || research.trim() === ''}
		<p class="text-sm text-muted-foreground">{emptyText}</p>
	{:else}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="research-prose" onclick={handleCitationClick}>
			<ReadonlyMarkdown value={parsed.markdown} />
		</div>
	{/if}
{:else if !useCases || useCases.length === 0}
	<p class="text-sm text-muted-foreground">{emptyText}</p>
{:else}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="research-prose grid gap-3" onclick={handleCitationClick}>
		{#each useCases as item, i (i)}
			{@const uc = parseUseCase(item)}
			<div class="rounded-lg border bg-muted/25 p-3.5">
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0 flex-1 space-y-1">
						{#if uc.title}
							<h4 class="text-label">{uc.title}</h4>
						{/if}
						<ReadonlyMarkdown value={linkCitations(uc.body, parsed.byNumber)} />
					</div>
					<Button
						variant="ghost"
						class="h-7 shrink-0 px-2 text-xs text-muted-foreground"
						onclick={() => void copyUseCase(item, i)}
					>
						<Icon name={copiedIndex === i ? 'lucide:check' : 'lucide:copy'} class="mr-1 size-3" />
						{copiedIndex === i ? copiedLabel : copyLabel}
					</Button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<Popover.Root bind:open={popoverOpen}>
	<Popover.Content
		custom_anchor={anchor}
		side="top"
		align="start"
		class="z-50 w-80 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
	>
		{#if activeRef}
			<Stack gap="xs">
				<Cluster align="center" justify="between" gap="xs">
					<span class="rounded bg-muted px-1.5 py-0.5 font-mono text-micro font-medium">
						[{activeRef.n}]
					</span>
					<span class="text-micro text-muted-foreground">{activeRef.host}</span>
				</Cluster>
				<p class="text-sm font-medium leading-snug">{activeRef.title}</p>
				<Cluster align="center" justify="start" gap="sm" class="pt-1">
					<a
						href={activeRef.url}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
					>
						<span>{openSourceLabel}</span>
						<Icon name="lucide:external-link" class="size-3" />
					</a>
				</Cluster>
			</Stack>
		{/if}
	</Popover.Content>
</Popover.Root>

<style>
	.research-prose :global(a[href^='#hq-ref-']) {
		display: inline-flex;
		align-items: center;
		vertical-align: super;
		font-size: 0.7em;
		line-height: 1;
		font-weight: 600;
		padding: 0.1em 0.35em;
		margin-inline: 1px;
		border-radius: 9999px;
		background: color-mix(in oklch, var(--color-primary) 12%, transparent);
		color: var(--color-primary);
		text-decoration: none;
	}
	.research-prose :global(a[href^='#hq-ref-']:hover) {
		background: color-mix(in oklch, var(--color-primary) 22%, transparent);
	}
</style>
