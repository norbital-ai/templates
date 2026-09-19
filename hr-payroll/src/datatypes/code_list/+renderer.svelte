<script lang="ts">
	/**
	 * A code list as one line of chips. Editing is by text — codes separated by spaces or
	 * commas — which is all a scheme's `parts` needs; the class forms replace this with the
	 * scheme checklist (`lib/ui/counts-toward-field.svelte`).
	 */
	import { Result, Schema } from 'effect';
	import { Input } from '@norbital-ai/ui/input';
	import { codeListValueSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(codeListValueSchema)(props.value ?? []));
	const codes = $derived(Result.isSuccess(parsed) ? parsed.success : []);
	let draft = $state<string | null>(null);
	const text = $derived(draft ?? codes.join(' '));

	function commit(): void {
		if (props.mode !== 'edit') return;
		const next = (draft ?? '')
			.split(/[\s,]+/)
			.map((code) => code.trim().toUpperCase())
			.filter((code) => code !== '');
		props.onValueChange([...new Set(next)]);
		draft = null;
	}
</script>

{#if props.mode === 'display'}
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
