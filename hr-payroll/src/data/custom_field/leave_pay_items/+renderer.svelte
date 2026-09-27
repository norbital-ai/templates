<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { LeavePayItem } from '../../../lib/datatypes/leave_pay_items.js';

	let { view }: { view: CustomFieldView<readonly LeavePayItem[]> } = $props();
</script>

{#if view.value}
	<ul class="text-sm">
		{#each view.value as row, index (index)}
			<li>{row.code} · {row.date ?? '—'} · {row.amount}</li>
		{/each}
	</ul>
{:else}
	<span>—</span>
{/if}
