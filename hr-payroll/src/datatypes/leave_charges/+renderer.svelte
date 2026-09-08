<script lang="ts">
	import { Result, Schema } from 'effect';
	import { leaveChargesValueSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';
	let props: RendererProps = $props();
	const parsed = $derived(Schema.decodeUnknownResult(leaveChargesValueSchema)(props.value));
</script>

{#if Result.isSuccess(parsed)}
	<ul class="text-sm">
		{#each parsed.success as row, index (index)}
			<li>{row.date} · {row.days}</li>
		{/each}
	</ul>
{:else}
	<span>—</span>
{/if}
