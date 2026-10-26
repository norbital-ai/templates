<script lang="ts">
	/**
	 * A catalogue row's form sections (inside its `Form`): two columns, short values side by side and expressions, prose
	 * and structured values across the row. Every CEL field, top-level or inside a json shape, declares `format: 'cel'`,
	 * which the platform edits as a code editor. A field's help is the catalog's `catalog.help.<field>` when it has one
	 * (plain words over the declaration's technical note); `views` render a field read-only.
	 */
	import * as Predicate from 'effect/Predicate';
	import type { Snippet } from 'svelte';
	import {
		Field,
		Section,
		Textarea,
		useBolt,
		type FieldEditor,
		type RecordSection
	} from '@norbital-ai/ui';
	import { Column, Columns } from '@norbital-ai/ui/layout';
	import { CEL_KEYS } from '../format/code_text.js';

	type FieldView = Pick<FieldEditor, 'value' | 'kind' | 'name' | 'id'>;
	let {
		sections,
		editors = {},
		views = {}
	}: {
		sections: readonly RecordSection[];
		editors?: Readonly<Record<string, Snippet<[FieldEditor]>>>;
		views?: Readonly<Record<string, Snippet<[FieldView]>>>;
	} = $props();
	const uiBolt = useBolt();

	const PROSE = new Set(['description']);
	const WIDE = new Set([
		...CEL_KEYS,
		'entitlement',
		'bands',
		'references',
		'counts_toward',
		'rules',
		'source_identity'
	]);
	const helpOf = (name: string) => {
		const key = `catalog.help.${name}`;
		const help = uiBolt.t(key);
		return help === key ? {} : { help };
	};
</script>

{#snippet prose(field: FieldEditor)}
	<Textarea
		id={field.id}
		rows={3}
		value={Predicate.isString(field.value) ? field.value : ''}
		disabled={field.disabled}
		oninput={(event) =>
			field.onChange(event.currentTarget.value === '' ? null : event.currentTarget.value)}
	/>
{/snippet}

{#each sections as section, at (section.name)}
	<!-- a section of one field is titled already; its field needs no second label -->
	{@const label = section.fields.length === 1 ? { label: '' } : {}}
	<Section
		first={at === 0}
		name={section.name}
		title={section.title ?? ''}
		defaultOpen={section.defaultOpen ?? true}
	>
		<Columns count={2} gap="md">
			{#each section.fields as name (name)}
				{@const view = views[name]}
				{@const own = { ...label, ...helpOf(name), ...(view ? { view } : {}) }}
				{#if editors[name]}
					<Column span="all"><Field {name} {...own} editor={editors[name]} /></Column>
				{:else if WIDE.has(name)}
					<Column span="all"><Field {name} {...own} /></Column>
				{:else if PROSE.has(name)}
					<Column span="all"><Field {name} {...own} editor={prose} /></Column>
				{:else}
					<Field {name} {...own} />
				{/if}
			{/each}
		</Columns>
	</Section>
{/each}
