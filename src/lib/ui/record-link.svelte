<script lang="ts">
	/** A linked record by its label, with a link that opens it. */
	import { bolt } from '$bolt';
	import { Button, Picker, openRecord } from '@norbital-ai/ui';
	import { Cluster } from '@norbital-ai/ui/layout';
	let {
		of,
		id
	}: {
		of: 'orders' | 'transactions' | 'ext_sales_orders' | 'ext_purchase_orders';
		id: string;
	} = $props();
</script>

<Cluster gap="sm" align="center">
	<Picker {of} value={id} readonly onChange={() => {}} />
	<Button variant="link" size="sm" onclick={() => openRecord(of, id)}
		>{bolt.t('component.open_record')}</Button
	>
</Cluster>
