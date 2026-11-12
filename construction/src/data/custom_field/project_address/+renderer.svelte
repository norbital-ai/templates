<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { UiContext } from '@norbital-ai/ui';
	import RecordEditor, { optionalText, text, type Value } from '../../../lib/record-editor.svelte';
	let {
		view,
		ctx
	}: {
		view: CustomFieldView<'project_address'>;
		ctx: UiContext & Partial<Pick<PageContext, 't'>>;
	} = $props();
	/** Outside a page (no translator) a part is named by its message key. */
	const t = (key: Parameters<PageContext['t']>[0]) => ctx.t?.(key) ?? key;
	function change(next: Value | null): void {
		if (view.mode === 'edit')
			view.on_change(
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
		on_change={change}
		parts={[
			{ key: 'line_1', label: t('component.address_line_1') },
			{ key: 'line_2', label: t('component.address_line_2'), optional: true },
			{ key: 'city', label: t('component.city') },
			{ key: 'state', label: t('component.state'), optional: true },
			{ key: 'postal_code', label: t('component.postal_code') },
			{ key: 'country', label: t('component.country') }
		]}
	/>
{/if}
