<script lang="ts">
	import { bolt } from '$bolt';
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import RecordEditor, { optionalText, text, type Value } from '../../../lib/record-editor.svelte';
	let { view }: { view: CustomFieldView<'emergency_contact'> } = $props();
	function change(next: Value | null): void {
		if (view.mode === 'edit')
			view.onChange(
				next && {
					name: text(next['name']),
					phone: text(next['phone']),
					relationship: optionalText(next['relationship'])
				}
			);
	}
</script>

{#if view.mode === 'show'}
	<!-- shown: "Name · phone (relationship)" -->
	{#if view.value}<span class="text-sm"
			>{[view.value.name, view.value.phone]
				.filter(Boolean)
				.join(' · ')}{#if view.value.relationship}
				({view.value.relationship}){/if}</span
		>
	{:else}<span class="text-sm text-muted-foreground">—</span>{/if}
{:else}
	<RecordEditor
		value={view.value}
		disabled={view.disabled}
		onChange={change}
		parts={[
			{ key: 'name', label: bolt.t('component.name'), autocomplete: 'name' },
			{ key: 'phone', label: bolt.t('component.phone'), type: 'tel', autocomplete: 'tel' },
			{ key: 'relationship', label: bolt.t('component.relationship'), optional: true }
		]}
	/>
{/if}
