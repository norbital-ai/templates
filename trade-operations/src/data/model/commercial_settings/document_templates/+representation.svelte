<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView, FormState, FieldEditor } from '@norbital-ai/ui';
	import LongText from '../../../../lib/ui/long-text.svelte';
	import RecordForm from '../../../../lib/ui/record-form.svelte';
	let {
		view,
		ctx
	}: {
		view: RecordView<'document_templates'>;
		ctx: PageContext;
	} = $props();
	const published = $derived(view.mode !== 'create' && view.record.status === 'published');
</script>

{#snippet longText(_form: FormState, field: FieldEditor)}<LongText {field} />{/snippet}
{#snippet placeholders()}{#if !published}<p class="text-sm text-muted-foreground">
			{ctx.t('component.template_help')} <code>{'{agreement}'}</code> ·
			<code>{'{reference}'}</code>
			· <code>{'{title}'}</code> · <code>{'{version}'}</code>
		</p>
		<p class="text-sm text-muted-foreground">
			{ctx.t('component.print_layout_help')}
		</p>{/if}{/snippet}
<RecordForm
	{ctx}
	subtitle={['locale', 'version']}
	editors={{ body: longText }}
	{view}
	readonly={published}
	sections={[
		{
			name: 'template',
			fields: [
				'locale',
				'version',
				'title',
				'layout',
				'body',
				'print_layout',
				'print_fields',
				'letterhead',
				'contract_stamp',
				'status'
			],
			wide: ['body', 'print_layout', 'print_fields', 'letterhead', 'contract_stamp'],
			body: placeholders
		}
	]}
/>
