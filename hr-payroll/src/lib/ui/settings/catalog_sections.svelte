<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Field, Section, type FieldEditor, type RecordSection } from '@norbital-ai/ui';
	import { Columns, Column } from '@norbital-ai/ui/layout';
	let {
		sections,
		editors = {},
		views = {}
	}: {
		sections: readonly RecordSection[];
		editors?: Readonly<Record<string, Snippet<[FieldEditor]>>>;
		views?: Readonly<
			Record<string, Snippet<[Pick<FieldEditor, 'value' | 'kind' | 'name' | 'id'>]>>
		>;
	} = $props();
	const wide = new Set(['references', 'reads', 'value', 'description', 'validate', 'effects']);
</script>

{#each sections as section, at (section.name)}
	<Section
		first={at === 0}
		name={section.name}
		title={section.title ?? ''}
		icon={section.icon}
		defaultOpen={section.defaultOpen ?? true}
	>
		<Columns count={2} gap="md">
			{#each section.fields as name (name)}
				{#if wide.has(name) || editors[name] || views[name]}<Column span="all"
						><Field
							{name}
							{...editors[name] ? { editor: editors[name] } : {}}
							{...views[name] ? { view: views[name] } : {}}
						/></Column
					>
				{:else}<Field {name} />{/if}
			{/each}
		</Columns>
	</Section>
{/each}
