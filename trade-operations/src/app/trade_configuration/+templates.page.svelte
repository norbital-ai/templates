<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Id } from '@norbital-ai/bolt';
	let { ctx }: { ctx: PageContext } = $props();
	import { Badge, Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';

	// which template a new sales or purchase order starts with; a purchase order falls back to the sales one
	const settings = ctx.query({
		commercial_settings: { where: { code: { eq: 'default' } }, limit: 1 }
	});
	const current = $derived(settings.current?.commercial_settings.rows[0]);
	const sales = $derived(current?.default_document_layout ?? null);
	const purchase = $derived(current?.default_purchase_document_layout ?? sales);
	const use = (
		field: 'default_document_layout' | 'default_purchase_document_layout',
		template: Id<'document_templates'>
	) =>
		current
			? ctx.act({
					'commercial_settings.update': [
						{
							target: { id: current.id, revision: current.revision },
							set:
								field === 'default_document_layout'
									? { default_document_layout: template }
									: { default_purchase_document_layout: template }
						}
					]
				})
			: undefined;
</script>

{#snippet title({
	row,
	value
}: {
	row: { id: Id<'document_templates'> };
	value: string | undefined;
})}
	<span class="flex min-w-0 items-center gap-2"
		><span class="truncate">{value}</span>
		{#if row.id === sales}<Badge variant="info">{ctx.t('settings.layout.sales')}</Badge>{/if}
		{#if row.id === purchase}<Badge variant="info">{ctx.t('settings.layout.purchase')}</Badge
			>{/if}</span
	>
{/snippet}

<AppShell
	description={ctx.t('settings.documents.description')}
	title={ctx.t('section.documents')}
	icon="lucide:file-text"
>
	<Table
		{ctx}
		of="document_templates"
		columns={[{ field: 'title', cell: title }, 'locale', 'version', 'status']}
		actions={[
			{
				label: ctx.t('settings.layout.use_for_sales'),
				run: (row) => use('default_document_layout', row.id)
			},
			{
				label: ctx.t('settings.layout.use_for_purchase'),
				run: (row) => use('default_purchase_document_layout', row.id)
			}
		]}
		toolbar={{ title: false, description: ctx.t('settings.documents.help') }}
	/>
</AppShell>
