<script lang="ts">
	/**
	 * The fields an input-schema object node declares, as a form over `value`: an `enum` is a choice of its values, a
	 * boolean a yes / no choice, a number, a date or text an input, a nested object its own group. Nothing is
	 * preselected; a cleared field is absent. Required fields (`requiredOf`) are marked.
	 */
	import { Combobox, DateInput, Input, Label } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import { isJsonObject, type JsonObject } from '../../payroll_engine/foundation.js';
	import { fieldsOf, requiredOf, type SchemaField } from './input_schema.js';
	import SchemaFields from './schema_fields.svelte';
	import { t } from '../i18n/t.js';

	let {
		node,
		value,
		onChange,
		skip = [],
		id,
		disabled = false
	}: {
		node: JsonObject | null;
		value: JsonObject;
		onChange: (next: JsonObject) => void;
		skip?: readonly string[];
		/** Prefixes each control's id; unique on the page. */
		id: string;
		disabled?: boolean;
	} = $props();

	const fields = $derived(fieldsOf(node, skip));
	const required = $derived(requiredOf(node, value));
	const toNumber = Schema.decodeUnknownOption(Schema.NumberFromString);

	function set(key: string, next: Schema.Json | undefined): void {
		const { [key]: _held, ...rest } = value;
		onChange(next === undefined || next === '' ? rest : { ...rest, [key]: next });
	}
	const options = (field: SchemaField) =>
		field.kind === 'boolean'
			? [
					{ value: 'true', label: t('component.yes') },
					{ value: 'false', label: t('component.no') }
				]
			: field.options.map((option) => ({ value: String(option), label: String(option) }));
	const choose = (field: SchemaField, next: string | null) =>
		set(
			field.key,
			next == null
				? undefined
				: field.kind === 'boolean'
					? next === 'true'
					: field.options.find((option) => String(option) === next)
		);
	const text = (held: Schema.Json | undefined) => (held == null ? '' : String(held));
</script>

{#each fields as field (field.key)}
	{@const control = `${id}-${field.key}`}
	{@const held = value[field.key]}
	<Stack gap="xs">
		<Label for={control}>{field.title}{required.includes(field.key) ? ' *' : ''}</Label>
		{#if field.description !== ''}
			<p class="line-clamp-2 text-xs text-muted-foreground" title={field.description}>
				{field.description}
			</p>
		{/if}
		{#if field.kind === 'object'}
			<Stack gap="sm">
				<SchemaFields
					node={field.node}
					value={isJsonObject(held) ? held : {}}
					onChange={(next) => set(field.key, Object.keys(next).length === 0 ? undefined : next)}
					id={control}
					{disabled}
				/>
			</Stack>
		{:else if field.kind === 'enum' || field.kind === 'boolean'}
			<Combobox
				id={control}
				class="w-full"
				clearable
				options={options(field)}
				value={held == null ? null : String(held)}
				placeholder={field.hint}
				{disabled}
				onChange={(next) => choose(field, next)}
			/>
		{:else if field.kind === 'date'}
			<DateInput
				id={control}
				of="date"
				value={held == null ? null : String(held)}
				{disabled}
				onChange={(next) => set(field.key, next ?? undefined)}
			/>
		{:else}
			<Input
				id={control}
				type={field.kind === 'number' ? 'number' : 'text'}
				value={text(held)}
				placeholder={field.hint}
				{disabled}
				onchange={(event: Event & { currentTarget: HTMLInputElement }) => {
					const raw = event.currentTarget.value.trim();
					if (field.kind !== 'number' || raw === '') return set(field.key, raw);
					const parsed = toNumber(raw);
					set(field.key, parsed._tag === 'Some' ? parsed.value : raw);
				}}
			/>
		{/if}
	</Stack>
{/each}
