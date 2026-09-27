<script lang="ts" generics="R">
	/**
	 * A list value edited row by row inside a custom field: each row's fields on a ruled grid with its remove, and the add
	 * under the list. Without `remove` the list is append-only.
	 */
	import type { Snippet } from 'svelte';
	import { Button } from '@norbital-ai/ui';
	import { Cluster, Grid } from '@norbital-ai/ui/layout';

	let {
		rows,
		row,
		disabled = false,
		addLabel,
		add,
		removeLabel = '',
		remove
	}: {
		rows: readonly R[];
		row: Snippet<[R, number]>;
		disabled?: boolean;
		addLabel: string;
		add: () => void;
		removeLabel?: string;
		remove?: (index: number) => void;
	} = $props();
</script>

{#each rows as item, index (index)}
	<Grid gap="sm" minimum="compact" class="border-b border-border pb-3">
		{@render row(item, index)}
		{#if remove != null}
			<Cluster>
				<Button variant="ghost" size="sm" {disabled} onclick={() => remove(index)}
					>{removeLabel}</Button
				>
			</Cluster>
		{/if}
	</Grid>
{/each}
<Cluster><Button variant="outline" size="sm" {disabled} onclick={add}>{addLabel}</Button></Cluster>
