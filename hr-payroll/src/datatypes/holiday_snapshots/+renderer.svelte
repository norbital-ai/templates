<script lang="ts">
	import { Result, Schema } from 'effect';
	import { holidaySnapshotsSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';
	let props: RendererProps = $props();
	const parsed = $derived(Schema.decodeUnknownResult(holidaySnapshotsSchema)(props.value));
</script>

{#if Result.isSuccess(parsed)}
	<ul class="space-y-1 text-sm">
		{#each parsed.success as holiday (holiday.id)}
			<li>{holiday.date} · {holiday.name}</li>
		{/each}
	</ul>
{:else}
	<span>—</span>
{/if}
