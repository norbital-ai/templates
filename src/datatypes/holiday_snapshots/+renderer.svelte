<script lang="ts">
	import { Result, Schema } from 'effect';
	import { holidaySnapshotsSchema } from './+definition.js';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { RendererProps } from './$types.js';
	let props: RendererProps = $props();
	const parsed = $derived(Schema.decodeUnknownResult(holidaySnapshotsSchema)(props.value));
</script>

{#if Result.isSuccess(parsed)}
	<Stack as="ul" gap="xs" class="text-sm">
		{#each parsed.success as holiday (holiday.id)}
			<li>{holiday.date} · {holiday.name}</li>
		{/each}
	</Stack>
{:else}
	<span>—</span>
{/if}
