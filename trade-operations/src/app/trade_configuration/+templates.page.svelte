<script lang="ts">
	import { Table } from '@norbital-ai/ui';
	import { bolt } from '$bolt';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import CommercialSettingsForm from '../../lib/ui/commercial-settings-form.svelte';
</script>

<AppShell title={bolt.t('section.documents')} icon="lucide:file-text">
	<Stack size="fill" gap="lg">
		<div class="shrink-0">
			<CommercialSettingsForm
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
