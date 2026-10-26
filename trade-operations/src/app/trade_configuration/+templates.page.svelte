<script lang="ts">
	import { Field, type FormState } from '@norbital-ai/ui';
	import LongText from '../../lib/ui/long-text.svelte';
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import CreateTable from '../../lib/ui/create-table.svelte';
</script>

{#snippet templateFields(_form: FormState)}
	{#each ['kind', 'locale', 'version', 'title'] as name}<Field {name} />{/each}
	<p class="text-sm text-muted-foreground">
		{bolt.t('component.template_help')} <code>{'{agreement}'}</code> · <code>{'{reference}'}</code>
		· <code>{'{title}'}</code> · <code>{'{version}'}</code>
	</p>
	<Field name="body">{#snippet editor(field)}<LongText {field} />{/snippet}</Field>
{/snippet}
<AppShell
	title={bolt.t('models.document_templates.label')}
	description={bolt.t('app.trade_configuration.description')}
	icon="lucide:file-text"
	variant="full"
>
	<CreateTable
		of="document_templates"
		columns={['title', 'kind', 'locale', 'version', 'status']}
		createValues={{ body: '{agreement}' }}
		createFields={[]}
		createForm={templateFields}
	/>
</AppShell>
