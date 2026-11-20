<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Schema } from 'effect';
	import { Combobox, Input, Textarea } from '@norbital-ai/ui';
	import type { Id } from '@norbital-ai/bolt';
	import {
		PrintValues,
		printChoices,
		printValueLimit,
		orderedPrintValues
	} from '../print-details.js';

	let {
		layout,
		scope,
		value,
		on_change,
		id,
		disabled = false,
		ctx
	}: {
		layout: Id<'document_templates'> | null | undefined;
		scope: 'order' | 'line';
		value: unknown;
		on_change?: (value: typeof PrintValues.Type) => void;
		id?: string;
		disabled?: boolean;
		ctx: PageContext;
	} = $props();

	const fallbackId = $props.id();
	const selection = $derived(
		layout
			? ctx.query({
					document_templates: {
						where: { id: { eq: layout }, status: { eq: 'published' } },
						fields: ['print_fields', 'locale'],
						limit: 1
					}
				})
			: null
	);
	const template = $derived(selection?.current?.document_templates.rows[0]);
	const fields = $derived(template?.print_fields?.filter((f) => f.scope === scope) ?? []);
	// a reader of another language than the layout's sees its translations; the document prints the values
	const translated = $derived(
		Boolean(template) && (ctx.locale.startsWith('zh') ? 'zh' : 'en') !== template?.locale
	);
	const label = (field: (typeof fields)[number]) =>
		(translated && field.translation) || field.label;
	const shown = (field: (typeof fields)[number], text: string) =>
		(translated && printChoices(field).find(({ value }) => value === text)?.translation) || text;
	const values = $derived(Schema.is(PrintValues)(value) ? value : []);
	const saved = $derived(new Map(values.map(({ key, value }) => [key, value])));

	function change(key: string, value: string) {
		on_change?.(
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
				{#if on_change}
					<label for={fieldId} class="block text-xs font-medium text-muted-foreground"
						>{label(field)}</label
					>
					{#if printChoices(field).length}
						<Combobox
							id={fieldId}
							options={printChoices(field).map(({ value, translation }) => ({
								value,
								label: translated ? translation : value
							}))}
							value={text}
							{disabled}
							on_change={(value) => change(field.key, value ?? '')}
						/>
					{:else if field.multiline}
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
					<div class="text-xs font-medium text-muted-foreground">{label(field)}</div>
					<p class="whitespace-pre-wrap break-words text-sm">{shown(field, text) || '—'}</p>
				{/if}
			</div>
		{/each}
	</div>
{:else if on_change}
	<p class="text-sm text-muted-foreground">{ctx.t('component.no_print_details')}</p>
{:else}
	<span class="text-muted-foreground">—</span>
{/if}
