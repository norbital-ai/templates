<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import CommercialSettingsForm from '../../lib/ui/commercial-settings-form.svelte';
</script>

{#snippet defaults()}
	<CommercialSettingsForm
		{ctx}
		fields={[
			'default_document_layout',
			'default_purchase_document_layout',
			'freight_treatment',
			'require_floor'
		]}
	/>
{/snippet}

{#snippet templates()}
	<Table
		{ctx}
		of="document_templates"
		columns={['title', 'locale', 'version', 'status']}
		toolbar={{ title: false }}
	/>
{/snippet}

<AppShell
	description={ctx.t('app.trade_configuration.description')}
	title={ctx.t('section.documents')}
	icon="lucide:file-text"
>
	<Tabs
		tabs={[
			{ name: 'defaults', title: ctx.t('section.defaults'), body: defaults },
			{ name: 'templates', title: ctx.t('models.document_templates.label'), body: templates }
		]}
	/>
</AppShell>
