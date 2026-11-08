<script lang="ts">
	import { bolt } from '$bolt';
	import { Schema } from 'effect';
	import { Input, Textarea } from '@norbital-ai/ui';
	import type { Id } from '@norbital-ai/bolt';
	import { PrintValues, printValueLimit, orderedPrintValues } from '../print-details.js';

	let {
		layout,
		scope,
		value,
		onChange,
		id,
		disabled = false
	}: {
		layout: Id<'document_templates'> | null | undefined;
		scope: 'order' | 'line';
		value: unknown;
		onChange?: (value: typeof PrintValues.Type) => void;
		id?: string;
		disabled?: boolean;
	} = $props();

	const fallbackId = $props.id();
	const selection = $derived(
		layout
			? bolt.query({
					document_templates: {
						where: { id: { eq: layout }, status: { eq: 'published' } },
						fields: ['print_fields'],
						limit: 1
					}
				})
			: null
	);
	const fields = $derived(
		selection?.current?.document_templates.rows[0]?.print_fields?.filter(
			(f) => f.scope === scope
		) ?? []
	);
	const values = $derived(Schema.is(PrintValues)(value) ? value : []);
	const saved = $derived(new Map(values.map(({ key, value }) => [key, value])));

	function change(key: string, value: string) {
		onChange?.(
			orderedPrintValues([...values.filter((entry) => entry.key !== key), { key, value }])
		);
	}
</script>

{#if fields.length}
	<div class="grid gap-3 sm:grid-cols-2">
		{#each fields as field (field.key)}
			{@const fieldId = `${id ?? fallbackId}-${field.key}`}
			{@const text = saved.get(field.key) ?? field.default_value ?? ''}
			<div class="min-w-0 space-y-1">
				{#if onChange}
					<label for={fieldId} class="block text-xs font-medium text-muted-foreground"
						>{field.label}</label
					>
					{#if field.multiline}
						<Textarea
							id={fieldId}
							value={text}
							maxlength={printValueLimit}
							rows={3}
							{disabled}
							oninput={(event) => change(field.key, event.currentTarget.value)}
						/>
					{:else}
						<Input
							id={fieldId}
							value={text}
							maxlength={printValueLimit}
							{disabled}
							oninput={(event) => change(field.key, event.currentTarget.value)}
						/>
					{/if}
				{:else}
					<div class="text-xs font-medium text-muted-foreground">{field.label}</div>
					<p class="whitespace-pre-wrap break-words text-sm">{text || '—'}</p>
				{/if}
			</div>
		{/each}
	</div>
{:else if onChange}
	<p class="text-sm text-muted-foreground">{bolt.t('component.no_print_details')}</p>
{:else}
	<span class="text-muted-foreground">—</span>
{/if}
