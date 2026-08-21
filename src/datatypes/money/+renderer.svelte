<script lang="ts">
	import { formatDataValue } from '@norbital-ai/ui/data-renderer';
	import { MoneyRenderer } from '@norbital-ai/ui/data-renderer/money';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import type { RendererProps } from './$types.js';

	let props: RendererProps = $props();
	// The renderer contract names the custom type through `type`; the shared field vocabulary keys
	// on `kind`. `nullable` is a display concern the renderer cannot know, and the money renderer
	// treats a null value as absent either way.
	const field = $derived<CollectionField>({
		name: props.field.name,
		kind: props.field.type,
		nullable: true
	});
</script>

{#if props.mode === 'edit'}
	<MoneyRenderer
		{field}
		value={props.value}
		mode="edit"
		disabled={props.disabled}
		onValueChange={props.onValueChange}
	/>
{:else}
	<span class="block truncate" title={formatDataValue(field, props.value)}>
		{formatDataValue(field, props.value)}
	</span>
{/if}
