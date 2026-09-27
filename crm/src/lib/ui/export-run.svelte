<script lang="ts">
	/** Saves a confirmed document's export (its collection's `export_confirmed` query): one JSON file each. */
	import { bolt } from '$bolt';
	import { Button } from '@norbital-ai/ui';
	import type { Id } from '@norbital-ai/bolt';

	const props:
		| { collection: 'quotes'; id: Id<'quotes'> }
		| { collection: 'purchase_orders'; id: Id<'purchase_orders'> } = $props();
	async function save() {
		const { documents } =
			props.collection === 'quotes'
				? await bolt.query('quotes.export_confirmed', { ids: [props.id] })
				: await bolt.query('purchase_orders.export_confirmed', { ids: [props.id] });
		for (const d of documents) {
			const href = URL.createObjectURL(
				new Blob([JSON.stringify(d.content)], { type: 'application/json' })
			);
			const a = Object.assign(document.createElement('a'), { download: d.name, href });
			document.body.append(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(href), 1000);
		}
	}
</script>

<Button size="sm" variant="outline" onclick={save}>{bolt.t('component.export')}</Button>
