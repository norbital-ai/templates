<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { LeaveAllocation } from '../../../lib/datatypes/leave_allocations.js';

	let { view }: { view: CustomFieldView<readonly LeaveAllocation[]> } = $props();
</script>

{#if view.value}
	<ul class="text-sm">
		{#each view.value as row, index (index)}
			<li>
				{row.window.start} → {row.window.end} · {row.date} · {row.days > 0 ? '+' : ''}{row.days}
			</li>
		{/each}
	</ul>
{:else}
	<span>—</span>
{/if}
