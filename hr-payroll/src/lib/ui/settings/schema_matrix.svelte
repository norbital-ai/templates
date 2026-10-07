<script lang="ts">
	/**
	 * A JSON Schema object as a data matrix, one layer deep: each property is a row of its key, its type
	 * and whether it is required. Nested objects and arrays name their kind and size instead of opening.
	 * Titles and sibling keywords pass through untouched.
	 */
	import { bolt } from '$bolt';
	import { Button, Checkbox, Combobox, Icon, Input } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import type { Json } from '@norbital-ai/ui';

	let {
		value,
		onChange,
		disabled = false
	}: {
		value: Json;
		onChange: (next: Json) => void;
		disabled?: boolean;
	} = $props();
	const t = bolt.t;

	const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'] as const;
	type PropRow = {
		key: string;
		node: Record<string, Json>;
		type: string;
		sub: string | null;
		required: boolean;
	};

	const asObject = (entry: unknown): Record<string, Json> | null =>
		Schema.is(Schema.Record(Schema.String, Schema.Json))(entry) ? entry : null;
	const comboboxType = (raw: string): (typeof TYPES)[number] | null => {
		for (const allowed of TYPES) if (allowed === raw) return allowed;
		return null;
	};
	const root = $derived(asObject(value));
	const properties = $derived(root == null ? null : (asObject(root['properties']) ?? {}));
	const required = $derived.by((): readonly string[] => {
		if (root == null) return [];
		const held = root['required'];
		return Array.isArray(held)
			? held.filter((entry): entry is string => Schema.is(Schema.String)(entry))
			: [];
	});
	const rows = $derived<readonly PropRow[]>(
		properties == null
			? []
			: Object.entries(properties).map(([key, entry]) => {
					const node = asObject(entry) ?? {};
					const raw = Schema.is(Schema.String)(node['type']) ? node['type'] : null;
					const props = raw === 'object' ? asObject(node['properties']) : null;
					const kids = props != null ? Object.keys(props) : [];
					return {
						key,
						node,
						type: raw ?? (Array.isArray(node['enum']) ? 'enum' : kids.length > 0 ? 'object' : '—'),
						sub:
							raw === 'object'
								? t('schema_matrix.sub_properties', { count: kids.length })
								: raw === 'array'
									? t('schema_matrix.sub_items')
									: Array.isArray(node['enum'])
										? node['enum'].map((option) => String(option)).join(', ')
										: null,
						required: required.includes(key)
					};
				})
	);

	const emit = (propertiesNext: Record<string, Json>, requiredNext: readonly string[]) => {
		const next: Record<string, Json> = { ...(root ?? {}), properties: propertiesNext };
		if (requiredNext.length > 0) next['required'] = [...requiredNext];
		else delete next['required'];
		onChange(next);
	};
	const setType = (key: string, type: string | null) => {
		if (properties == null || type == null) return;
		const node = { ...(asObject(properties[key]) ?? {}) };
		node['type'] = type;
		if (type === 'object') {
			if (asObject(node['properties']) == null) node['properties'] = {};
			delete node['items'];
		} else if (type === 'array') {
			if (asObject(node['items']) == null) node['items'] = {};
			delete node['properties'];
		} else {
			delete node['properties'];
			delete node['items'];
		}
		emit({ ...properties, [key]: node }, required);
	};
	const setRequired = (key: string, on: boolean) => {
		if (properties == null) return;
		emit(
			properties,
			on
				? [...required.filter((name) => name !== key), key]
				: required.filter((name) => name !== key)
		);
	};
	const rename = (key: string, next: string) => {
		if (properties == null) return;
		const name = next.trim();
		if (name === '' || name === key || name in properties) return;
		const entries: [string, Json][] = [];
		for (const [held, node] of Object.entries(properties)) {
			entries.push([held === key ? name : held, node]);
		}
		emit(
			Object.fromEntries(entries),
			required.map((held) => (held === key ? name : held))
		);
	};
	const remove = (key: string) => {
		if (properties == null) return;
		emit(
			Object.fromEntries(Object.entries(properties).filter(([held]) => held !== key)),
			required.filter((held) => held !== key)
		);
	};
	const add = () => {
		const names = new Set(Object.keys(properties ?? {}));
		let index = Object.keys(properties ?? {}).length + 1;
		while (names.has(`field-${index}`)) index += 1;
		emit({ ...(properties ?? {}), [`field-${index}`]: { type: 'string' } }, required);
	};
	const initialize = () => onChange({ type: 'object', properties: {} });
</script>

{#if properties == null}
	<Button variant="outline" size="sm" {disabled} onclick={add}>
		<Icon name="lucide:plus" class="size-4" />
		{t('schema_matrix.add_property')}
	</Button>
{:else}
	<Stack gap="sm">
		<Grid tracks="minmax(0, 3fr) minmax(0, 2fr) auto auto" gap="xs">
			<span class="text-meta">{t('schema_matrix.property')}</span>
			<span class="text-meta">{t('schema_matrix.type')}</span>
			<span class="text-meta">{t('schema_matrix.required')}</span>
			<span></span>
			{#each rows as row (row.key)}
				<Input
					value={row.key}
					{disabled}
					aria-label={t('schema_matrix.property')}
					onchange={(event) => rename(row.key, event.currentTarget.value)}
				/>
				<Stack gap="none">
					<Combobox
						options={TYPES.map((type) => ({ value: type, label: type }))}
						value={comboboxType(row.type)}
						placeholder={row.type}
						{disabled}
						onChange={(next) => setType(row.key, next)}
					/>
					{#if row.sub != null}<span class="text-meta">{row.sub}</span>{/if}
				</Stack>
				<Checkbox
					checked={row.required}
					{disabled}
					aria-label={t('schema_matrix.required')}
					onCheckedChange={(on) => setRequired(row.key, on === true)}
				/>
				<Button
					variant="ghost"
					size="icon"
					aria-label={t('schema_matrix.remove_property')}
					title={t('schema_matrix.remove_property')}
					{disabled}
					onclick={() => remove(row.key)}
				>
					<Icon name="lucide:trash-2" class="size-4" />
				</Button>
			{/each}
		</Grid>
		<Button variant="outline" size="sm" {disabled} onclick={add}>
			<Icon name="lucide:plus" class="size-4" />
			{t('schema_matrix.add_property')}
		</Button>
	</Stack>
{/if}
