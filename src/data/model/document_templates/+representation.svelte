<script lang="ts">
	import { bolt } from '$bolt';
	import type { RecordView, FormState, FieldEditor } from '@norbital-ai/ui';
	import LongText from '../../../lib/ui/long-text.svelte';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	let {
		view
	}: {
		view: RecordView<'document_templates'>;
	} = $props();
	const published = $derived(view.mode !== 'create' && view.record.status === 'published');
</script>

{#snippet longText(_form: FormState, field: FieldEditor)}<LongText {field} />{/snippet}
{#snippet placeholders()}{#if !published}<p class="text-sm text-muted-foreground">
			{bolt.t('component.template_help')} <code>{'{agreement}'}</code> ·
			<code>{'{reference}'}</code>
			· <code>{'{title}'}</code> · <code>{'{version}'}</code>
		</p>{/if}{/snippet}
<RecordForm
	subtitle={['kind', 'locale', 'version']}
	editors={{ body: longText }}
	{view}
	readonly={published}
	sections={[
		{
			name: 'template',
			fields: ['kind', 'locale', 'version', 'title', 'body', 'status'],
			wide: ['body'],
			body: placeholders
		}
	]}
/>
