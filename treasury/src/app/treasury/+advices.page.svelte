<script lang="ts">
	import { Table, type UiContext } from '@norbital-ai/ui';

	let { ctx }: { ctx: UiContext } = $props();
</script>

<Table {ctx} of="bank_document" order_by="advice_date" />
