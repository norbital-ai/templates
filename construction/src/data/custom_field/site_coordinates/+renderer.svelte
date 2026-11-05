<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import RecordEditor, { number, type Value } from '../../../lib/record-editor.svelte';
	let { view }: { view: CustomFieldView<'site_coordinates'> } = $props();
	function change(next: Value | null): void {
		if (view.mode === 'edit')
			view.onChange(next && { x: number(next['x']), y: number(next['y']), z: number(next['z']) });
	}
	const axes = ['x', 'y', 'z'] as const;
</script>

{#if view.mode === 'show'}
	<!-- shown: "X 12.5 · Y 3 · Z 0", an unset axis left out -->
	{#if view.value}<span class="text-sm tabular-nums"
			>{axes
				.filter((axis) => view.value?.[axis] != null)
				.map((axis) => `${axis.toUpperCase()} ${view.value?.[axis]}`)
				.join(' · ')}</span
		>
	{:else}<span class="text-sm text-muted-foreground">—</span>{/if}
{:else}
	<RecordEditor
		value={view.value}
		disabled={view.disabled}
		onChange={change}
		parts={axes.map((key) => ({
			key,
			label: key.toUpperCase(),
			type: 'number' as const,
			optional: true as const
		}))}
	/>
{/if}
