<script lang="ts">
	import { StructuredData } from '@norbital-ai/ui';
	import { Schema } from 'effect';
	let { value, id }: { value: unknown; id: string } = $props();
	const data = $derived(Schema.is(Schema.Json)(value) ? value : null);
</script>

<StructuredData {id} mode="view" kind={{ kind: 'json' }} value={data} />
