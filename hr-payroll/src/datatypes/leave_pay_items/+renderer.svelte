<script lang="ts">
	import { Result, Schema } from 'effect';
	import { leavePayItemsValueSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';
	let props: RendererProps = $props();
	const parsed = $derived(Schema.decodeUnknownResult(leavePayItemsValueSchema)(props.value));
</script>

{#if Result.isSuccess(parsed)}
	<ul class="text-sm">
		{#each parsed.success as row, index (index)}
			<li>{row.code} · {row.date ?? '—'} · {row.amount}</li>
		{/each}
	</ul>
{:else}
	<span>—</span>
{/if}
