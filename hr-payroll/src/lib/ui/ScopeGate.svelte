<script lang="ts" generics="I extends string">
	import type { Snippet } from 'svelte';
	import { t } from './t.js';

	/** A page's body once its entity is chosen; until then, what is loading or what to choose. */
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

{#if scope.id == null}
	<p class="text-sm text-muted-foreground">
		{scope.unknown ? t('app.hr_controller.loading_scope') : empty}
	</p>
{:else}
	{@render children(scope.id)}
{/if}
