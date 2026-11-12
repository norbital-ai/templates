<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import RecordEditor, { optionalText, text, type Value } from '../../../lib/record-editor.svelte';
	let { view, ctx }: { view: CustomFieldView<'emergency_contact'>; ctx: PageContext | undefined } =
		$props();
	/** Outside a page (no context) a part is named by its message key. */
	const t = (key: Parameters<PageContext['t']>[0]) => ctx?.t(key) ?? key;
	function change(next: Value | null): void {
		if (view.mode === 'edit')
			view.on_change(
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
		on_change={change}
		parts={[
			{ key: 'name', label: t('component.name'), autocomplete: 'name' },
			{ key: 'phone', label: t('component.phone'), type: 'tel', autocomplete: 'tel' },
			{ key: 'relationship', label: t('component.relationship'), optional: true }
		]}
	/>
{/if}
