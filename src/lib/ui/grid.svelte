<script lang="ts" module>
	import type { Component } from 'svelte';

	/** One row of an editable list-shaped value; `id` is the row's key while editing. */
	export type MatrixRow = Record<string, unknown>;
	/** A column's value kind: `text`, `number`, `boolean`, or `enum` over `values`. `options` rides to a cell renderer. */
	export type CollectionField = {
		readonly name: string;
		readonly kind: string;
		readonly nullable?: boolean;
		readonly values?: readonly string[];
		readonly options?: Readonly<Record<string, unknown>>;
	};
	export type MatrixCellRendererProps<TRow extends MatrixRow> = {
		field: CollectionField;
		value: unknown;
		row: TRow;
		mode: 'display' | 'edit';
		disabled: boolean;
		placeholder?: string | undefined;
		onValueChange: (value: unknown) => void;
	};
	export type MatrixColumn<TRow extends MatrixRow> = {
		key: keyof TRow & string;
		label: string;
		description?: string;
		field: CollectionField;
		width?: number;
		placeholder?: string;
		renderer?: Component<MatrixCellRendererProps<TRow>>;
	};
</script>

<script lang="ts" generics="TRow extends MatrixRow">
	/**
	 * An editable table over a list-shaped custom field value: one row per item, one typed input per column, a
	 * remove button per row and an add button. A column's `renderer` replaces the default input (an expression,
	 * a roster code). Every edit hands the whole next list to `onChange`.
	 */
	import InfoTip from './InfoTip.svelte';
	import { Button, cn, Combobox, Input } from '@norbital-ai/ui';
	import { Inline, Scroll } from '@norbital-ai/ui/layout';
	import type { Snippet } from 'svelte';

	let {
		rows = $bindable(),
		columns,
		disabled = false,
		readonly = false,
		allowAddRows = false,
		addRowLabel = '+',
		emptyMessage,
		createRow,
		onChange,
		rowDetails,
		removeRowLabel = 'Remove',
		class: className
	}: {
		rows: TRow[];
		columns: readonly MatrixColumn<TRow>[];
		disabled?: boolean;
		readonly?: boolean;
		allowAddRows?: boolean;
		addRowLabel?: string;
		emptyMessage?: string;
		createRow?: () => TRow;
		onChange?: (rows: TRow[]) => void;
		rowDetails?: Snippet<[TRow, number]>;
		removeRowLabel?: string;
		getRowId?: (row: TRow) => string;
		bounded?: boolean;
		class?: string;
	} = $props();

	const mode = $derived(readonly ? 'display' : 'edit');
	function commit(next: TRow[]): void {
		rows = next;
		onChange?.(next);
	}
	const set = (index: number, key: string, value: unknown) =>
		commit(rows.map((row, at) => (at === index ? { ...row, [key]: value } : row)));
	const shown = (value: unknown) => (value == null || value === '' ? '—' : String(value));
</script>

<Scroll
	axis="x"
	name={columns.map((column) => column.label).join(', ')}
	class={cn('w-full', className)}
>
	<table class="w-full border-collapse text-sm">
		<thead>
			<tr>
				{#each columns as column (column.key)}
					<th
						class="px-1 py-1 text-left text-xs font-medium text-muted-foreground"
						style:min-width={column.width ? `${column.width}px` : undefined}
					>
						<Inline gap="xs" align="center">
							{column.label}
							{#if column.description}<InfoTip label={column.label}>{column.description}</InfoTip
								>{/if}
						</Inline>
					</th>
				{/each}
				{#if mode === 'edit'}<th></th>{/if}
			</tr>
		</thead>
		<tbody>
			{#each rows as row, index (index)}
				<tr class="border-t">
					{#each columns as column (column.key)}
						{@const value = row[column.key]}
						<td class="px-1 py-1 align-top">
							{#if column.renderer}
								{@const Cell = column.renderer}
								<Cell
									field={column.field}
									{value}
									{row}
									{mode}
									{disabled}
									placeholder={column.placeholder}
									onValueChange={(next: unknown) => set(index, column.key, next)}
								/>
							{:else if mode === 'display'}
								<span class="block truncate">{shown(value)}</span>
							{:else if column.field.kind === 'boolean'}
								<input
									type="checkbox"
									checked={value === true}
									{disabled}
									aria-label={column.label}
									onchange={(event) => set(index, column.key, event.currentTarget.checked)}
								/>
							{:else if column.field.kind === 'enum'}
								<Combobox
									class="w-full"
									size="sm"
									aria-label={column.label}
									clearable={column.field.nullable ?? false}
									options={(column.field.values ?? []).map((option) => ({
										value: option,
										label: option.replace(/_/g, ' ')
									}))}
									value={value == null || value === '' ? null : String(value)}
									{disabled}
									onChange={(next) => set(index, column.key, next)}
								/>
							{:else if column.field.kind === 'number'}
								<Input
									class="h-8"
									type="number"
									value={value == null ? '' : String(value)}
									{disabled}
									placeholder={column.placeholder}
									aria-label={column.label}
									oninput={(event) => {
										const text = event.currentTarget.value;
										set(index, column.key, text === '' ? null : Number(text));
									}}
								/>
							{:else}
								<Input
									class="h-8"
									value={value == null ? '' : String(value)}
									{disabled}
									placeholder={column.placeholder}
									aria-label={column.label}
									oninput={(event) => set(index, column.key, event.currentTarget.value)}
								/>
							{/if}
						</td>
					{/each}
					{#if mode === 'edit'}
						<td class="px-1 py-1 align-top">
							<Button
								variant="ghost"
								size="sm"
								{disabled}
								aria-label={removeRowLabel}
								onclick={() => commit(rows.filter((_, at) => at !== index))}>×</Button
							>
						</td>
					{/if}
				</tr>
				{#if rowDetails}
					<tr
						><td colspan={columns.length + (mode === 'edit' ? 1 : 0)} class="px-1 pb-2">
							{@render rowDetails(row, index)}
						</td></tr
					>
				{/if}
			{/each}
		</tbody>
	</table>
	{#if rows.length === 0 && emptyMessage}<p class="text-sm text-muted-foreground">
			{emptyMessage}
		</p>{/if}
	{#if mode === 'edit' && allowAddRows && createRow}
		<Button variant="outline" size="sm" {disabled} onclick={() => commit([...rows, createRow()])}
			>{addRowLabel}</Button
		>
	{/if}
</Scroll>
