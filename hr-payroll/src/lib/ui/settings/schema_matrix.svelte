<script lang="ts">
	/**
	 * A JSON Schema object as an editable table, one layer deep: each property is a row of its name, type, enum values,
	 * whether it is required and its help (`description`). Rows add, remove and reorder. Nested objects and arrays name
	 * their kind and size instead of opening; every other keyword (title, format, bounds, default) passes through.
	 */
	import { bolt } from '$bolt';
	import { Button, Checkbox, Combobox, Icon, Input } from '@norbital-ai/ui';
	import { Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Option, Schema } from 'effect';
	import type { Json } from '@norbital-ai/ui';

	let {
		value,
		onChange,
		name,
		disabled = false
	}: {
		value: Json;
		onChange: (next: Json) => void;
		/** Names the table's scroll region; unique on the page. */
		name: string;
		disabled?: boolean;
	} = $props();
	const t = bolt.t;

	const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'] as const;
	type Type = (typeof TYPES)[number];
	type Node = Record<string, Json>;

	const asObject = (entry: unknown): Node | null =>
		Schema.is(Schema.Record(Schema.String, Schema.Json))(entry) ? entry : null;
	const isString = Schema.is(Schema.String);
	const toNumber = Schema.decodeUnknownOption(Schema.NumberFromString);
	const typeOf = (node: Node): Type | null => TYPES.find((type) => type === node['type']) ?? null;
	const root = $derived(asObject(value));
	const properties = $derived(root == null ? null : (asObject(root['properties']) ?? {}));
	const required = $derived.by((): readonly string[] => {
		const held = root?.['required'];
		return Array.isArray(held) ? held.filter(isString) : [];
	});
	const rows = $derived(
		Object.entries(properties ?? {}).map(([key, entry]) => {
			const node = asObject(entry) ?? {};
			const type = typeOf(node);
			const kids = Object.keys(asObject(node['properties']) ?? {}).length;
			const bounds = [node['minimum'], node['maximum']].map((b) => (b == null ? '' : String(b)));
			const notes = [
				type === 'object' ? t('schema_matrix.sub_properties', { count: kids }) : null,
				type === 'array' ? t('schema_matrix.sub_items') : null,
				isString(node['format']) ? node['format'] : null,
				bounds.some((b) => b !== '') ? `${bounds[0] || '…'} – ${bounds[1] || '…'}` : null
			].filter((note) => note != null);
			return {
				key,
				node,
				type,
				enumText: Array.isArray(node['enum']) ? node['enum'].map(String).join(', ') : '',
				help: isString(node['description']) ? node['description'] : '',
				notes: notes.join(' · '),
				required: required.includes(key)
			};
		})
	);

	const emit = (next: [string, Json][], requiredNext: readonly string[]) => {
		const out: Node = { ...(root ?? { type: 'object' }), properties: Object.fromEntries(next) };
		if (requiredNext.length > 0) out['required'] = [...requiredNext];
		else delete out['required'];
		onChange(out);
	};
	const entries = (): [string, Json][] => Object.entries(properties ?? {});
	const patch = (key: string, edit: (node: Node) => void) =>
		emit(
			entries().map(([held, entry]): [string, Json] => {
				if (held !== key) return [held, entry];
				const node = { ...(asObject(entry) ?? {}) };
				edit(node);
				return [held, node];
			}),
			required
		);
	const setType = (key: string, type: Type | null) =>
		type != null &&
		patch(key, (node) => {
			node['type'] = type;
			if (type === 'object') node['properties'] = asObject(node['properties']) ?? {};
			else delete node['properties'];
			if (type === 'array') node['items'] = asObject(node['items']) ?? {};
			else delete node['items'];
			if (type === 'boolean' || type === 'object' || type === 'array') delete node['enum'];
		});
	const setEnum = (key: string, text: string, type: Type | null) =>
		patch(key, (node) => {
			const values = text
				.split(',')
				.map((part) => part.trim())
				.filter((part) => part !== '');
			const numeric = type === 'number' || type === 'integer';
			if (values.length === 0) delete node['enum'];
			else
				node['enum'] = values.map((part) =>
					numeric ? Option.getOrElse(toNumber(part), () => part) : part
				);
		});
	const setHelp = (key: string, text: string) =>
		patch(key, (node) => {
			if (text.trim() === '') delete node['description'];
			else node['description'] = text.trim();
		});
	const setRequired = (key: string, on: boolean) =>
		emit(entries(), [...required.filter((name) => name !== key), ...(on ? [key] : [])]);
	const rename = (key: string, next: string) => {
		const name = next.trim();
		if (name === '' || name === key || (properties != null && name in properties)) return;
		emit(
			entries().map(([held, node]): [string, Json] => [held === key ? name : held, node]),
			required.map((held) => (held === key ? name : held))
		);
	};
	const move = (at: number, by: -1 | 1) => {
		const next = entries();
		const [row] = next.splice(at, 1);
		if (row === undefined) return;
		next.splice(at + by, 0, row);
		emit(next, required);
	};
	const remove = (key: string) =>
		emit(
			entries().filter(([held]) => held !== key),
			required.filter((held) => held !== key)
		);
	const add = () => {
		const names = new Set(Object.keys(properties ?? {}));
		let index = names.size + 1;
		while (names.has(`field_${index}`)) index += 1;
		emit([...entries(), [`field_${index}`, { type: 'string' }]], required);
	};
