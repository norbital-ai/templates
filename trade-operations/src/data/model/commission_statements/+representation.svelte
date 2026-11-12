<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Form,
		RecordShell,
		Table,
		open_record,
		label,
		Show,
		type RecordView,
		type ShowProps
	} from '@norbital-ai/ui';
	let {
		view,
		ctx
	}: {
		view: RecordView<'commission_statements'>;
		ctx: PageContext;
	} = $props();
</script>

{#snippet amount({ value }: { value: ShowProps['value'] })}
	{#if view.mode !== 'create'}<Show
			kind={{ kind: 'money', currency: 'currency', optional: true }}
			{value}
			row={view.record}
		/>{/if}
{/snippet}
{#snippet evidence()}
	{#if view.mode !== 'create'}
		<p>{ctx.t('component.monthly_commission_evidence')}</p>
		<Table
			of={view.record.snapshot}
			key="commission_statement_items"
			columns={[
				{ field: 'number', label: label(ctx, 'orders', 'order') },
				{ field: 'amount', label: label(ctx, 'orders', 'amount'), cell: amount }
			]}
			toolbar={{ new: false, export: true }}
			on_open={(row) => open_record('orders', row.order)}
		/>
	{/if}
{/snippet}
{#if view.mode !== 'create'}
	<RecordShell
		of="commission_statements"
		mode={view.mode}
		id={view.record.id}
		subtitle={['owner', 'period']}
		tabs={[{ name: 'orders', title: ctx.t('component.monthly_commission_items'), body: evidence }]}
	>
		<Form
			of="commission_statements"
			mode={view.mode}
			id={view.record.id}
			record={view.record}
			readonly
			fields={[
				'owner',
				'period',
				'currency',
				'amount',
				'order_count',
				'acknowledged_by',
				'acknowledged_at'
			]}
		/>
	</RecordShell>
{:else if view.values.owner && view.values.period && view.values.currency && view.values.calculation_hash}
	<RecordShell of="commission_statements" mode="create" values={view.values}>
		<p>{ctx.t('component.monthly_commission_evidence')}</p>
		<Form
			of="commission_statements"
			mode="create"
			values={view.values}
			fields={[]}
			submit={ctx.t('component.commission_acknowledge')}
		/>
	</RecordShell>
{:else}<p>{ctx.t('component.monthly_commission_from_board')}</p>{/if}
