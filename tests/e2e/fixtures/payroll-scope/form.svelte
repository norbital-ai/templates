<script lang="ts">
	import { setContext, type Snippet } from 'svelte';
	let {
		values,
		disabled = false,
		children
	}: {
		values: Record<string, unknown>;
		disabled?: boolean;
		children: Snippet<
			[{ get: (name: string) => unknown; set: (name: string, value: unknown) => void }]
		>;
	} = $props();
	// svelte-ignore state_referenced_locally
	const row = $state({ ...values });
	const draft = {
		get: (name: string) => row[name],
		set: (name: string, value: unknown) => {
			row[name] = value;
		}
	};
	setContext('scope-test-form', draft);
</script>

{@render children(draft)}
<output data-create-values>{JSON.stringify(row)}</output>
<button {disabled} data-create-submit>Create</button>
