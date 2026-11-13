<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	/** A linked record by its label, with a link that opens it. */
	import { Button, Picker, open_record } from '@norbital-ai/ui';
	import { Cluster } from '@norbital-ai/ui/layout';
	let {
		of,
		id,
		ctx
	}: {
		of: 'orders' | 'transactions' | 'ext_purchase_orders';
		id: string;
		ctx: PageContext;
	} = $props();
</script>

<Cluster gap="sm" align="center">
	<Picker {ctx} {of} value={id} readonly on_change={() => {}} />
	<Button variant="link" onclick={() => open_record(of, id)}
		>{ctx.t('component.open_record')}</Button
	>
</Cluster>
