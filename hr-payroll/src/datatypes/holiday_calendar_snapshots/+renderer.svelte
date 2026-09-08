<script lang="ts">
	import { Result, Schema } from 'effect';
	import { holidayCalendarSnapshotsSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';
	let props: RendererProps = $props();
	const parsed = $derived(Schema.decodeUnknownResult(holidayCalendarSnapshotsSchema)(props.value));
</script>

{#if Result.isSuccess(parsed)}
	<ul class="space-y-1 text-sm">
		{#each parsed.success as calendar (calendar.id)}
			<li>{calendar.jurisdiction_code} · {calendar.year} · r{calendar.revision}</li>
		{/each}
	</ul>
{:else}
	<span>—</span>
{/if}
