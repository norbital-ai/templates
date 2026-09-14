<script lang="ts">
	/**
	 * A payslip's lifecycle as a colour-coded badge: draft is neutral, held warns, paid is done.
	 * Status moves in bulk at the run level; this column only reads it.
	 */
	import { Badge } from '@norbital-ai/ui/badge';

	let { value }: { readonly value?: unknown } = $props();
	const status = $derived(typeof value === 'string' ? value : String(value ?? ''));
	const variant = $derived<'success' | 'warning' | 'outline'>(
		status === 'PAID' ? 'success' : status === 'ON_HOLD' ? 'warning' : 'outline'
	);
</script>

<Badge {variant}>{status}</Badge>
