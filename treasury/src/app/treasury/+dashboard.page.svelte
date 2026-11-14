<script lang="ts">
	import { Table, type UiContext } from '@norbital-ai/ui';

	let { ctx }: { ctx: UiContext } = $props();
</script>

<Table {ctx} of="drawdown" order_by="due_date" />
