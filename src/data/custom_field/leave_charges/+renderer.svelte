<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { LeaveCharge } from '../../../lib/datatypes/leave_charges.js';

	let { view }: { view: CustomFieldView<readonly LeaveCharge[]> } = $props();
</script>

{#if view.value}
	<ul class="text-sm">
		{#each view.value as row, index (index)}
			<li>{row.date} · {row.days}</li>
		{/each}
	</ul>
{:else}
	<span>—</span>
{/if}
