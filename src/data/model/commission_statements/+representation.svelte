<script lang="ts">
	import { bolt } from '$bolt';
	import {
		Form,
		RecordShell,
		Table,
		Button,
		openRecord,
		label,
		Show,
		type RecordView,
		type ShowProps
	} from '@norbital-ai/ui';
	let {
		view
	}: {
		view: RecordView<'commission_statements'>;
	} = $props();
</script>

{#snippet order({ row }: { row: { order: string; number: string } })}<Button
		variant="link"
		onclick={() => openRecord('orders', row.order)}>{row.number}</Button
	>{/snippet}
{#snippet amount({ value }: { value: ShowProps['value'] })}
	{#if view.mode !== 'create'}<Show
			kind={{ kind: 'money', currency: 'currency', optional: true }}
			{value}
			row={view.record}
		/>{/if}
{/snippet}
{#snippet evidence()}
	{#if view.mode !== 'create'}
		<p>{bolt.t('component.monthly_commission_evidence')}</p>
		<Table
			of={view.record.snapshot}
			key="commission_statement_items"
			columns={[
				{ field: 'number', label: label(bolt, 'orders', 'order'), cell: order },
				{ field: 'amount', label: label(bolt, 'orders', 'amount'), cell: amount }
			]}
			toolbar={{ new: false, export: true }}
		/>
	{/if}
{/snippet}
{#if view.mode !== 'create'}
	<RecordShell
		of="commission_statements"
		mode={view.mode}
		id={view.record.id}
		subtitle={['owner', 'period']}
		tabs={[{ name: 'orders', title: bolt.t('component.monthly_commission_items'), body: evidence }]}
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
		<p>{bolt.t('component.monthly_commission_evidence')}</p>
		<Form
			of="commission_statements"
			mode="create"
			values={view.values}
			fields={[]}
			submit={bolt.t('component.commission_acknowledge')}
		/>
	</RecordShell>
{:else}<p>{bolt.t('component.monthly_commission_from_board')}</p>{/if}
