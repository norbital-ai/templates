<script lang="ts">
	/**
	 * A catalogue row's form sections (inside its `Form`): two columns, short values side by side and expressions, prose
	 * and structured values across the row. Every CEL field, top-level or inside a json shape, declares `format: 'cel'`,
	 * which the platform edits as a code editor.
	 */
	import * as Predicate from 'effect/Predicate';
	import { Field, Section, Textarea, type FieldEditor, type RecordSection } from '@norbital-ai/ui';
	import { Column, Columns } from '@norbital-ai/ui/layout';
	import { CEL_KEYS } from '../format/code_text.js';

	let { sections }: { sections: readonly RecordSection[] } = $props();

	const PROSE = new Set(['authority', 'description']);
	const CODE = new Set([...CEL_KEYS, 'entitlement', 'bands']);
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
	<Section first={at === 0} name={section.name} title={section.title ?? ''}>
		<Columns count={2} gap="md">
			{#each section.fields as name (name)}
				{#if CODE.has(name)}
					<Column span="all"><Field {name} {...label} /></Column>
				{:else if PROSE.has(name)}
					<Column span="all"><Field {name} {...label} editor={prose} /></Column>
				{:else}
					<Field {name} {...label} />
				{/if}
			{/each}
		</Columns>
	</Section>
{/each}
