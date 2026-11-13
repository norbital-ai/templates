<script lang="ts">
	/** One family's rows of a law, as the law holds them on the chosen day. A row opens its own editor. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { highlighted_line, Table } from '@norbital-ai/ui';
	import type { JsonObject } from '../../payroll_engine/foundation.js';

	let {
		ctx,
		name,
		title,
		rows,
		columns,
		on_open,
		on_new
	}: {
		ctx: PageContext;
		/** The table's key in the URL. */
		name: string;
		title: string;
		rows: readonly JsonObject[];
		/** A field by name, or shown as the first line of its expression (`code`) or as compact JSON (`json`). */
		columns: readonly (string | { readonly field: string; readonly as: 'code' | 'json' })[];
		on_open: (code: string) => void;
		on_new: () => void;
	} = $props();

	const listed = $derived(
		rows.map((row): JsonObject & { readonly id: string } => ({ ...row, id: String(row.code) }))
	);
	const firstLine = (value: unknown): string =>
		String(value ?? '')
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line !== '' && line !== '// js' && !line.startsWith('//')) ?? '';
</script>

{#snippet codeCell({ value }: { value: unknown })}
	<code
		class="bg-muted block max-w-[18rem] truncate rounded-sm px-1.5 py-0.5 font-mono text-xs"
		data-cel
		>{#each highlighted_line(firstLine(value)) as token, i (i)}<span
				class={token.class || undefined}>{token.text}</span
			>{/each}</code
	>
{/snippet}

{#snippet jsonCell({ value }: { value: unknown })}
	<span class="block max-w-[18rem] truncate font-mono text-xs text-muted-foreground"
		>{JSON.stringify(value ?? {})}</span
	>
{/snippet}

<Table
	{ctx}
	of={listed}
	key={name}
	toolbar={{ new: on_new, title }}
	columns={columns.map((column) =>
		typeof column === 'string'
			? column
			: { field: column.field, cell: column.as === 'code' ? codeCell : jsonCell }
	)}
	on_open={(row) => on_open(row.id)}
/>
