<script lang="ts">
	/**
	 * A registered rule's or effect's reads: one layer per model, each edited with the toolbar's own filter editor over
	 * that model, a row limit and the fields it keeps. A layer's filter uses the target collection's variables.
	 */
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import {
		Button,
		Combobox,
		FilterEditor,
		Input,
		type FilterVariables,
		type UiContext,
		type Value,
		value_object
	} from '@norbital-ai/ui';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import { JsonObject } from '../../../lib/payroll_engine/contracts.js';
	import ReadsView from '../../../lib/ui/settings/reads_view.svelte';

	type Layer = {
		readonly where?: JsonObject;
		readonly limit?: number;
		readonly fields?: readonly string[];
	};

	let { view, ctx }: { view: CustomFieldView<'reads'>; ctx: UiContext } = $props();
	const models = $derived(Object.keys(ctx.ui.kinds.catalog ?? {}).toSorted());
	const record = $derived(value_object(view.value) ? view.value : {});
	const entries = $derived(
		Object.entries(record).map(([name, value]) => [name, layerOf(value)] as const)
	);
	const variables: FilterVariables = {
		presets: [
			'ctx.entry.id',
			'ctx.entry.entity_id',
			'ctx.entry.employment_id',
			'ctx.entry.employee_id',
			'ctx.entry.catalog_code',
			'ctx.entry.period',
			'ctx.entry.payroll_run_id',
			'ctx.subject.employment.id',
			'ctx.subject.employment.employee_id',
			'ctx.subject.employment.entity_id'
		],
		validate: (text) =>
			text.trim().startsWith('ctx.') ? undefined : 'A variable names a ctx.… fact.'
	};
	const asJson = (value: unknown): JsonObject => Schema.decodeUnknownSync(JsonObject)(value);
	function layerOf(value: Value): Layer {
		if (!value_object(value)) return {};
		const where = value['where'];
		const limit = value['limit'];
		const fields = value['fields'];
		return {
			...(value_object(where) ? { where: asJson(where) } : {}),
			...(typeof limit === 'number' ? { limit } : {}),
			...(Array.isArray(fields) ? { fields: fields.map(String) } : {})
		};
	}
	/** The filter editor writes a flat object; a lone `and` is flattened so a batch can gather it into one read. */
	function flat(where: unknown): JsonObject {
		if (!value_object(where)) return {};
		const keys = Object.keys(where);
		const only = keys[0] === 'and' && keys.length === 1 ? where['and'] : null;
		const flat =
			Array.isArray(only) && only.length === 1 && value_object(only[0]) ? only[0] : where;
		return asJson(flat);
	}
	function commit(rows: readonly (readonly [string, Layer])[]) {
		if (view.mode === 'edit') view.on_change(Object.fromEntries(rows));
	}
	const edit = (model: string, next: { readonly where?: unknown }) =>
		commit(
			entries.map(([name, value]) => [
				name,
				name === model ? { ...value, where: flat(next.where) } : value
			])
		);
	const set = (model: string, key: 'limit' | 'fields', next: number | readonly string[]) =>
		commit(
			entries.map(([name, value]) => [name, name === model ? { ...value, [key]: next } : value])
		);
	const rename = (from: string, to: string) => {
		if (to === from || entries.some(([name]) => name === to)) return;
		commit(entries.map(([name, value]) => [name === from ? to : name, value]));
	};
	const remove = (model: string) => commit(entries.filter(([name]) => name !== model));
	const add = (model: string | null) => {
		if (model === null) return;
		commit([...entries, [model, { where: {}, limit: 100 }]]);
	};
	const unused = $derived(models.filter((model) => !entries.some(([name]) => name === model)));
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const id = (name: string, part: string) => `reads-${name}-${part}`;
</script>

{#if view.mode === 'show'}
	<ReadsView {ctx} value={view.value} />
{:else}
	<Stack gap="sm">
		{#each entries as [model, value], index (model)}
			<div class="rounded-md border p-2">
				<Inline gap="sm" class="items-center">
					<Combobox
						id={id(String(index), 'model')}
						{disabled}
						value={model}
						options={models.map((name) => ({ value: name, label: name }))}
						display={model}
						on_change={(next) => next !== null && rename(model, next)}
					/>
					<Input
						id={id(String(index), 'limit')}
						type="number"
						min="1"
						{disabled}
						value={value.limit ?? 100}
						aria-label={`${model} row limit`}
						oninput={(event) => set(model, 'limit', Number(event.currentTarget.value))}
					/>
					<Button
						variant="ghost"
						size="icon"
						{disabled}
						aria-label={`Remove ${model}`}
						onclick={() => remove(model)}
					>
						×
					</Button>
				</Inline>
				<FilterEditor
					{ctx}
					{model}
					value={{ where: value.where ?? {} }}
					readonly={disabled}
					{variables}
					on_change={(next) => edit(model, next)}
				/>
				<Input
					id={id(String(index), 'fields')}
					{disabled}
					value={(value.fields ?? []).join(', ')}
					placeholder="Fields (comma separated)"
					aria-label={`${model} fields`}
					oninput={(event) =>
						set(
							model,
							'fields',
							event.currentTarget.value
								.split(',')
								.map((field) => field.trim())
								.filter((field) => field !== '')
						)}
				/>
			</div>
		{/each}
		{#if !disabled}
			<Combobox
				id="reads-add"
				value={null}
				options={unused.map((model) => ({ value: model, label: model }))}
				placeholder="Add a model to read"
				searchable
				on_change={add}
			/>
		{/if}
	</Stack>
{/if}
