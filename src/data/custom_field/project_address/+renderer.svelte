<script lang="ts">
	import { bolt } from '$bolt';
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import RecordEditor, { optionalText, text, type Value } from '../../../lib/record-editor.svelte';
	let { view }: { view: CustomFieldView<'project_address'> } = $props();
	function change(next: Value | null): void {
		if (view.mode === 'edit')
			view.onChange(
				next && {
					line_1: text(next['line_1']),
					line_2: optionalText(next['line_2']),
					city: text(next['city']),
					state: optionalText(next['state']),
					postal_code: text(next['postal_code']),
					country: text(next['country'])
				}
			);
	}
	const parts = ['line_1', 'line_2', 'city', 'state', 'postal_code', 'country'] as const;
</script>

{#if view.mode === 'show'}
	<!-- shown: the address on one line -->
	{#if view.value}<span class="text-sm"
			>{parts
				.map((part) => view.value?.[part])
				.filter(Boolean)
				.join(', ')}</span
		>
	{:else}<span class="text-sm text-muted-foreground">—</span>{/if}
{:else}
	<RecordEditor
		value={view.value}
		disabled={view.disabled}
		onChange={change}
		parts={[
			{ key: 'line_1', label: bolt.t('component.address_line_1') },
			{ key: 'line_2', label: bolt.t('component.address_line_2'), optional: true },
			{ key: 'city', label: bolt.t('component.city') },
			{ key: 'state', label: bolt.t('component.state'), optional: true },
			{ key: 'postal_code', label: bolt.t('component.postal_code') },
			{ key: 'country', label: bolt.t('component.country') }
		]}
	/>
{/if}
