<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { Table } from '@norbital-ai/ui';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import CommercialSettingsForm from '../../lib/ui/commercial-settings-form.svelte';
</script>

<AppShell title={ctx.t('section.documents')} icon="lucide:file-text">
	<Stack size="fill" gap="lg">
		<div class="shrink-0">
			<CommercialSettingsForm
				{ctx}
				fields={[
					'default_document_layout',
					'default_purchase_document_layout',
					'freight_treatment',
					'require_floor'
				]}
			/>
		</div>
		<Table
			of="document_templates"
			columns={['title', 'locale', 'version', 'status']}
			toolbar={{ title: false }}
		/>
	</Stack>
</AppShell>
