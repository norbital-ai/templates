<script lang="ts" generics="I extends string">
	import type { Snippet } from 'svelte';
	import { EmptyState } from '@norbital-ai/ui';
	import Loading from './Loading.svelte';

	/** A page's body once its entity is chosen; until then, loading or what to choose. */
	let {
		scope,
		empty,
		children
	}: {
		scope: { readonly id: I | null | undefined; readonly unknown: boolean };
		empty: string;
		children: Snippet<[I]>;
	} = $props();
</script>

{#if scope.unknown}
	<Loading />
{:else if scope.id == null}
	<EmptyState title={empty} />
{:else}
	{@render children(scope.id)}
{/if}
