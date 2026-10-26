<script lang="ts">
	import type { RecordView, FormState, FieldEditor } from '@norbital-ai/ui';
	import LongText from '../../../lib/ui/long-text.svelte';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	let {
		view
	}: {
		view: RecordView<'document_templates'>;
	} = $props();
</script>

{#snippet longText(_form: FormState, field: FieldEditor)}<LongText {field} />{/snippet}
<RecordForm
	subtitle={['kind', 'locale', 'version']}
	editors={{ body: longText }}
	{view}
	readonly={view.mode !== 'create' && view.record.status === 'published'}
	sections={[
		{
			name: 'template',
			fields: ['kind', 'locale', 'version', 'title', 'body', 'status'],
			wide: ['body']
		}
	]}
/>
