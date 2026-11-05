<script lang="ts">
	import { Table } from '@norbital-ai/ui';
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
</script>

<AppShell
	title={bolt.t('models.document_templates.label')}
	description={bolt.t('app.trade_configuration.description')}
	icon="lucide:file-text"
	variant="full"
>
	<Table of="document_templates" columns={['title', 'kind', 'locale', 'version', 'status']} />
</AppShell>
