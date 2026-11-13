<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Badge, Button } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';

	let {
		label,
		items,
		onOpen,
		actions
	}: {
		label: string;
		items: readonly {
			id: string;
			period: string;
			status: string;
			detail: string;
			state?: string;
		}[];
		onOpen: (id: string) => void;
		actions?: Snippet<[{ id: string; status: string; state?: string }]>;
	} = $props();
</script>

<ol class="ml-2 border-l border-border" aria-label={label}>
	{#each items as row (row.id)}
		<li class="relative pb-5 pl-5 last:pb-0">
			<span
				class="absolute top-2 -left-1 size-2 rounded-full border border-border bg-card"
				aria-hidden="true"
			></span>
			<div class="flex items-start gap-2">
				<Button
					variant="ghost"
					class="h-auto min-w-0 flex-1 justify-start px-2 py-2 text-left"
					onclick={() => onOpen(row.id)}
				>
					<Stack gap="xs" class="min-w-0 flex-1">
						<Cluster gap="sm" justify="between"
							><span class="font-medium">{row.period}</span><Badge variant="outline"
								>{row.status}</Badge
							></Cluster
						>
						{#if row.detail !== ''}
							<span class="text-sm text-muted-foreground">{row.detail}</span>
						{/if}
					</Stack>
				</Button>
				{#if actions}{@render actions(row)}{/if}
			</div>
		</li>
	{/each}
</ol>