</script>

<Stack gap="sm">
	{#if rows.length > 0}
		<Scroll {name} axis="x" class="rounded-md border">
			<table class="w-full min-w-[46rem] table-fixed text-sm">
				<thead class="bg-muted/50 text-left text-muted-foreground">
					<tr>
						<th class="w-[22%] px-3 py-2 font-medium">{t('schema_matrix.property')}</th>
						<th class="w-[16%] px-3 py-2 font-medium">{t('schema_matrix.type')}</th>
						<th class="w-[18%] px-3 py-2 font-medium">{t('schema_matrix.enum')}</th>
						<th class="w-[5.5rem] px-3 py-2 font-medium">{t('schema_matrix.required')}</th>
						<th class="px-3 py-2 font-medium">{t('schema_matrix.help')}</th>
						<th class="w-[7.5rem] px-3 py-2"
							><span class="sr-only">{t('schema_matrix.order')}</span></th
						>
					</tr>
				</thead>
				<tbody>
					{#each rows as row, at (row.key)}
						<tr class="border-t align-top">
							<td class="px-2 py-1.5">
								<Input
									class="font-mono text-xs"
									value={row.key}
									{disabled}
									aria-label={t('schema_matrix.property')}
									onchange={(event) => rename(row.key, event.currentTarget.value)}
								/>
							</td>
							<td class="px-2 py-1.5">
								<Combobox
									options={TYPES.map((type) => ({ value: type, label: type }))}
									value={row.type}
									placeholder="—"
									{disabled}
									aria-label={t('schema_matrix.type')}
									onChange={(next) => setType(row.key, next)}
								/>
								{#if row.notes !== ''}<p class="text-meta px-1 pt-1">{row.notes}</p>{/if}
							</td>
							<td class="px-2 py-1.5">
								{#if row.type === 'string' || row.type === 'number' || row.type === 'integer'}
									<Input
										value={row.enumText}
										placeholder={t('schema_matrix.enum_placeholder')}
										{disabled}
										aria-label={t('schema_matrix.enum')}
										onchange={(event) => setEnum(row.key, event.currentTarget.value, row.type)}
									/>
								{/if}
							</td>
							<td class="px-3 py-1.5">
								<Inline align="center" class="h-9">
									<Checkbox
										checked={row.required}
										{disabled}
										aria-label={t('schema_matrix.required')}
										onCheckedChange={(on) => setRequired(row.key, on === true)}
									/>
								</Inline>
							</td>
							<td class="px-2 py-1.5">
								<Input
									value={row.help}
									{disabled}
									aria-label={t('schema_matrix.help')}
									title={row.help}
									onchange={(event) => setHelp(row.key, event.currentTarget.value)}
								/>
							</td>
							<td class="px-1 py-1.5">
								<Inline justify="end" gap="none">
									<Button
										variant="ghost"
										size="icon"
										aria-label={t('schema_matrix.move_up')}
										title={t('schema_matrix.move_up')}
										disabled={disabled || at === 0}
										onclick={() => move(at, -1)}
									>
										<Icon name="lucide:arrow-up" class="size-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label={t('schema_matrix.move_down')}
										title={t('schema_matrix.move_down')}
										disabled={disabled || at === rows.length - 1}
										onclick={() => move(at, 1)}
									>
										<Icon name="lucide:arrow-down" class="size-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label={t('schema_matrix.remove_property')}
										title={t('schema_matrix.remove_property')}
										{disabled}
										onclick={() => remove(row.key)}
									>
										<Icon name="lucide:trash-2" class="size-3.5" />
									</Button>
								</Inline>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Scroll>
	{/if}
	<Button variant="outline" size="sm" class="self-start" {disabled} onclick={add}>
		<Icon name="lucide:plus" class="size-4" />
		{t('schema_matrix.add_property')}
	</Button>
</Stack>
