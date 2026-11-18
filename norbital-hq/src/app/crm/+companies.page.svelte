<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Form, Sheet, Table, use_act } from '@norbital-ai/ui';
	import DocumentPreviewSheet from '../../lib/DocumentPreviewSheet.svelte';
	import { latestByKey } from '../../lib/documents.js';

	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const act = use_act(ctx);
	let panel = $state<'import' | 'cohorts' | null>(null);
	let exportTarget = $state<{ company: Id<'companies'>; key: string } | null>(null);
	let exportOpen = $state(false);

	const catalogue = ctx.query({
		template_documents: {
			where: { kind: { eq: 'document' }, scope: { eq: 'company' } },
			fields: ['title', 'key', 'version']
		}
	});
	const exportTemplates = $derived(latestByKey(catalogue.current?.template_documents.rows ?? []));
</script>

<AppShell
	icon="lucide:building-2"
	title={t('companies.title')}
	description={t('companies.description')}
>
	<Table
		{ctx}
		of="companies"
		order_by={{ name: 'asc' }}
		columns={['name', 'stage', 'owner', 'domain', 'cohort_memberships', 'follow_up_days']}
		toolbar={{
			title: false,
			actions: [
				{
					icon: 'lucide:sparkles',
					name: t('lead.research_sweep'),
					run: (ids: readonly Id<'companies'>[]) => {
						act.run(
							ctx.run('research_lead', ids.length > 0 ? { companies: [...ids], force: true } : {})
						);
					}
				},
				{
					icon: 'lucide:upload',
					name: t('leads.import'),
					run: () => {
						panel = 'import';
					}
				},
				{
					icon: 'lucide:users-round',
					name: t('cohorts.title'),
					run: () => {
						panel = 'cohorts';
					}
				},
				...exportTemplates.map((template) => ({
					icon: 'lucide:file-down',
					name: t('documents.export_named', { title: template.title }),
					requires_selection: true as const,
					disabled: (ids: readonly Id<'companies'>[]) =>
						ids.length === 1 ? null : t('crm.select_one_company'),
					run: (ids: readonly Id<'companies'>[]) => {
						const company = ids[0];
						if (company === undefined) return;
						exportTarget = { company, key: template.key };
						exportOpen = true;
					}
				}))
			]
		}}
	/>
</AppShell>

{#if exportTarget !== null}
	<DocumentPreviewSheet
		{ctx}
		company={exportTarget.company}
		templateKey={exportTarget.key}
		bind:open={exportOpen}
	/>
{/if}

<Sheet
	open={panel !== null}
	on_open_change={(open) => !open && (panel = null)}
	title={t(panel === 'cohorts' ? 'cohorts.title' : 'leads.import')}
>
	{#if panel === 'import'}
		<Form {ctx} of={{ automation: 'import_leads' }} fields={['file', 'owner']} />
	{:else if panel === 'cohorts'}
		<Table
			{ctx}
			of="cohorts"
			order_by={{ created_at: 'desc' }}
			columns={['name', 'sequence', 'status', 'member_count', 'replied_count', 'meeting_count']}
			toolbar={{ title: false }}
		/>
	{/if}
</Sheet>
