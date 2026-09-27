<script lang="ts">
	/**
	 * A code list as one line of chips. Editing is by text — codes separated by spaces or
	 * commas — which is all a scheme's `parts` needs; the class forms replace this with the
	 * scheme checklist (`lib/ui/counts-toward-field.svelte`).
	 */
	import { Input } from '@norbital-ai/ui';
	import type { CustomFieldView } from '@norbital-ai/ui';

	let { view }: { view: CustomFieldView<readonly string[]> } = $props();
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const codes = $derived(view.value ?? []);
	let draft = $state<string | null>(null);
	const text = $derived(draft ?? codes.join(' '));

	function commit(): void {
		if (view.mode !== 'edit') return;
		const next = (draft ?? '')
			.split(/[\s,]+/)
			.map((code) => code.trim().toUpperCase())
			.filter((code) => code !== '');
		view.onChange([...new Set(next)]);
		draft = null;
	}
</script>

{#if view.mode === 'show'}
	<span>{codes.join(' · ') || '—'}</span>
{:else}
	<Input
		value={text}
		{disabled}
		oninput={(event) => {
			draft = event.currentTarget.value;
		}}
		onblur={commit}
		onkeydown={(event) => {
			if (event.key === 'Enter') commit();
		}}
	/>
{/if}
