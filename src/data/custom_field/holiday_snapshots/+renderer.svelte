<script lang="ts">
	import { Stack } from '@norbital-ai/ui/layout';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { HolidaySnapshot } from '../../../lib/datatypes/holiday_snapshots.js';

	let { view }: { view: CustomFieldView<readonly HolidaySnapshot[]> } = $props();
</script>

{#if view.value}
	<Stack as="ul" gap="xs" class="text-sm">
		{#each view.value as holiday (holiday.id)}
			<li>{holiday.date} · {holiday.name}</li>
		{/each}
	</Stack>
{:else}
	<span>—</span>
{/if}
