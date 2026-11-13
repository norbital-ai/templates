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
			/** a stretch with no version in force (a person between contracts): shown, not opened */
			gap?: boolean;
		}[];
		onOpen: (id: string) => void;
		actions?: Snippet<[{ id: string; status: string; state?: string }]>;
	} = $props();
</script>

<ol class="ml-2 border-l border-border" aria-label={label}>
	{#each items as row (row.id)}
		{#if row.gap}<li class="relative pb-5 pl-5 last:pb-0">
				<span
					class="absolute top-2 -left-1 size-2 rounded-full border border-dashed border-border bg-background"
					aria-hidden="true"
				></span>
				<Stack gap="xs" class="px-2 py-2 text-muted-foreground"
					><Cluster gap="sm" justify="between"
						><span class="text-sm">{row.period}</span><Badge variant="outline">{row.status}</Badge
						></Cluster
					>{#if row.detail !== ''}<span class="text-sm">{row.detail}</span>{/if}</Stack
				>
			</li>{:else}
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
			</li>{/if}
	{/each}
</ol>
