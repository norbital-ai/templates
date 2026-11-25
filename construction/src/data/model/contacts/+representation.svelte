<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Field,
		Form,
		RecordForm,
		RecordShell,
		type RecordView,
		Section,
		Table
	} from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'contacts'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const id = $derived(record?.id);
</script>

{#snippet partnerSections()}
	<Section icon="lucide:handshake" first name="contact" title={t('section.contact')}>
		<Grid minimum="card">
			<Field {ctx} name="company_name" />
			<Field {ctx} name="full_name" />
			<Field {ctx} name="role" />
			<Field {ctx} name="trade_specialty" />
			<Field {ctx} name="status" />
			<Field {ctx} name="registration_no" />
			<Field {ctx} name="payment_terms_days" />
		</Grid>
	</Section>
	<Section icon="lucide:message-circle" name="channels" title={t('section.messaging_handles')}>
		<Grid minimum="card">
			<Field {ctx} name="phone" />
			<Field {ctx} name="email" />
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>
{/snippet}

{#snippet ordersTab()}
	{#if id}
		<Table
			{ctx}
			of="contracts"
			key={`partner:contracts:${id}`}
			where={{ contact_id: { eq: id } }}
			order_by={{ updated_at: 'desc' }}
			toolbar={{ title: t('partners.orders_tab'), new: false }}
			columns={[
				'contract_number',
				'title',
				'direction',
				'contract_type',
				'project_id',
				'status',
				'contract_value'
			]}
		/>
	{/if}
{/snippet}

{#snippet transactionsTab()}
	{#if id}
		<Table
			{ctx}
			of="commercial_documents"
			key={`partner:docs:${id}`}
			where={{ contact_id: { eq: id } }}
			order_by={{ issue_date: 'desc' }}
			toolbar={{ title: t('partners.transactions_tab'), new: false }}
			columns={[
				'document_number',
				'doc_type',
				'direction',
				'external_reference',
				'project_id',
				'status',
				'total_amount',
				'due_date'
			]}
		/>
	{/if}
{/snippet}

{#snippet tasksTab()}
	{#if id}
		<Table
			{ctx}
			of="tasks"
			key={`partner:tasks:${id}`}
			where={{ subcontractor_id: { eq: id } }}
			order_by={{ task_code: 'asc' }}
			toolbar={{ title: t('partners.tasks_tab'), new: false }}
			columns={['task_code', 'title', 'project_id', 'trade_specialty', 'status', 'progress_pct']}
		/>
	{/if}
{/snippet}

{#if record}
	<RecordShell
		{ctx}
		of="contacts"
		mode={view.mode}
		id={record.id}
		subtitle={['role', 'trade_specialty', 'status']}
		tabs={[
			{
				name: 'orders',
				title: t('partners.orders_tab'),
				icon: 'lucide:file-signature',
				body: ordersTab
			},
			{
				name: 'transactions',
				title: t('partners.transactions_tab'),
				icon: 'lucide:receipt',
				body: transactionsTab
			},
			{
				name: 'tasks',
				title: t('partners.tasks_tab'),
				icon: 'lucide:list-checks',
				body: tasksTab
			}
		]}
	>
		<Form {ctx} of="contacts" mode={view.mode} id={record.id} {record} size="content">
			{@render partnerSections()}
		</Form>
	</RecordShell>
{:else}
	<RecordForm {ctx} {view} subtitle={['role', 'trade_specialty', 'status']}>
		{@render partnerSections()}
	</RecordForm>
{/if}
