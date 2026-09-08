<script lang="ts">
	import { Result, Schema } from 'effect';
	import { leaveAllocationsValueSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';
	let props: RendererProps = $props();
	const parsed = $derived(Schema.decodeUnknownResult(leaveAllocationsValueSchema)(props.value));
</script>

{#if Result.isSuccess(parsed)}
	<ul class="text-sm">
		{#each parsed.success as row, index (index)}
			<li>
				{row.window.start} → {row.window.end} · {row.date} · {row.days > 0 ? '+' : ''}{row.days}
			</li>
		{/each}
	</ul>
{:else}
	<span>—</span>
{/if}
