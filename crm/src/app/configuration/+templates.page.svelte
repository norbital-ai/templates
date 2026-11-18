<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, RecordShell, Sheet, Table } from '@norbital-ai/ui';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	let signatory = $state(false);
	const settings = $derived(signatory ? ctx.query({ agreement_settings: { limit: 1 } }) : null);
	const signer = $derived(settings?.current?.agreement_settings.rows[0] ?? null);
</script>

<AppShell
	icon="lucide:files"
	title={t('crm.section.templates')}
	description={ctx.t('templates.description')}
	variant="full"
>
	<Table
		{ctx}
		of="template_documents"
		toolbar={{
			title: false,
			select: true,
			actions: [
				{
					name: t('configuration.signatory'),
					icon: 'lucide:pen-line',
					run: () => {
						signatory = true;
					}
				}
			]
		}}
		order_by={{ version: 'desc' }}
		columns={['title', 'key', 'kind', 'scope', 'commitment', 'version']}
	/>
</AppShell>
<Sheet
	open={signatory}
	on_open_change={(open) => (signatory = open)}
	title={t('configuration.signatory')}
>
	{#if settings?.error}<EmptyState title={settings.error.message} />
	{:else if settings?.current !== undefined}{#key signer?.id ?? 'new'}<RecordShell
				{ctx}
				of="agreement_settings"
				{...signer === null ? { mode: 'create' as const } : { id: signer.id }}
				fields={[
					'provider_company',
					'provider_uen',
					'provider_address',
					'provider_signatory_name',
					'provider_signatory_title',
					'provider_signature'
				]}
				on_done={() => (signatory = false)}
			/>{/key}{/if}
</Sheet>
