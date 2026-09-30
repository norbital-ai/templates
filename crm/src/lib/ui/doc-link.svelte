<script lang="ts">
	/**
	 * A document number that opens its record: a table row opens only through the kit's hover button, so the number a
	 * person reads is also what they click.
	 */
	import { openRecord } from '@norbital-ai/ui';

	let { of, row, value }: { of: string; row: { readonly id?: unknown }; value: unknown } = $props();
</script>

<button
	type="button"
	class="font-medium underline-offset-2 hover:underline"
	onclick={() => typeof row.id === 'string' && openRecord(of, row.id)}>{String(value ?? '')}</button
>
