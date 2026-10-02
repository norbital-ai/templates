<script lang="ts">
	import { getContext, type Snippet } from 'svelte';
	let {
		name,
		editor,
		disabled = false
	}: {
		name: string;
		disabled?: boolean;
		editor?: Snippet<[{ value: unknown; disabled: boolean; onChange: (value: unknown) => void }]>;
	} = $props();
	const form = getContext<{
		get: (name: string) => unknown;
		set: (name: string, value: unknown) => void;
	}>('scope-test-form');
</script>

<div data-field={name}>
	{@render editor?.({
		value: form.get(name),
		disabled,
		onChange: (value) => form.set(name, value)
	})}
</div>
